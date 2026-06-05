import { spawn } from 'child_process'
import { constants as FsConstants } from 'fs'
import { access, readFile, writeFile, realpath, stat } from 'fs/promises'
import { join } from 'path'
import { StringDecoder } from 'string_decoder'
import { resolveWslVsCodeTarget } from '../shell/openers'
import { wslBridge } from '../wsl-bridge'
import type {
  GitBranchInfo,
  GitChangedFile,
  GitChangeKind,
  GitChangeScope,
  GitConflictFileRequest,
  GitConflictFileResult,
  GitConflictStageContent,
  GitFileDiffRequest,
  GitFileDiffResult,
  GitHistoryCommitInfo,
  GitOperationRequest,
  GitOperationResult,
  GitOutputLimitInfo,
  GitResolveConflictRequest,
  GitResolveConflictResult,
  GitSetFileStageRequest,
  GitSetFileStageResult,
  GitWorkspaceSnapshot,
} from '../../../shared/types'

const DEFAULT_GIT_OUTPUT_LIMIT_BYTES = 512 * 1024
const GIT_DIFF_OUTPUT_LIMIT_BYTES = 512 * 1024
const GIT_CONFLICT_STAGE_OUTPUT_LIMIT_BYTES = 512 * 1024
const GIT_CONFLICT_WORKTREE_MAX_FILE_BYTES = 1024 * 1024

type LimitedGitText = {
  text: string
  limitInfo?: GitOutputLimitInfo
}

type GitCommandExecutionResult = {
  code: number | null
  stdout: string
  stderr: string
  stdoutLimit?: GitOutputLimitInfo
  stderrLimit?: GitOutputLimitInfo
}

type GitCommandLimits = {
  stdoutLimitBytes?: number
  stderrLimitBytes?: number
}

type GitCommandSequenceResult = {
  ok: boolean
  command: string
  output: string
  exitCode: number | null
  error?: string
}

type GitServiceDependencies = {
  getDefaultWslDistro: () => string
}

export function createGitService(deps: GitServiceDependencies) {
  const getDefaultWslDistro = () => deps.getDefaultWslDistro() || 'Ubuntu'

  function emptyGitBranchInfo(): GitBranchInfo {
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

  function createLimitedUtf8Accumulator(limitBytes: number) {
    const decoder = new StringDecoder('utf8')
    let text = ''
    let totalBytes = 0
    let keptBytes = 0

    const pushChunk = (buf: Buffer) => {
      totalBytes += buf.length
      if (limitBytes <= 0 || keptBytes >= limitBytes) return
      const remainingBytes = limitBytes - keptBytes
      if (remainingBytes <= 0) return
      const chunk = buf.length <= remainingBytes ? buf : buf.subarray(0, remainingBytes)
      if (chunk.length <= 0) return
      text += decoder.write(chunk)
      keptBytes += chunk.length
    }

    const finish = (): LimitedGitText => {
      if (keptBytes < limitBytes) {
        text += decoder.end()
      } else {
        decoder.end()
      }
      if (totalBytes <= limitBytes) {
        return { text }
      }
      return {
        text,
        limitInfo: {
          limitBytes,
          totalBytes,
          keptBytes,
        },
      }
    }

    return { pushChunk, finish }
  }

  function formatGitOutputLimitNotice(limit: GitOutputLimitInfo, label = 'output'): string {
    const omittedBytes = Math.max(0, limit.totalBytes - limit.keptBytes)
    return `[truncated ${label}: kept ${limit.keptBytes}/${limit.totalBytes} bytes, omitted ${omittedBytes} bytes]`
  }

  function appendGitOutputLimitNotice(
    text: string,
    limit: GitOutputLimitInfo | undefined,
    label = 'output'
  ): string {
    if (!limit) return text
    const notice = formatGitOutputLimitNotice(limit, label)
    const base = text.replace(/\s+$/, '')
    return base ? `${base}\n${notice}` : notice
  }

  function runGitCommand(cwd: string, args: string[], limits?: GitCommandLimits): Promise<GitCommandExecutionResult> {
    return new Promise((resolve) => {
      const wslTarget = process.platform === 'win32'
        ? resolveWslVsCodeTarget(cwd, getDefaultWslDistro())
        : null
      const useWslGit = Boolean(wslTarget && wslBridge.isAvailable())
      const child = useWslGit
        ? spawn('wsl.exe', ['-d', wslTarget!.distro, '--cd', wslTarget!.linuxPath, 'git', ...args], {
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        : spawn('git', args, {
          cwd,
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
        })

      const stdoutAccumulator = createLimitedUtf8Accumulator(limits?.stdoutLimitBytes ?? Number.POSITIVE_INFINITY)
      const stderrAccumulator = createLimitedUtf8Accumulator(limits?.stderrLimitBytes ?? Number.POSITIVE_INFINITY)

      child.stdout?.on('data', (buf: Buffer) => {
        stdoutAccumulator.pushChunk(buf)
      })
      child.stderr?.on('data', (buf: Buffer) => {
        stderrAccumulator.pushChunk(buf)
      })

      child.on('error', (err) => {
        const stdoutResult = stdoutAccumulator.finish()
        const stderrResult = stderrAccumulator.finish()
        resolve({
          code: null,
          stdout: stdoutResult.text,
          stderr: stderrResult.text || err.message,
          stdoutLimit: stdoutResult.limitInfo,
          stderrLimit: stderrResult.limitInfo,
        })
      })
      child.on('close', (code) => {
        const stdoutResult = stdoutAccumulator.finish()
        const stderrResult = stderrAccumulator.finish()
        resolve({
          code,
          stdout: stdoutResult.text,
          stderr: stderrResult.text,
          stdoutLimit: stdoutResult.limitInfo,
          stderrLimit: stderrResult.limitInfo,
        })
      })
    })
  }

  function listGitLines(cwd: string, args: string[]): Promise<string[]> {
    return runGitCommand(cwd, args).then((result) => {
      if (result.code !== 0) return []
      return result.stdout
        .replace(/\r/g, '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    })
  }

  async function runGitCommandSequence(cwd: string, commandArgsList: string[][]): Promise<GitCommandSequenceResult> {
    const command = commandArgsList.map((args) => formatGitCommand(args)).join(' && ')
    const outputChunks: string[] = []

    for (const args of commandArgsList) {
      const execution = await runGitCommand(cwd, args, {
        stdoutLimitBytes: DEFAULT_GIT_OUTPUT_LIMIT_BYTES,
        stderrLimitBytes: DEFAULT_GIT_OUTPUT_LIMIT_BYTES,
      })
      const stepOutput = normalizeGitOperationOutput(execution.stdout, execution.stderr, {
        stdoutLimit: execution.stdoutLimit,
        stderrLimit: execution.stderrLimit,
      })
      outputChunks.push(`$ ${formatGitCommand(args)}`)
      if (stepOutput !== '(no output)') {
        outputChunks.push(stepOutput)
      }
      if (execution.code !== 0) {
        return {
          ok: false,
          command,
          output: outputChunks.join('\n'),
          exitCode: execution.code,
          error: stepOutput,
        }
      }
    }

    return {
      ok: true,
      command,
      output: outputChunks.length > 0 ? outputChunks.join('\n') : '(no output)',
      exitCode: 0,
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

  async function readGitWorkspaceSnapshot(projectPath: string): Promise<GitWorkspaceSnapshot> {
    const emptyBranch = emptyGitBranchInfo()
    const statusResult = await runGitCommand(projectPath, ['status', '--porcelain=v2', '--branch', '-uall', '-z'], {
      stdoutLimitBytes: DEFAULT_GIT_OUTPUT_LIMIT_BYTES,
      stderrLimitBytes: DEFAULT_GIT_OUTPUT_LIMIT_BYTES,
    })

    if (statusResult.code !== 0) {
      return {
        projectPath,
        isGitRepository: false,
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
      branch,
      changedFiles: parsed.changedFiles,
      recentCommits,
      checkedAt: Date.now(),
    }
  }

  function formatGitCommand(args: string[]): string {
    const escaped = args.map((arg) => (
      /\s/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg
    ))
    return `git ${escaped.join(' ')}`
  }

  function normalizeGitOperationOutput(
    stdout: string,
    stderr: string,
    limits?: { stdoutLimit?: GitOutputLimitInfo; stderrLimit?: GitOutputLimitInfo }
  ): string {
    const segments: string[] = []
    const normalizedStdout = stdout.replace(/\r/g, '').trim()
    const normalizedStderr = stderr.replace(/\r/g, '').trim()
    if (normalizedStdout) {
      segments.push(appendGitOutputLimitNotice(normalizedStdout, limits?.stdoutLimit, 'stdout'))
    } else if (limits?.stdoutLimit) {
      segments.push(formatGitOutputLimitNotice(limits.stdoutLimit, 'stdout'))
    }
    if (normalizedStderr) {
      segments.push(appendGitOutputLimitNotice(normalizedStderr, limits?.stderrLimit, 'stderr'))
    } else if (limits?.stderrLimit) {
      segments.push(formatGitOutputLimitNotice(limits.stderrLimit, 'stderr'))
    }
    const normalized = segments.join('\n').trim()
    return normalized || '(no output)'
  }

  function normalizeGitDiffOutput(output: string): string {
    return output.replace(/\r/g, '').trim()
  }

  function firstNonEmptyLine(input: string): string | undefined {
    const lines = input
      .replace(/\r/g, '')
      .split('\n')
      .map((line) => line.trim())
    return lines.find(Boolean)
  }

  async function readGitFileEolInfo(cwd: string, filePath: string): Promise<string | undefined> {
    const result = await runGitCommand(cwd, ['ls-files', '--eol', '--', filePath])
    if (result.code !== 0) return undefined
    return firstNonEmptyLine(result.stdout)
  }

  function buildEmptyGitDiffHint(filePath: string, file?: GitChangedFile, eolInfo?: string): string {
    const lines = [
      '(no textual patch output)',
      'Git 状态显示该文件存在变更，但当前 diff 为空。',
      '这通常是 CRLF/LF 行尾规范化导致的显示差异。',
      `文件: ${filePath}`,
    ]

    if (file) {
      lines.push(`状态: scope=${file.scope}, index=${file.indexStatus}, worktree=${file.worktreeStatus}`)
    }
    if (eolInfo) {
      lines.push(`EOL: ${eolInfo}`)
    }

    lines.push('可执行: git ls-files --eol -- "<file>" 进一步确认。')
    return lines.join('\n')
  }

  async function readGitRefOid(cwd: string, ref: string): Promise<string | undefined> {
    const normalizedRef = ref.trim()
    if (!normalizedRef) return undefined
    const result = await runGitCommand(cwd, ['rev-parse', '--verify', normalizedRef])
    if (result.code !== 0) return undefined
    const oid = result.stdout.replace(/\r/g, '').trim()
    return /^[0-9a-f]{40}$/i.test(oid) ? oid : undefined
  }

  function normalizeRemoteName(input: string | undefined): string {
    const normalized = (input || '').trim()
    return normalized || 'origin'
  }

  function isValidGitBranchName(name: string): boolean {
    if (!name || name.length > 255) return false
    if (name.startsWith('/') || name.endsWith('/')) return false
    if (name.includes('//')) return false
    if (name.includes('\\')) return false
    if (name.includes('..')) return false
    if (name.includes('@{')) return false
    if (name.endsWith('.')) return false
    if (name.endsWith('.lock')) return false
    if (/[\x00-\x20\x7f~^:?*\[]/.test(name)) return false
    if (name.split('/').some((part) => part.length === 0 || part.startsWith('.') || part.endsWith('.'))) return false
    return true
  }

  async function fileExistsAtCwd(cwd: string, relativeFilePath: string): Promise<boolean> {
    try {
      const filePath = join(cwd, relativeFilePath)
      await access(filePath, FsConstants.F_OK)
      return true
    } catch {
      return false
    }
  }

  function normalizeGitRelativePath(input: string): string | null {
    const trimmed = input.trim().replace(/\\/g, '/')
    if (!trimmed) return null
    if (trimmed === '.' || trimmed === '..') return null
    if (trimmed.includes('\0')) return null
    if (trimmed.startsWith('../') || trimmed.includes('/../')) return null
    if (/^[A-Za-z]:\//.test(trimmed)) return null
    if (trimmed.startsWith('/')) return null
    return trimmed
  }

  async function resolveGitFilePath(projectPath: string, filePath: string): Promise<string | null> {
    const normalized = normalizeGitRelativePath(filePath)
    if (!normalized) return null
    try {
      const rootRealPath = await realpath(projectPath)
      const candidatePath = join(rootRealPath, normalized)
      const candidateRealPath = await realpath(candidatePath)
      if (
        candidateRealPath === rootRealPath
        || candidateRealPath.startsWith(`${rootRealPath}\\`)
        || candidateRealPath.startsWith(`${rootRealPath}/`)
      ) {
        return candidateRealPath
      }
      return null
    } catch {
      return null
    }
  }

  async function readGitShowStageContent(
    projectPath: string,
    filePath: string,
    stage: 1 | 2 | 3
  ): Promise<GitConflictStageContent> {
    const spec = `:${stage}:${filePath}`
    const args = ['show', '--textconv', spec]
    const execution = await runGitCommand(projectPath, args, {
      stdoutLimitBytes: GIT_CONFLICT_STAGE_OUTPUT_LIMIT_BYTES,
      stderrLimitBytes: DEFAULT_GIT_OUTPUT_LIMIT_BYTES,
    })
    const normalizedOutput = execution.stdout.replace(/\r/g, '')
    if (execution.code === 0) {
      return {
        stage,
        label: stage === 1 ? 'base' : stage === 2 ? 'ours' : 'theirs',
        exists: true,
        output: normalizedOutput,
        outputLimit: execution.stdoutLimit,
      }
    }

    const stderr = execution.stderr.replace(/\r/g, '').trim()
    const stdout = execution.stdout.replace(/\r/g, '').trim()
    const combined = normalizeGitOperationOutput(stdout, stderr, {
      stdoutLimit: execution.stdoutLimit,
      stderrLimit: execution.stderrLimit,
    })
    const missing = /path '.*' is in the index, but not at stage/i.test(combined)
      || /exists on disk, but not in '.*'/i.test(combined)
      || /fatal: bad object/i.test(combined)

    return {
      stage,
      label: stage === 1 ? 'base' : stage === 2 ? 'ours' : 'theirs',
      exists: !missing,
      output: missing ? '' : normalizedOutput,
      outputLimit: execution.stdoutLimit,
      error: missing ? undefined : (combined || `git show exited with code ${execution.code ?? 'unknown'}`),
    }
  }

  function hasConflictMarker(content: string): boolean {
    const normalized = content.replace(/\r/g, '')
    return normalized.includes('\n<<<<<<< ') || normalized.startsWith('<<<<<<< ')
  }

  async function getGitConflictFile(request: GitConflictFileRequest): Promise<GitConflictFileResult> {
    const checkedAt = Date.now()
    const projectPath = request.projectPath.trim()
    const normalizedFilePath = normalizeGitRelativePath(request.filePath)
    const filePath = normalizedFilePath ?? ''

    if (!projectPath) {
      return {
        ok: false,
        checkedAt,
        command: '',
        output: 'Project path is required.',
        exitCode: null,
        filePath,
        workingTreeContent: '',
        hasConflictMarkers: false,
        stageContents: [],
        error: 'Project path is required.',
      }
    }
    if (!normalizedFilePath) {
      return {
        ok: false,
        checkedAt,
        command: '',
        output: 'File path is invalid.',
        exitCode: null,
        filePath: request.filePath.trim(),
        workingTreeContent: '',
        hasConflictMarkers: false,
        stageContents: [],
        error: 'File path is invalid.',
      }
    }

    const snapshot = await readGitWorkspaceSnapshot(projectPath)
    if (!snapshot.isGitRepository) {
      const reason = snapshot.error || 'Not a git repository.'
      return {
        ok: false,
        checkedAt,
        command: '',
        output: reason,
        exitCode: null,
        filePath: normalizedFilePath,
        workingTreeContent: '',
        hasConflictMarkers: false,
        stageContents: [],
        error: reason,
      }
    }

    const conflictFile = snapshot.changedFiles.find((file) => file.path === normalizedFilePath && file.scope === 'conflicted')
    if (!conflictFile) {
      return {
        ok: false,
        checkedAt,
        command: '',
        output: 'Target file is not in conflicted state.',
        exitCode: null,
        filePath: normalizedFilePath,
        workingTreeContent: '',
        hasConflictMarkers: false,
        stageContents: [],
        error: 'Target file is not in conflicted state.',
      }
    }

    const resolvedPath = await resolveGitFilePath(projectPath, normalizedFilePath)
    if (!resolvedPath) {
      return {
        ok: false,
        checkedAt,
        command: '',
        output: 'Failed to resolve conflicted file path safely.',
        exitCode: null,
        filePath: normalizedFilePath,
        workingTreeContent: '',
        hasConflictMarkers: false,
        stageContents: [],
        error: 'Failed to resolve conflicted file path safely.',
      }
    }

    let workingTreeContent = ''
    try {
      const fileStat = await stat(resolvedPath)
      if (fileStat.size > GIT_CONFLICT_WORKTREE_MAX_FILE_BYTES) {
        return {
          ok: false,
          checkedAt,
          command: '',
          output: `Conflicted file is too large to load safely. Limit is ${GIT_CONFLICT_WORKTREE_MAX_FILE_BYTES} bytes.`,
          exitCode: null,
          filePath: normalizedFilePath,
          workingTreeContent: '',
          hasConflictMarkers: false,
          stageContents: [],
          error: `Conflicted file is too large to load safely. Limit is ${GIT_CONFLICT_WORKTREE_MAX_FILE_BYTES} bytes.`,
        }
      }
      workingTreeContent = (await readFile(resolvedPath, { encoding: 'utf-8' })).replace(/\r/g, '')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        checkedAt,
        command: '',
        output: message,
        exitCode: null,
        filePath: normalizedFilePath,
        workingTreeContent: '',
        hasConflictMarkers: false,
        stageContents: [],
        error: message,
      }
    }

    const stageContents = await Promise.all([
      readGitShowStageContent(projectPath, normalizedFilePath, 1),
      readGitShowStageContent(projectPath, normalizedFilePath, 2),
      readGitShowStageContent(projectPath, normalizedFilePath, 3),
    ])

    const errors = stageContents
      .map((item) => item.error)
      .filter((item): item is string => Boolean(item))

    const outputParts = [
      `Loaded conflict for ${normalizedFilePath}.`,
      errors.length > 0 ? `Some stages failed to load:\n${errors.join('\n')}` : '',
    ].filter(Boolean)

    return {
      ok: true,
      checkedAt,
      command: `git show --textconv :1:${normalizedFilePath}; git show --textconv :2:${normalizedFilePath}; git show --textconv :3:${normalizedFilePath}`,
      output: outputParts.join('\n'),
      exitCode: 0,
      filePath: normalizedFilePath,
      workingTreeContent,
      hasConflictMarkers: hasConflictMarker(workingTreeContent),
      stageContents,
    }
  }

  async function resolveGitConflictFile(request: GitResolveConflictRequest): Promise<GitResolveConflictResult> {
    const checkedAt = Date.now()
    const projectPath = request.projectPath.trim()
    const normalizedFilePath = normalizeGitRelativePath(request.filePath)
    const content = request.content ?? ''
    const markResolved = request.markResolved !== false

    if (!projectPath) {
      return {
        ok: false,
        checkedAt,
        command: '',
        output: 'Project path is required.',
        exitCode: null,
        error: 'Project path is required.',
      }
    }
    if (!normalizedFilePath) {
      return {
        ok: false,
        checkedAt,
        command: '',
        output: 'File path is invalid.',
        exitCode: null,
        error: 'File path is invalid.',
      }
    }

    const snapshot = await readGitWorkspaceSnapshot(projectPath)
    if (!snapshot.isGitRepository) {
      const reason = snapshot.error || 'Not a git repository.'
      return {
        ok: false,
        checkedAt,
        command: '',
        output: reason,
        exitCode: null,
        error: reason,
      }
    }

    const resolvedPath = await resolveGitFilePath(projectPath, normalizedFilePath)
    if (!resolvedPath) {
      return {
        ok: false,
        checkedAt,
        command: '',
        output: 'Failed to resolve conflicted file path safely.',
        exitCode: null,
        error: 'Failed to resolve conflicted file path safely.',
      }
    }

    try {
      await writeFile(resolvedPath, content, { encoding: 'utf-8' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        checkedAt,
        command: '',
        output: message,
        exitCode: null,
        error: message,
      }
    }

    if (!markResolved) {
      return {
        ok: true,
        checkedAt,
        command: `write ${normalizedFilePath}`,
        output: 'Conflict content saved to working tree.',
        exitCode: 0,
      }
    }

    const args = ['add', '--', normalizedFilePath]
    const execution = await runGitCommand(projectPath, args, {
      stdoutLimitBytes: DEFAULT_GIT_OUTPUT_LIMIT_BYTES,
      stderrLimitBytes: DEFAULT_GIT_OUTPUT_LIMIT_BYTES,
    })
    const output = normalizeGitOperationOutput(execution.stdout, execution.stderr, {
      stdoutLimit: execution.stdoutLimit,
      stderrLimit: execution.stderrLimit,
    })
    const ok = execution.code === 0
    return {
      ok,
      checkedAt,
      command: formatGitCommand(args),
      output: ok ? 'Conflict content saved and staged as resolved.' : output,
      exitCode: execution.code,
      error: ok ? undefined : output,
    }
  }

  async function setGitFileStage(request: GitSetFileStageRequest): Promise<GitSetFileStageResult> {
    const checkedAt = Date.now()
    const projectPath = request.projectPath.trim()
    const filePath = request.filePath.trim()
    const stage = request.stage

    if (!projectPath) {
      return {
        ok: false,
        checkedAt,
        command: '',
        output: 'Project path is required.',
        exitCode: null,
        error: 'Project path is required.',
      }
    }
    if (!filePath) {
      return {
        ok: false,
        checkedAt,
        command: '',
        output: 'File path is required.',
        exitCode: null,
        error: 'File path is required.',
      }
    }

    const snapshot = await readGitWorkspaceSnapshot(projectPath)
    if (!snapshot.isGitRepository) {
      const reason = snapshot.error || 'Not a git repository.'
      return {
        ok: false,
        checkedAt,
        command: '',
        output: reason,
        exitCode: null,
        error: reason,
      }
    }

    if (stage) {
      const args = ['add', '--', filePath]
      const execution = await runGitCommand(projectPath, args, {
        stdoutLimitBytes: DEFAULT_GIT_OUTPUT_LIMIT_BYTES,
        stderrLimitBytes: DEFAULT_GIT_OUTPUT_LIMIT_BYTES,
      })
      const output = normalizeGitOperationOutput(execution.stdout, execution.stderr, {
        stdoutLimit: execution.stdoutLimit,
        stderrLimit: execution.stderrLimit,
      })
      const ok = execution.code === 0
      return {
        ok,
        checkedAt,
        command: formatGitCommand(args),
        output,
        exitCode: execution.code,
        error: ok ? undefined : output,
      }
    }

    const fallbackArgs: string[][] = [
      ['restore', '--staged', '--', filePath],
      ['reset', 'HEAD', '--', filePath],
      ['rm', '--cached', '--', filePath],
    ]

    let lastExecution: GitCommandExecutionResult | null = null
    let lastCommand = ''
    for (const args of fallbackArgs) {
      const execution = await runGitCommand(projectPath, args, {
        stdoutLimitBytes: DEFAULT_GIT_OUTPUT_LIMIT_BYTES,
        stderrLimitBytes: DEFAULT_GIT_OUTPUT_LIMIT_BYTES,
      })
      const ok = execution.code === 0
      if (ok) {
        return {
          ok: true,
          checkedAt,
          command: formatGitCommand(args),
          output: normalizeGitOperationOutput(execution.stdout, execution.stderr, {
            stdoutLimit: execution.stdoutLimit,
            stderrLimit: execution.stderrLimit,
          }),
          exitCode: execution.code,
        }
      }
      lastExecution = execution
      lastCommand = formatGitCommand(args)
    }

    const output = lastExecution
      ? normalizeGitOperationOutput(lastExecution.stdout, lastExecution.stderr, {
        stdoutLimit: lastExecution.stdoutLimit,
        stderrLimit: lastExecution.stderrLimit,
      })
      : 'Unstage operation failed.'
    return {
      ok: false,
      checkedAt,
      command: lastCommand,
      output,
      exitCode: lastExecution?.code ?? null,
      error: output,
    }
  }

  async function getGitFileDiff(request: GitFileDiffRequest): Promise<GitFileDiffResult> {
    const checkedAt = Date.now()
    const projectPath = request.projectPath.trim()
    const filePath = request.filePath.trim()
    const staged = Boolean(request.staged)

    if (!projectPath) {
      return {
        ok: false,
        checkedAt,
        command: '',
        output: 'Project path is required.',
        exitCode: null,
        staged,
        error: 'Project path is required.',
      }
    }
    if (!filePath) {
      return {
        ok: false,
        checkedAt,
        command: '',
        output: 'File path is required.',
        exitCode: null,
        staged,
        error: 'File path is required.',
      }
    }

    const snapshot = await readGitWorkspaceSnapshot(projectPath)
    if (!snapshot.isGitRepository) {
      const reason = snapshot.error || 'Not a git repository.'
      return {
        ok: false,
        checkedAt,
        command: '',
        output: reason,
        exitCode: null,
        staged,
        error: reason,
      }
    }

    const changedFile = snapshot.changedFiles.find((file) => file.path === filePath)
    const shouldTryUntrackedFallback = !staged && changedFile?.scope === 'untracked'

    let args = staged
      ? ['diff', '--cached', '--', filePath]
      : ['diff', '--', filePath]
    let execution = await runGitCommand(projectPath, args, {
      stdoutLimitBytes: GIT_DIFF_OUTPUT_LIMIT_BYTES,
      stderrLimitBytes: DEFAULT_GIT_OUTPUT_LIMIT_BYTES,
    })
    let ok = execution.code === 0
    let output = normalizeGitDiffOutput(appendGitOutputLimitNotice(execution.stdout, execution.stdoutLimit, 'diff output'))
    let errorText = ok
      ? undefined
      : normalizeGitOperationOutput(execution.stdout, execution.stderr, {
        stdoutLimit: execution.stdoutLimit,
        stderrLimit: execution.stderrLimit,
      }) || undefined

    if (shouldTryUntrackedFallback && ok && !output) {
      const existsInWorkingTree = await fileExistsAtCwd(projectPath, filePath)
      if (existsInWorkingTree) {
        const nullDevicePath = process.platform === 'win32' ? 'NUL' : '/dev/null'
        args = ['diff', '--no-index', '--', nullDevicePath, filePath]
        const untrackedDiff = await runGitCommand(projectPath, args, {
          stdoutLimitBytes: GIT_DIFF_OUTPUT_LIMIT_BYTES,
          stderrLimitBytes: DEFAULT_GIT_OUTPUT_LIMIT_BYTES,
        })
        if (untrackedDiff.code === 0 || untrackedDiff.code === 1) {
          execution = untrackedDiff
          ok = true
          output = normalizeGitDiffOutput(appendGitOutputLimitNotice(untrackedDiff.stdout, untrackedDiff.stdoutLimit, 'diff output'))
          errorText = undefined
        }
      }
    }

    if (ok && !output && changedFile && changedFile.scope !== 'conflicted') {
      const eolInfo = await readGitFileEolInfo(projectPath, filePath)
      output = buildEmptyGitDiffHint(filePath, changedFile, eolInfo)
    }

    return {
      ok,
      checkedAt,
      command: formatGitCommand(args),
      output,
      exitCode: execution.code,
      staged,
      error: errorText,
      outputLimit: execution.stdoutLimit,
    }
  }

  async function runGitOperation(request: GitOperationRequest): Promise<GitOperationResult> {
    const checkedAt = Date.now()
    const operation = request.operation
    const projectPath = request.projectPath.trim()
    const targetBranch = request.targetBranch?.trim()
    const remoteName = normalizeRemoteName(request.remoteName)

    if (!projectPath) {
      return {
        operation,
        ok: false,
        checkedAt,
        command: '',
        output: 'Project path is required.',
        exitCode: null,
        error: 'Project path is required.',
      }
    }

    const snapshot = await readGitWorkspaceSnapshot(projectPath)
    if (!snapshot.isGitRepository) {
      const reason = snapshot.error || 'Not a git repository.'
      return {
        operation,
        ok: false,
        checkedAt,
        command: '',
        output: reason,
        exitCode: null,
        error: reason,
      }
    }

    const currentBranch = snapshot.branch.current
    const hasConflicts = snapshot.changedFiles.some((file) => file.scope === 'conflicted')
    const hasWorkingTreeChanges = snapshot.changedFiles.length > 0
    const branchUpstream = snapshot.branch.upstream
    const hasUpstream = Boolean(branchUpstream)
    const upstreamGone = snapshot.branch.upstreamGone
    const localBranchSet = new Set(snapshot.branch.localBranches)
    const remoteBranchSet = new Set(snapshot.branch.remoteBranches)
    let skipReason: string | null = null
    let args: string[] = []
    let commandSequence: string[][] | null = null
    let resolvedTargetBranch = targetBranch
    let skipAsError = false

    switch (operation) {
      case 'fetch': {
        args = ['fetch', '--prune', '--tags', '--verbose']
        break
      }
      case 'pull': {
        if (!hasUpstream) {
          skipReason = 'Current branch has no upstream tracking branch.'
          break
        }
        if (upstreamGone) {
          skipReason = `Upstream branch ${branchUpstream} is gone. Push with -u to recreate tracking.`
          break
        }
        if (hasConflicts) {
          skipReason = 'Resolve conflicts before pull.'
          break
        }
        if (hasWorkingTreeChanges) {
          skipReason = 'Working tree is not clean. Commit, stash, or discard changes before pull.'
          break
        }
        if (snapshot.branch.behind <= 0) {
          skipReason = 'No incoming commits to pull.'
          break
        }
        args = ['pull', '--ff-only']
        break
      }
      case 'push': {
        if (hasConflicts) {
          skipReason = 'Resolve conflicts before push.'
          break
        }
        if (!currentBranch || currentBranch === 'DETACHED') {
          skipReason = 'Detached HEAD cannot be pushed.'
          break
        }
        if (hasUpstream && !upstreamGone && snapshot.branch.ahead <= 0) {
          skipReason = 'No outgoing commits to push.'
          break
        }
        args = hasUpstream && !upstreamGone
          ? ['push']
          : ['push', '-u', 'origin', currentBranch]
        break
      }
      case 'merge': {
        if (hasConflicts) {
          skipReason = 'Resolve conflicts before merge.'
          break
        }
        if (hasWorkingTreeChanges) {
          skipReason = 'Working tree is not clean. Commit, stash, or discard changes before merge.'
          break
        }
        if (!targetBranch) {
          skipReason = 'Select a branch to merge from.'
          break
        }
        if (targetBranch === currentBranch) {
          skipReason = 'Cannot merge current branch into itself.'
          break
        }
        args = ['merge', '--no-edit', targetBranch]
        break
      }
      case 'switch': {
        if (hasConflicts) {
          skipReason = 'Resolve conflicts before switching branch.'
          break
        }
        if (!targetBranch) {
          skipReason = 'Select a branch to switch to.'
          break
        }
        if (targetBranch === currentBranch) {
          skipReason = 'Already on the selected branch.'
          break
        }

        if (localBranchSet.has(targetBranch)) {
          args = ['switch', targetBranch]
          break
        }

        const remoteMatch = targetBranch.match(/^([^/]+)\/(.+)$/)
        if (!remoteMatch) {
          skipReason = 'Target branch must be a local branch name or a remote-qualified branch like origin/feature/x.'
          break
        }

        const remoteRef = targetBranch
        const localBranchName = remoteMatch[2]
        resolvedTargetBranch = localBranchName

        if (!isValidGitBranchName(localBranchName)) {
          skipReason = `Invalid local branch name derived from remote ref: ${localBranchName}.`
          break
        }

        if (!remoteBranchSet.has(remoteRef)) {
          if (localBranchSet.has(localBranchName)) {
            skipReason = `Remote branch ${remoteRef} not found, cannot rebind upstream for existing local branch ${localBranchName}.`
            skipAsError = true
            break
          }
          skipReason = `Remote branch ${remoteRef} not found.`
          break
        }

        if (localBranchSet.has(localBranchName)) {
          commandSequence = [
            ['switch', localBranchName],
            ['branch', `--set-upstream-to=${remoteRef}`, localBranchName],
          ]
          break
        }

        args = ['switch', '--track', targetBranch]
        break
      }
      case 'create-remote-branch': {
        if (!currentBranch || currentBranch === 'DETACHED') {
          skipReason = 'Detached HEAD cannot create remote branch.'
          break
        }
        if (!targetBranch) {
          skipReason = 'Enter branch name to create on remote.'
          break
        }
        if (!isValidGitBranchName(targetBranch)) {
          skipReason = 'Invalid branch name.'
          break
        }

        const remoteCandidates = new Set(snapshot.branch.remoteBranches)
        const remoteRef = `${remoteName}/${targetBranch}`
        if (remoteCandidates.has(remoteRef)) {
          skipReason = 'Remote branch already exists.'
          break
        }

        args = ['push', '--set-upstream', remoteName, `${currentBranch}:${targetBranch}`]
        break
      }
      case 'create-local-branch': {
        if (!targetBranch) {
          skipReason = 'Enter local branch name to create.'
          break
        }
        if (!isValidGitBranchName(targetBranch)) {
          skipReason = 'Invalid branch name.'
          break
        }
        if (snapshot.branch.localBranches.includes(targetBranch)) {
          skipReason = 'Local branch already exists.'
          break
        }
        const remoteRef = `${remoteName}/${targetBranch}`
        if (snapshot.branch.remoteBranches.includes(remoteRef)) {
          args = ['branch', '--track', targetBranch, remoteRef]
          break
        }
        args = ['branch', targetBranch]
        break
      }
      case 'delete-local-branch': {
        if (!targetBranch) {
          skipReason = 'Select local branch to delete.'
          break
        }
        if (targetBranch === currentBranch) {
          skipReason = 'Cannot delete current branch.'
          break
        }
        if (!snapshot.branch.localBranches.includes(targetBranch)) {
          skipReason = 'Local branch not found.'
          break
        }
        args = ['branch', '-d', targetBranch]
        break
      }
      case 'set-upstream': {
        if (!currentBranch || currentBranch === 'DETACHED') {
          skipReason = 'Detached HEAD cannot set upstream.'
          break
        }
        if (!targetBranch) {
          skipReason = 'Select upstream branch to set.'
          break
        }
        const remoteRef = targetBranch.includes('/') ? targetBranch : `${remoteName}/${targetBranch}`
        if (!remoteBranchSet.has(remoteRef)) {
          skipReason = `Remote branch ${remoteRef} not found. Run fetch first or verify remote name.`
          break
        }
        args = ['branch', `--set-upstream-to=${remoteRef}`, currentBranch]
        break
      }
      default: {
        const unreachable: never = operation
        return {
          operation: unreachable,
          ok: false,
          checkedAt,
          command: '',
          output: `Unsupported git operation: ${String(unreachable)}`,
          exitCode: null,
          error: 'Unsupported git operation.',
        }
      }
    }

    if (skipReason) {
      return {
        operation,
        ok: false,
        checkedAt,
        command: '',
        output: skipReason,
        exitCode: null,
        skipped: skipAsError ? undefined : true,
        error: skipReason,
        targetBranch: resolvedTargetBranch,
      }
    }

    let ok: boolean
    let output: string
    let exitCode: number | null
    let command: string
    let error: string | undefined

    if (commandSequence && commandSequence.length > 0) {
      const sequenceResult = await runGitCommandSequence(projectPath, commandSequence)
      ok = sequenceResult.ok
      output = sequenceResult.output
      exitCode = sequenceResult.exitCode
      command = sequenceResult.command
      error = sequenceResult.error
    } else {
      const execution = await runGitCommand(projectPath, args, {
        stdoutLimitBytes: DEFAULT_GIT_OUTPUT_LIMIT_BYTES,
        stderrLimitBytes: DEFAULT_GIT_OUTPUT_LIMIT_BYTES,
      })
      output = normalizeGitOperationOutput(execution.stdout, execution.stderr, {
        stdoutLimit: execution.stdoutLimit,
        stderrLimit: execution.stderrLimit,
      })
      ok = execution.code === 0
      exitCode = execution.code
      command = formatGitCommand(args)
      error = ok ? undefined : output
    }

    return {
      operation,
      ok,
      checkedAt,
      command,
      output,
      exitCode,
      error,
      targetBranch: resolvedTargetBranch,
    }
  }

  return {
    readRecentCommits,
    readGitWorkspaceSnapshot,
    runGitOperation,
    setGitFileStage,
    getGitFileDiff,
    getGitConflictFile,
    resolveGitConflictFile,
  }
}
