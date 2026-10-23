import { DEFAULT_GIT_OUTPUT_LIMIT_BYTES, emitGitTrace, GIT_TRACE_ENABLED, gitTraceRepoKey, normalizeGitOperationOutput, type GitCommandRunner } from './git-command'
import { promises as fs } from 'node:fs'
import type { GitBranchInfo, GitChangedFile, GitChangeKind, GitChangeScope, GitHistoryCommitInfo, GitRepositorySnapshot } from '../../../shared/types'

const GIT_BRANCH_LIST_OUTPUT_LIMIT_BYTES = 256 * 1024
const MAX_GIT_BRANCH_LIST_ITEMS = 500
const MAX_GIT_CHANGED_FILES_FOR_DETAIL = 99

export function emptyGitBranchInfo(): GitBranchInfo {
  return {
    current: '',
    ahead: 0,
    behind: 0,
    upstreamGone: false,
    detached: false,
    localBranches: [],
    remoteBranches: [],
  }
}

function remainderAfterTokens(record: string, tokenCount: number): string {
  let cursor = 0
  for (let index = 0; index < tokenCount; index++) {
    const nextSpace = record.indexOf(' ', cursor)
    if (nextSpace < 0) return ''
    cursor = nextSpace + 1
  }
  return record.slice(cursor)
}

function gitStatusToken(record: string, index: number): string {
  return record.split(' ')[index] || ''
}

function classifyGitChangeKind(indexStatus: string, worktreeStatus: string): GitChangeKind {
  if (indexStatus === '?' || worktreeStatus === '?') return 'untracked'
  if (indexStatus === 'U' || worktreeStatus === 'U') return 'conflicted'

  const status = [indexStatus, worktreeStatus].find((item) => item && item !== '.')
  switch (status) {
    case 'A':
      return 'added'
    case 'M':
      return 'modified'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'C':
      return 'copied'
    case 'T':
      return 'typechanged'
    default:
      return 'unknown'
  }
}

function classifyGitChangeScope(indexStatus: string, worktreeStatus: string): GitChangeScope {
  if (indexStatus === 'U' || worktreeStatus === 'U') return 'conflicted'
  if (indexStatus === '?' || worktreeStatus === '?') return 'untracked'
  if (indexStatus !== '.' && worktreeStatus === '.') return 'staged'
  return 'unstaged'
}

function createGitChangedFile(pathValue: string, indexStatus: string, worktreeStatus: string, originalPath?: string): GitChangedFile | null {
  const path = pathValue.trim()
  if (!path) return null
  const staged = indexStatus !== '.' && indexStatus !== '?'
  const unstaged = (worktreeStatus !== '.' && worktreeStatus !== '?') || indexStatus === '?' || worktreeStatus === '?'
  return {
    path,
    originalPath: originalPath?.trim() || undefined,
    indexStatus,
    worktreeStatus,
    kind: classifyGitChangeKind(indexStatus, worktreeStatus),
    scope: classifyGitChangeScope(indexStatus, worktreeStatus),
    staged,
    unstaged,
  }
}

function parseGitStatus(raw: string): { branch: GitBranchInfo; changedFiles: GitChangedFile[] } {
  const branch = emptyGitBranchInfo()
  const changedFiles: GitChangedFile[] = []
  const records = raw.replace(/\r/g, '').split('\x00').filter(Boolean)

  for (let index = 0; index < records.length; index++) {
    const record = records[index]

    if (record.startsWith('# branch.oid ')) {
      branch.oid = record.slice('# branch.oid '.length).trim()
      continue
    }
    if (record.startsWith('# branch.head ')) {
      const head = record.slice('# branch.head '.length).trim()
      branch.detached = head === '(detached)'
      branch.current = branch.detached ? 'DETACHED' : head
      continue
    }
    if (record.startsWith('# branch.upstream ')) {
      branch.upstream = record.slice('# branch.upstream '.length).trim() || undefined
      continue
    }
    if (record.startsWith('# branch.ab ')) {
      const match = record.match(/\+(-?\d+)\s+-(-?\d+)/)
      if (match) {
        branch.ahead = Number.parseInt(match[1], 10) || 0
        branch.behind = Number.parseInt(match[2], 10) || 0
      }
      continue
    }

    if (record.startsWith('? ')) {
      const file = createGitChangedFile(record.slice(2), '?', '?')
      if (file) changedFiles.push(file)
      continue
    }

    if (record.startsWith('1 ')) {
      const xy = gitStatusToken(record, 1)
      const file = createGitChangedFile(remainderAfterTokens(record, 8), xy[0] || '.', xy[1] || '.')
      if (file) changedFiles.push(file)
      continue
    }

    if (record.startsWith('2 ')) {
      const xy = gitStatusToken(record, 1)
      const file = createGitChangedFile(remainderAfterTokens(record, 9), xy[0] || '.', xy[1] || '.', records[index + 1])
      if (file) changedFiles.push(file)
      index += 1
      continue
    }

    if (record.startsWith('u ')) {
      const xy = gitStatusToken(record, 1)
      const file = createGitChangedFile(remainderAfterTokens(record, 10), xy[0] || 'U', xy[1] || 'U')
      if (file) changedFiles.push(file)
    }
  }

  return { branch, changedFiles }
}

// for-each-ref 合并解析（阶段 4 §5.1）：单条命令同时取本地与远程分支，
// 记录以 %1e 结尾、字段以 %00 分隔（分支名不含 NUL，安全）。
// 目前仅消费 refname；objectname/upstream/HEAD 字段按 plan-detail §5.1 格式保留。
// 语义与原两条 branch 命令一致：本地/远程各 500 条截断，远程过滤 /HEAD 结尾，按 refname 排序。
export function parseGitForEachRefBranches(raw: string): { localBranches: string[]; remoteBranches: string[] } {
  const records = raw
    .replace(/\r/g, '')
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
  const localBranches: string[] = []
  const remoteBranches: string[] = []
  for (const record of records) {
    const refname = record.split('\x00')[0]?.trim() ?? ''
    if (refname.startsWith('refs/heads/')) {
      localBranches.push(refname.slice('refs/heads/'.length))
    } else if (refname.startsWith('refs/remotes/')) {
      remoteBranches.push(refname.slice('refs/remotes/'.length))
    }
  }
  return {
    localBranches: localBranches.slice(0, MAX_GIT_BRANCH_LIST_ITEMS),
    remoteBranches: remoteBranches.slice(0, MAX_GIT_BRANCH_LIST_ITEMS).filter((item) => !/\/HEAD$/.test(item)),
  }
}

export function createGitSnapshotReader(runner: GitCommandRunner) {
  const { runGitCommand } = runner

  async function readGitCommitFilesChangedMap(cwd: string, limit: number, traceActionId?: string): Promise<Map<string, string[]>> {
    const result = await runGitCommand(
      cwd,
      ['log', `-${limit}`, '--pretty=format:%H%x00', '--name-only', '-z'],
      {
        stdoutLimitBytes: DEFAULT_GIT_OUTPUT_LIMIT_BYTES,
        stderrLimitBytes: DEFAULT_GIT_OUTPUT_LIMIT_BYTES,
      },
      traceActionId,
    )
    if (result.code !== 0) return new Map()

    const records = result.stdout.replace(/\r/g, '').split('\x00')
    const filesByHash = new Map<string, string[]>()
    let currentHash = ''

    for (const rawRecord of records) {
      const record = rawRecord.trim()
      if (!record) continue

      if (/^[0-9a-f]{40}$/i.test(record)) {
        currentHash = record.toLowerCase()
        if (!filesByHash.has(currentHash)) {
          filesByHash.set(currentHash, [])
        }
        continue
      }

      if (!currentHash) continue
      const files = filesByHash.get(currentHash)
      if (files && !files.includes(record)) files.push(record)
    }

    return filesByHash
  }

  async function readGitCommitHistory(cwd: string, limit: number, traceActionId?: string): Promise<GitHistoryCommitInfo[]> {
    const result = await runGitCommand(
      cwd,
      ['log', `-${limit}`, '--pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%cI%x1f%D%x1f%B%x1e'],
      {
        stdoutLimitBytes: DEFAULT_GIT_OUTPUT_LIMIT_BYTES,
        stderrLimitBytes: DEFAULT_GIT_OUTPUT_LIMIT_BYTES,
      },
      traceActionId ? `${traceActionId}:log-history` : undefined,
    )
    if (result.code !== 0) return []

    const records = result.stdout
      .replace(/\r/g, '')
      .split('\x1e')
      .map((item) => item.trim())
      .filter(Boolean)

    const commits: GitHistoryCommitInfo[] = []
    for (const record of records) {
      const fields = record.split('\x1f')
      const hash = fields[0]
      const shortHash = fields[1]
      const subject = fields[2]
      const authorName = fields[3] || ''
      const committedAt = fields[4]
      const refs = (fields[5] || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
      const fullMessage = fields.slice(6).join('\x1f')
      if (!hash || !shortHash || !subject || !committedAt) continue
      const bullets = fullMessage
        .replace(/\r/g, '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => /^-\s+/.test(line))

      commits.push({
        hash,
        shortHash,
        subject,
        authorName,
        committedAt,
        refs,
        bullets,
        filesChanged: 0,
        changedFiles: [],
      })
    }

    const filesChangedByHash = await readGitCommitFilesChangedMap(cwd, limit, traceActionId ? `${traceActionId}:log-files` : undefined)
    for (const commit of commits) {
      const changedFiles = filesChangedByHash.get(commit.hash.toLowerCase()) ?? []
      commit.changedFiles = changedFiles
      commit.filesChanged = changedFiles.length
    }

    return commits
  }

  async function readRecentCommits(cwd: string): Promise<GitHistoryCommitInfo[]> {
    const commits = await readGitCommitHistory(cwd, 5, 'recent-commits')
    if (commits.length === 0) return []

    const latestTime = new Date(commits[0].committedAt).getTime()
    if (Number.isNaN(latestTime)) {
      return [commits[0]]
    }

    const withinOneMinute = commits.filter((commit) => {
      const t = new Date(commit.committedAt).getTime()
      if (Number.isNaN(t)) return false
      return latestTime - t <= 60_000
    })

    return withinOneMinute.length > 0 ? withinOneMinute : [commits[0]]
  }

  async function readGitRefOid(cwd: string, ref: string, traceActionId?: string): Promise<string | undefined> {
    const normalizedRef = ref.trim()
    if (!normalizedRef) return undefined
    const result = await runGitCommand(cwd, ['rev-parse', '--verify', normalizedRef], undefined, traceActionId)
    if (result.code !== 0) return undefined
    const oid = result.stdout.replace(/\r/g, '').trim()
    return /^[0-9a-f]{40}$/i.test(oid) ? oid : undefined
  }

  async function readGitRepositorySnapshot(repoRoot: string, traceActionId = 'snapshot', options?: { lightweight?: boolean }): Promise<GitRepositorySnapshot> {
    const snapshotStartedAt = GIT_TRACE_ENABLED ? performance.now() : 0
    const lightweight = options?.lightweight === true
    const emitSnapshotSummary = (repoKeyRoot: string) => {
      if (!GIT_TRACE_ENABLED) return
      emitGitTrace({
        actionId: traceActionId,
        repoKey: gitTraceRepoKey(repoKeyRoot),
        cmd: lightweight ? 'snapshot-light' : 'snapshot',
        durationMs: Math.round(performance.now() - snapshotStartedAt),
      })
    }
    const inputRepoRoot = repoRoot.trim()
    if (!inputRepoRoot) {
      emitSnapshotSummary(inputRepoRoot)
      return {
        repoRoot: '',
        snapshotKind: lightweight ? 'light' : 'full',
        isGitRepository: false,
        branch: emptyGitBranchInfo(),
        changedFiles: [],
        changedFileCount: 0,
        conflictedFileCount: 0,
        recentCommits: [],
        checkedAt: Date.now(),
        error: 'Repository root is required.',
      }
    }

    let checkedRepoRoot = inputRepoRoot
    try {
      checkedRepoRoot = await fs.realpath(inputRepoRoot)
    } catch {
      // Keep the caller-provided path so the error can still point at the requested repoRoot.
    }

    const repositoryResult = await runner.runGitCommand(checkedRepoRoot, ['rev-parse', '--show-toplevel'], undefined, `${traceActionId}:rev-parse-toplevel`)
    const repositoryRoot = repositoryResult.code === 0 ? repositoryResult.stdout.replace(/\r/g, '').trim() : ''
    const effectiveRepoRoot = repositoryRoot || checkedRepoRoot
    const repository = repositoryRoot
      ? {
          id: repositoryRoot,
          name: repositoryRoot.split(/[\\/]/).filter(Boolean).pop() || repositoryRoot,
          repoRoot: repositoryRoot,
          relativePath: '.',
          isNested: false,
        }
      : undefined
    const emptyBranch = emptyGitBranchInfo()
    const statusResult = await runGitCommand(
      effectiveRepoRoot,
      ['status', '--porcelain=v2', '--branch', '-uall', '-z'],
      {
        stdoutLimitBytes: DEFAULT_GIT_OUTPUT_LIMIT_BYTES,
        stderrLimitBytes: DEFAULT_GIT_OUTPUT_LIMIT_BYTES,
      },
      `${traceActionId}:status`,
    )

    if (statusResult.code !== 0) {
      emitSnapshotSummary(effectiveRepoRoot)
      return {
        repoRoot: effectiveRepoRoot,
        snapshotKind: lightweight ? 'light' : 'full',
        isGitRepository: false,
        repository,
        branch: emptyBranch,
        changedFiles: [],
        changedFileCount: 0,
        conflictedFileCount: 0,
        recentCommits: [],
        checkedAt: Date.now(),
        error: normalizeGitOperationOutput(statusResult.stdout, statusResult.stderr, {
          stdoutLimit: statusResult.stdoutLimit,
          stderrLimit: statusResult.stderrLimit,
        }),
      }
    }

    const [refsResult, recentCommits] = await Promise.all([
      // for-each-ref 合并（阶段 4 §5.1）：单条命令替代原 branch-local + branch-remote 两条
      runGitCommand(
        effectiveRepoRoot,
        ['for-each-ref', '--sort=refname', '--format=%(refname)%00%(objectname)%00%(upstream)%00%(HEAD)%1e', 'refs/heads', 'refs/remotes'],
        {
          stdoutLimitBytes: GIT_BRANCH_LIST_OUTPUT_LIMIT_BYTES,
          stderrLimitBytes: GIT_BRANCH_LIST_OUTPUT_LIMIT_BYTES,
        },
        `${traceActionId}:refs`,
      ),
      lightweight ? Promise.resolve<GitHistoryCommitInfo[]>([]) : readGitCommitHistory(effectiveRepoRoot, 10, `${traceActionId}:history`),
    ])
    const { localBranches, remoteBranches } = parseGitForEachRefBranches(refsResult.stdout)

    const parsed = parseGitStatus(statusResult.stdout)
    const changedFileCount = parsed.changedFiles.length
    const conflictedFileCount = parsed.changedFiles.filter((file) => file.scope === 'conflicted').length
    const changedFilesSuppressed = changedFileCount > MAX_GIT_CHANGED_FILES_FOR_DETAIL
    // remoteBranches 已在 parseGitForEachRefBranches 内完成 500 条截断与 /HEAD 过滤
    const remoteBranchSet = new Set(remoteBranches)
    const upstreamGone = parsed.branch.upstream ? !remoteBranchSet.has(parsed.branch.upstream) : false
    const upstreamOid = lightweight || !parsed.branch.upstream || upstreamGone ? undefined : await readGitRefOid(effectiveRepoRoot, parsed.branch.upstream, `${traceActionId}:rev-parse-upstream`)
    const branch = {
      ...parsed.branch,
      upstreamGone,
      upstreamOid,
      localBranches,
      remoteBranches,
    }

    emitSnapshotSummary(effectiveRepoRoot)
    return {
      repoRoot: effectiveRepoRoot,
      snapshotKind: lightweight ? 'light' : 'full',
      isGitRepository: true,
      repository,
      branch,
      changedFiles: changedFilesSuppressed ? [] : parsed.changedFiles,
      changedFileCount,
      conflictedFileCount,
      changedFilesSuppressed,
      recentCommits,
      checkedAt: Date.now(),
    }
  }

  return {
    readRecentCommits,
    readGitRepositorySnapshot,
    readGitRefOid,
  }
}
