import {
  createGitCommandRunner,
  DEFAULT_GIT_OUTPUT_LIMIT_BYTES,
  DEFAULT_GIT_OPERATION_TIMEOUT_MS,
  formatGitCommand,
  normalizeGitOperationOutput,
} from './git-command'
import { createGitFileOperations } from './git-file-operations'
import { listGitRepositories } from './git-repositories'
import { createGitSnapshotReader } from './git-snapshot'
import type { GitOperationRequest, GitOperationResult } from '../../../shared/types'

type GitServiceDependencies = {
  getDefaultWslDistro: () => string
}

export function createGitService(deps: GitServiceDependencies) {
  const getDefaultWslDistro = () => deps.getDefaultWslDistro() || 'Ubuntu'
  const gitCommandRunner = createGitCommandRunner({ getDefaultWslDistro })
  const { runGitCommand, runGitCommandSequence } = gitCommandRunner
  const { readRecentCommits, readGitRepositorySnapshot } = createGitSnapshotReader(gitCommandRunner)
  const {
    getGitConflictFile,
    getGitFileDiff,
    resolveGitConflictFile,
    setGitFileStage,
  } = createGitFileOperations({
    runner: gitCommandRunner,
    readGitRepositorySnapshot,
  })

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

  async function runGitOperation(request: GitOperationRequest): Promise<GitOperationResult> {
    const checkedAt = Date.now()
    const operation = request.operation
    const repoRoot = request.repoRoot.trim()
    const targetBranch = request.targetBranch?.trim()
    const remoteName = normalizeRemoteName(request.remoteName)

    if (!repoRoot) {
      return {
        repoRoot,
        operation,
        ok: false,
        checkedAt,
        command: '',
        output: 'Repository root is required.',
        exitCode: null,
        error: 'Repository root is required.',
      }
    }

    const snapshot = await readGitRepositorySnapshot(repoRoot)
    if (!snapshot.isGitRepository) {
      const reason = snapshot.error || 'Not a git repository.'
      return {
        repoRoot: snapshot.repoRoot || repoRoot,
        operation,
        ok: false,
        checkedAt,
        command: '',
        output: reason,
        exitCode: null,
        error: reason,
      }
    }
    const resolvedRepoRoot = snapshot.repoRoot

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
          repoRoot: resolvedRepoRoot,
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
        repoRoot: resolvedRepoRoot,
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
      const sequenceResult = await runGitCommandSequence(resolvedRepoRoot, commandSequence)
      ok = sequenceResult.ok
      output = sequenceResult.output
      exitCode = sequenceResult.exitCode
      command = sequenceResult.command
      error = sequenceResult.error
    } else {
      const execution = await runGitCommand(resolvedRepoRoot, args, {
        stdoutLimitBytes: DEFAULT_GIT_OUTPUT_LIMIT_BYTES,
        stderrLimitBytes: DEFAULT_GIT_OUTPUT_LIMIT_BYTES,
        timeoutMs: DEFAULT_GIT_OPERATION_TIMEOUT_MS,
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
      repoRoot: resolvedRepoRoot,
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
    listGitRepositories,
    readRecentCommits,
    readGitRepositorySnapshot,
    runGitOperation,
    setGitFileStage,
    getGitFileDiff,
    getGitConflictFile,
    resolveGitConflictFile,
  }
}

export type GitService = ReturnType<typeof createGitService>
