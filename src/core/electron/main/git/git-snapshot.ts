import {
  DEFAULT_GIT_OUTPUT_LIMIT_BYTES,
  normalizeGitOperationOutput,
  type GitCommandRunner,
} from './git-command'
import type {
  GitBranchInfo,
  GitChangedFile,
  GitChangeKind,
  GitChangeScope,
  GitHistoryCommitInfo,
  GitWorkspaceSnapshot,
} from '../../../shared/types'

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

function createGitChangedFile(
  pathValue: string,
  indexStatus: string,
  worktreeStatus: string,
  originalPath?: string
): GitChangedFile | null {
  const path = pathValue.trim()
  if (!path) return null
  const staged = indexStatus !== '.' && indexStatus !== '?'
  const unstaged = worktreeStatus !== '.' && worktreeStatus !== '?' || indexStatus === '?' || worktreeStatus === '?'
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
      const file = createGitChangedFile(
        remainderAfterTokens(record, 9),
        xy[0] || '.',
        xy[1] || '.',
        records[index + 1]
      )
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

export function createGitSnapshotReader(runner: GitCommandRunner) {
  const { runGitCommand, listGitLines } = runner

  async function readGitCommitFilesChangedMap(cwd: string, limit: number): Promise<Map<string, number>> {
    const result = await runGitCommand(cwd, [
      'log',
      `-${limit}`,
      '--pretty=format:%H',
      '--numstat',
    ], {
      stdoutLimitBytes: DEFAULT_GIT_OUTPUT_LIMIT_BYTES,
      stderrLimitBytes: DEFAULT_GIT_OUTPUT_LIMIT_BYTES,
    })
    if (result.code !== 0) return new Map()

    const lines = result.stdout.replace(/\r/g, '').split('\n')
    const countsByHash = new Map<string, number>()
    let currentHash = ''

    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line) continue

      if (/^[0-9a-f]{40}$/i.test(line)) {
        currentHash = line.toLowerCase()
        if (!countsByHash.has(currentHash)) {
          countsByHash.set(currentHash, 0)
        }
        continue
      }

      if (!currentHash) continue
      const fields = line.split('\t')
      if (fields.length < 3) continue
      countsByHash.set(currentHash, (countsByHash.get(currentHash) ?? 0) + 1)
    }

    return countsByHash
  }

  async function readGitCommitHistory(cwd: string, limit: number): Promise<GitHistoryCommitInfo[]> {
    const result = await runGitCommand(cwd, [
      'log',
      `-${limit}`,
      '--pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%cI%x1f%D%x1f%B%x1e',
    ], {
      stdoutLimitBytes: DEFAULT_GIT_OUTPUT_LIMIT_BYTES,
      stderrLimitBytes: DEFAULT_GIT_OUTPUT_LIMIT_BYTES,
    })
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
      })
    }

    const filesChangedByHash = await readGitCommitFilesChangedMap(cwd, limit)
    for (const commit of commits) {
      commit.filesChanged = filesChangedByHash.get(commit.hash.toLowerCase()) ?? 0
    }

    return commits
  }

  async function readRecentCommits(cwd: string): Promise<GitHistoryCommitInfo[]> {
    const commits = await readGitCommitHistory(cwd, 5)
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

  async function readGitRefOid(cwd: string, ref: string): Promise<string | undefined> {
    const normalizedRef = ref.trim()
    if (!normalizedRef) return undefined
    const result = await runGitCommand(cwd, ['rev-parse', '--verify', normalizedRef])
    if (result.code !== 0) return undefined
    const oid = result.stdout.replace(/\r/g, '').trim()
    return /^[0-9a-f]{40}$/i.test(oid) ? oid : undefined
  }

  async function readGitWorkspaceSnapshot(projectPath: string): Promise<GitWorkspaceSnapshot> {
    const repositoryResult = await runner.runGitCommand(projectPath, ['rev-parse', '--show-toplevel'])
    const repositoryRoot = repositoryResult.code === 0
      ? repositoryResult.stdout.replace(/\r/g, '').trim()
      : ''
    const repository = repositoryRoot
      ? {
          id: repositoryRoot,
          name: repositoryRoot.split(/[\\/]/).filter(Boolean).pop() || repositoryRoot,
          rootPath: repositoryRoot,
          relativePath: '.',
          isNested: false,
        }
      : undefined
    const emptyBranch = emptyGitBranchInfo()
    const statusResult = await runGitCommand(projectPath, ['status', '--porcelain=v2', '--branch', '-uall', '-z'], {
      stdoutLimitBytes: DEFAULT_GIT_OUTPUT_LIMIT_BYTES,
      stderrLimitBytes: DEFAULT_GIT_OUTPUT_LIMIT_BYTES,
    })

    if (statusResult.code !== 0) {
      return {
        projectPath,
        isGitRepository: false,
        repository,
        branch: emptyBranch,
        changedFiles: [],
        recentCommits: [],
        checkedAt: Date.now(),
        error: normalizeGitOperationOutput(statusResult.stdout, statusResult.stderr, {
          stdoutLimit: statusResult.stdoutLimit,
          stderrLimit: statusResult.stderrLimit,
        }),
      }
    }

    const [localBranches, remoteBranches, recentCommits] = await Promise.all([
      listGitLines(projectPath, ['branch', '--format=%(refname:short)']),
      listGitLines(projectPath, ['branch', '--remotes', '--format=%(refname:short)']),
      readGitCommitHistory(projectPath, 10),
    ])

    const parsed = parseGitStatus(statusResult.stdout)
    const filteredRemoteBranches = remoteBranches.filter((item) => !/\/HEAD$/.test(item))
    const remoteBranchSet = new Set(filteredRemoteBranches)
    const upstreamGone = parsed.branch.upstream ? !remoteBranchSet.has(parsed.branch.upstream) : false
    const upstreamOid = parsed.branch.upstream && !upstreamGone
      ? await readGitRefOid(projectPath, parsed.branch.upstream)
      : undefined
    const branch = {
      ...parsed.branch,
      upstreamGone,
      upstreamOid,
      localBranches,
      remoteBranches: filteredRemoteBranches,
    }

    return {
      projectPath,
      isGitRepository: true,
      repository,
      branch,
      changedFiles: parsed.changedFiles,
      recentCommits,
      checkedAt: Date.now(),
    }
  }

  return {
    readRecentCommits,
    readGitWorkspaceSnapshot,
  }
}
