import { constants as FsConstants } from 'fs'
import { access, readFile, writeFile, realpath, stat } from 'fs/promises'
import { join } from 'path'
import {
  appendGitOutputLimitNotice,
  DEFAULT_GIT_OUTPUT_LIMIT_BYTES,
  formatGitCommand,
  normalizeGitDiffOutput,
  normalizeGitOperationOutput,
  type GitCommandExecutionResult,
  type GitCommandRunner,
} from './git-command'
import type {
  GitChangedFile,
  GitConflictFileRequest,
  GitConflictFileResult,
  GitConflictStageContent,
  GitFileDiffRequest,
  GitFileDiffResult,
  GitRepositorySnapshot,
  GitResolveConflictRequest,
  GitResolveConflictResult,
  GitSetFileStageRequest,
  GitSetFileStageResult,
} from '../../../shared/types'

const GIT_DIFF_OUTPUT_LIMIT_BYTES = 512 * 1024
const GIT_CONFLICT_STAGE_OUTPUT_LIMIT_BYTES = 512 * 1024
const GIT_CONFLICT_WORKTREE_MAX_FILE_BYTES = 1024 * 1024

type GitFileOperationDependencies = {
  runner: GitCommandRunner
  readGitRepositorySnapshot: (repoRoot: string) => Promise<GitRepositorySnapshot>
}

function firstNonEmptyLine(input: string): string | undefined {
  const lines = input
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
  return lines.find(Boolean)
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

async function resolveGitFilePath(repoRoot: string, filePath: string): Promise<string | null> {
  const normalized = normalizeGitRelativePath(filePath)
  if (!normalized) return null
  try {
    const rootRealPath = await realpath(repoRoot)
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

function hasConflictMarker(content: string): boolean {
  const normalized = content.replace(/\r/g, '')
  return normalized.includes('\n<<<<<<< ') || normalized.startsWith('<<<<<<< ')
}

export function createGitFileOperations({
  runner,
  readGitRepositorySnapshot,
}: GitFileOperationDependencies) {
  const { runGitCommand } = runner

  async function readGitFileEolInfo(cwd: string, filePath: string): Promise<string | undefined> {
    const result = await runGitCommand(cwd, ['ls-files', '--eol', '--', filePath])
    if (result.code !== 0) return undefined
    return firstNonEmptyLine(result.stdout)
  }

  async function readGitShowStageContent(
    repoRoot: string,
    filePath: string,
    stage: 1 | 2 | 3
  ): Promise<GitConflictStageContent> {
    const spec = `:${stage}:${filePath}`
    const args = ['show', '--textconv', spec]
    const execution = await runGitCommand(repoRoot, args, {
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

  async function getGitConflictFile(request: GitConflictFileRequest): Promise<GitConflictFileResult> {
    const checkedAt = Date.now()
    const repoRoot = request.repoRoot.trim()
    const normalizedFilePath = normalizeGitRelativePath(request.filePath)
    const filePath = normalizedFilePath ?? ''

    if (!repoRoot) {
      return {
        repoRoot,
        ok: false,
        checkedAt,
        command: '',
        output: 'Repository root is required.',
        exitCode: null,
        filePath,
        workingTreeContent: '',
        hasConflictMarkers: false,
        stageContents: [],
        error: 'Repository root is required.',
      }
    }
    if (!normalizedFilePath) {
      return {
        repoRoot,
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

    const snapshot = await readGitRepositorySnapshot(repoRoot)
    if (!snapshot.isGitRepository) {
      const reason = snapshot.error || 'Not a git repository.'
      return {
        repoRoot: snapshot.repoRoot || repoRoot,
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
    const resolvedRepoRoot = snapshot.repoRoot

    const conflictFile = snapshot.changedFiles.find((file) => file.path === normalizedFilePath && file.scope === 'conflicted')
    if (!conflictFile) {
      return {
        repoRoot: resolvedRepoRoot,
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

    const resolvedPath = await resolveGitFilePath(resolvedRepoRoot, normalizedFilePath)
    if (!resolvedPath) {
      return {
        repoRoot: resolvedRepoRoot,
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
          repoRoot: resolvedRepoRoot,
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
        repoRoot: resolvedRepoRoot,
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
      readGitShowStageContent(resolvedRepoRoot, normalizedFilePath, 1),
      readGitShowStageContent(resolvedRepoRoot, normalizedFilePath, 2),
      readGitShowStageContent(resolvedRepoRoot, normalizedFilePath, 3),
    ])

    const errors = stageContents
      .map((item) => item.error)
      .filter((item): item is string => Boolean(item))

    const outputParts = [
      `Loaded conflict for ${normalizedFilePath}.`,
      errors.length > 0 ? `Some stages failed to load:\n${errors.join('\n')}` : '',
    ].filter(Boolean)

    return {
      repoRoot: resolvedRepoRoot,
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
    const repoRoot = request.repoRoot.trim()
    const normalizedFilePath = normalizeGitRelativePath(request.filePath)
    const content = request.content ?? ''
    const markResolved = request.markResolved !== false

    if (!repoRoot) {
      return {
        repoRoot,
        ok: false,
        checkedAt,
        command: '',
        output: 'Repository root is required.',
        exitCode: null,
        error: 'Repository root is required.',
      }
    }
    if (!normalizedFilePath) {
      return {
        repoRoot,
        ok: false,
        checkedAt,
        command: '',
        output: 'File path is invalid.',
        exitCode: null,
        error: 'File path is invalid.',
      }
    }

    const snapshot = await readGitRepositorySnapshot(repoRoot)
    if (!snapshot.isGitRepository) {
      const reason = snapshot.error || 'Not a git repository.'
      return {
        repoRoot: snapshot.repoRoot || repoRoot,
        ok: false,
        checkedAt,
        command: '',
        output: reason,
        exitCode: null,
        error: reason,
      }
    }
    const resolvedRepoRoot = snapshot.repoRoot

    const resolvedPath = await resolveGitFilePath(resolvedRepoRoot, normalizedFilePath)
    if (!resolvedPath) {
      return {
        repoRoot: resolvedRepoRoot,
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
        repoRoot: resolvedRepoRoot,
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
        repoRoot: resolvedRepoRoot,
        ok: true,
        checkedAt,
        command: `write ${normalizedFilePath}`,
        output: 'Conflict content saved to working tree.',
        exitCode: 0,
      }
    }

    const args = ['add', '--', normalizedFilePath]
    const execution = await runGitCommand(resolvedRepoRoot, args, {
      stdoutLimitBytes: DEFAULT_GIT_OUTPUT_LIMIT_BYTES,
      stderrLimitBytes: DEFAULT_GIT_OUTPUT_LIMIT_BYTES,
    })
    const output = normalizeGitOperationOutput(execution.stdout, execution.stderr, {
      stdoutLimit: execution.stdoutLimit,
      stderrLimit: execution.stderrLimit,
    })
    const ok = execution.code === 0
    return {
      repoRoot: resolvedRepoRoot,
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
    const repoRoot = request.repoRoot.trim()
    const filePath = normalizeGitRelativePath(request.filePath)
    const stage = request.stage

    if (!repoRoot) {
      return {
        repoRoot,
        ok: false,
        checkedAt,
        command: '',
        output: 'Repository root is required.',
        exitCode: null,
        error: 'Repository root is required.',
      }
    }
    if (!filePath) {
      return {
        repoRoot,
        ok: false,
        checkedAt,
        command: '',
        output: 'File path is invalid.',
        exitCode: null,
        error: 'File path is invalid.',
      }
    }

    const snapshot = await readGitRepositorySnapshot(repoRoot)
    if (!snapshot.isGitRepository) {
      const reason = snapshot.error || 'Not a git repository.'
      return {
        repoRoot: snapshot.repoRoot || repoRoot,
        ok: false,
        checkedAt,
        command: '',
        output: reason,
        exitCode: null,
        error: reason,
      }
    }
    const resolvedRepoRoot = snapshot.repoRoot

    if (stage) {
      const args = ['add', '--', filePath]
      const execution = await runGitCommand(resolvedRepoRoot, args, {
        stdoutLimitBytes: DEFAULT_GIT_OUTPUT_LIMIT_BYTES,
        stderrLimitBytes: DEFAULT_GIT_OUTPUT_LIMIT_BYTES,
      })
      const output = normalizeGitOperationOutput(execution.stdout, execution.stderr, {
        stdoutLimit: execution.stdoutLimit,
        stderrLimit: execution.stderrLimit,
      })
      const ok = execution.code === 0
      return {
        repoRoot: resolvedRepoRoot,
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
      const execution = await runGitCommand(resolvedRepoRoot, args, {
        stdoutLimitBytes: DEFAULT_GIT_OUTPUT_LIMIT_BYTES,
        stderrLimitBytes: DEFAULT_GIT_OUTPUT_LIMIT_BYTES,
      })
      const ok = execution.code === 0
      if (ok) {
        return {
          repoRoot: resolvedRepoRoot,
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
      repoRoot: resolvedRepoRoot,
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
    const repoRoot = request.repoRoot.trim()
    const filePath = normalizeGitRelativePath(request.filePath)
    const staged = Boolean(request.staged)

    if (!repoRoot) {
      return {
        repoRoot,
        ok: false,
        checkedAt,
        command: '',
        output: 'Repository root is required.',
        exitCode: null,
        staged,
        error: 'Repository root is required.',
      }
    }
    if (!filePath) {
      return {
        repoRoot,
        ok: false,
        checkedAt,
        command: '',
        output: 'File path is invalid.',
        exitCode: null,
        staged,
        error: 'File path is invalid.',
      }
    }

    const snapshot = await readGitRepositorySnapshot(repoRoot)
    if (!snapshot.isGitRepository) {
      const reason = snapshot.error || 'Not a git repository.'
      return {
        repoRoot: snapshot.repoRoot || repoRoot,
        ok: false,
        checkedAt,
        command: '',
        output: reason,
        exitCode: null,
        staged,
        error: reason,
      }
    }
    const resolvedRepoRoot = snapshot.repoRoot

    const changedFile = snapshot.changedFiles.find((file) => file.path === filePath)
    const shouldTryUntrackedFallback = !staged && changedFile?.scope === 'untracked'

    let args = staged
      ? ['diff', '--cached', '--', filePath]
      : ['diff', '--', filePath]
    let execution = await runGitCommand(resolvedRepoRoot, args, {
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
      const existsInWorkingTree = await fileExistsAtCwd(resolvedRepoRoot, filePath)
      if (existsInWorkingTree) {
        const nullDevicePath = process.platform === 'win32' ? 'NUL' : '/dev/null'
        args = ['diff', '--no-index', '--', nullDevicePath, filePath]
        const untrackedDiff = await runGitCommand(resolvedRepoRoot, args, {
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
      const eolInfo = await readGitFileEolInfo(resolvedRepoRoot, filePath)
      output = buildEmptyGitDiffHint(filePath, changedFile, eolInfo)
    }

    return {
      repoRoot: resolvedRepoRoot,
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

  return {
    setGitFileStage,
    getGitFileDiff,
    getGitConflictFile,
    resolveGitConflictFile,
  }
}
