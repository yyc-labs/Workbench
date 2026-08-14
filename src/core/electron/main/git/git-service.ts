import { createGitCommandRunner, DEFAULT_GIT_OUTPUT_LIMIT_BYTES, DEFAULT_GIT_OPERATION_TIMEOUT_MS, formatGitCommand, normalizeGitOperationOutput } from './git-command'
import { createGitFileOperations } from './git-file-operations'
import { isValidGitBranchName, normalizeGitOperationRequest } from './git-operation-request'
import { listGitRepositories } from './git-repositories'
import { createGitSnapshotReader } from './git-snapshot'
import type { GitOperationRequest, GitOperationResult } from '../../../shared/types'
import { translateMain, type MainLocale } from '../mainI18n'

type GitServiceDependencies = {
  getDefaultWslDistro: () => string
  getLocale: () => MainLocale
}

export function createGitService(deps: GitServiceDependencies) {
  const getDefaultWslDistro = () => deps.getDefaultWslDistro() || 'Ubuntu'
  const gitCommandRunner = createGitCommandRunner({ getDefaultWslDistro })
  const { runGitCommand, runGitCommandSequence } = gitCommandRunner
  const { readRecentCommits, readGitRepositorySnapshot } = createGitSnapshotReader(gitCommandRunner)
  const { getGitConflictFile, getGitFileDiff, resolveGitConflictFile, setGitFileStage } = createGitFileOperations({
    runner: gitCommandRunner,
    getLocale: deps.getLocale,
    readGitRepositorySnapshot,
  })

  async function runGitOperation(request: GitOperationRequest): Promise<GitOperationResult> {
    const checkedAt = Date.now()
    const { expectedHead, message, operation, remoteName, repoRoot, targetBranch } = normalizeGitOperationRequest(request)

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
      const reason = snapshot.error || translateMain(deps.getLocale(), 'git.notARepository')
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
    let skipCode: GitOperationResult['skipReason']
    let args: string[] = []
    let commandSequence: string[][] | null = null
    let resolvedTargetBranch = targetBranch

    const setSkipReason = (code: GitOperationResult['skipReason'], fallback: string) => {
      skipCode = code
      skipReason = fallback
    }

    switch (operation) {
      case 'fetch': {
        args = ['fetch', '--prune', '--tags', '--verbose']
        break
      }
      case 'pull': {
        if (!hasUpstream) {
          setSkipReason('missing-upstream', 'Current branch has no upstream tracking branch.')
          break
        }
        if (upstreamGone) {
          setSkipReason('upstream-gone', `Upstream branch ${branchUpstream} is gone. Push with -u to recreate tracking.`)
          break
        }
        if (hasConflicts) {
          setSkipReason('conflicts-present', 'Resolve conflicts before pull.')
          break
        }
        if (hasWorkingTreeChanges) {
          setSkipReason('dirty-worktree', 'Working tree is not clean. Commit, stash, or discard changes before pull.')
          break
        }
        if (snapshot.branch.behind <= 0) {
          setSkipReason('nothing-to-pull', 'No incoming commits to pull.')
          break
        }
        args = ['pull', '--ff-only']
        break
      }
      case 'push': {
        if (hasConflicts) {
          setSkipReason('conflicts-present', 'Resolve conflicts before push.')
          break
        }
        if (!currentBranch || currentBranch === 'DETACHED') {
          setSkipReason('detached-head', 'Detached HEAD cannot be pushed.')
          break
        }
        if (hasUpstream && !upstreamGone && snapshot.branch.ahead <= 0) {
          setSkipReason('nothing-to-push', 'No outgoing commits to push.')
          break
        }
        args = hasUpstream && !upstreamGone ? ['push'] : ['push', '-u', 'origin', currentBranch]
        break
      }
      case 'merge': {
        if (hasConflicts) {
          setSkipReason('conflicts-present', 'Resolve conflicts before merge.')
          break
        }
        if (hasWorkingTreeChanges) {
          setSkipReason('dirty-worktree', 'Working tree is not clean. Commit, stash, or discard changes before merge.')
          break
        }
        if (!targetBranch) {
          setSkipReason('target-required', 'Select a branch to merge from.')
          break
        }
        if (targetBranch === currentBranch) {
          setSkipReason('target-is-current', 'Cannot merge current branch into itself.')
          break
        }
        args = ['merge', '--no-edit', targetBranch]
        break
      }
      case 'switch': {
        if (hasConflicts) {
          setSkipReason('conflicts-present', 'Resolve conflicts before switching branch.')
          break
        }
        if (!targetBranch) {
          setSkipReason('target-required', 'Select a branch to switch to.')
          break
        }
        if (targetBranch === currentBranch) {
          setSkipReason('already-on-target', 'Already on the selected branch.')
          break
        }

        if (localBranchSet.has(targetBranch)) {
          args = ['switch', targetBranch]
          break
        }

        const remoteMatch = targetBranch.match(/^([^/]+)\/(.+)$/)
        if (!remoteMatch) {
          setSkipReason('target-not-found', 'Target branch must be a local branch name or a remote-qualified branch like origin/feature/x.')
          break
        }

        const remoteRef = targetBranch
        const localBranchName = remoteMatch[2]
        resolvedTargetBranch = localBranchName

        if (!isValidGitBranchName(localBranchName)) {
          setSkipReason('other', `Invalid local branch name derived from remote ref: ${localBranchName}.`)
          break
        }

        if (!remoteBranchSet.has(remoteRef)) {
          if (localBranchSet.has(localBranchName)) {
            setSkipReason('other', `Remote branch ${remoteRef} not found, cannot rebind upstream for existing local branch ${localBranchName}.`)
            break
          }
          setSkipReason('target-not-found', `Remote branch ${remoteRef} not found.`)
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
      case 'commit': {
        if (hasConflicts) {
          setSkipReason('conflicts-present', 'Resolve conflicts before committing.')
          break
        }
        if (!message) {
          setSkipReason('other', 'Commit message is required.')
          break
        }
        if (!snapshot.changedFiles.some((file) => file.staged)) {
          setSkipReason('other', 'There are no staged changes to commit.')
          break
        }
        args = ['commit', '-m', message]
        break
      }
      case 'undo-commit': {
        if (!expectedHead || snapshot.branch.oid !== expectedHead) {
          setSkipReason('other', 'The latest commit changed, so undo is no longer available.')
          break
        }
        args = ['reset', '--soft', 'HEAD^']
        break
      }
      case 'create-remote-branch': {
        if (!currentBranch || currentBranch === 'DETACHED') {
          setSkipReason('detached-head', 'Detached HEAD cannot create remote branch.')
          break
        }
        if (!targetBranch) {
          setSkipReason('target-required', 'Enter branch name to create on remote.')
          break
        }
        if (!isValidGitBranchName(targetBranch)) {
          setSkipReason('other', 'Invalid branch name.')
          break
        }

        const remoteCandidates = new Set(snapshot.branch.remoteBranches)
        const remoteRef = `${remoteName}/${targetBranch}`
        if (remoteCandidates.has(remoteRef)) {
          setSkipReason('already-on-target', 'Remote branch already exists.')
          break
        }

        args = ['push', '--set-upstream', remoteName, `${currentBranch}:${targetBranch}`]
        break
      }
      case 'create-local-branch': {
        if (!targetBranch) {
          setSkipReason('target-required', 'Enter local branch name to create.')
          break
        }
        if (!isValidGitBranchName(targetBranch)) {
          setSkipReason('other', 'Invalid branch name.')
          break
        }
        if (snapshot.branch.localBranches.includes(targetBranch)) {
          setSkipReason('already-on-target', 'Local branch already exists.')
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
          setSkipReason('target-required', 'Select local branch to delete.')
          break
        }
        if (targetBranch === currentBranch) {
          setSkipReason('target-is-current', 'Cannot delete current branch.')
          break
        }
        if (!snapshot.branch.localBranches.includes(targetBranch)) {
          setSkipReason('target-not-found', 'Local branch not found.')
          break
        }
        args = ['branch', '-d', targetBranch]
        break
      }
      case 'set-upstream': {
        if (!currentBranch || currentBranch === 'DETACHED') {
          setSkipReason('detached-head', 'Detached HEAD cannot set upstream.')
          break
        }
        if (!targetBranch) {
          setSkipReason('target-required', 'Select upstream branch to set.')
          break
        }
        const remoteRef = targetBranch.includes('/') ? targetBranch : `${remoteName}/${targetBranch}`
        if (!remoteBranchSet.has(remoteRef)) {
          setSkipReason('target-not-found', `Remote branch ${remoteRef} not found. Run fetch first or verify remote name.`)
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
        skipped: true,
        ...(skipCode ? { skipReason: skipCode } : {}),
        error: skipReason,
        targetBranch: resolvedTargetBranch,
      }
    }

    let ok: boolean
    let output: string
    let exitCode: number | null
    let command: string
    let error: string | undefined
    let commitHead: string | undefined

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

    if (ok && operation === 'commit') {
      const afterSnapshot = await readGitRepositorySnapshot(resolvedRepoRoot)
      commitHead = afterSnapshot.branch.oid
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
      ...(commitHead ? { commitHead } : {}),
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
