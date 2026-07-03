import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BranchManagerMode } from './detail.aiCommitPanel.types'
import type { DetailGitSnapshot, GitOperationKind, GitOperationResult } from './detail.types'

type TranslateFn = (key: string, values?: Record<string, number | string>) => string

type UseDetailBranchManagerStateArgs = {
  activePane: 'code' | 'aicommit'
  branchUpstream: string | undefined
  gitSnapshot: DetailGitSnapshot | null
  onOperationResult: (result: GitOperationResult) => void
  onRefreshGitSnapshot: () => void | Promise<void>
  t: TranslateFn
}

export function useDetailBranchManagerState({
  activePane,
  branchUpstream,
  gitSnapshot,
  onOperationResult,
  onRefreshGitSnapshot,
  t,
}: UseDetailBranchManagerStateArgs) {
  const [branchManagerMode, setBranchManagerMode] = useState<BranchManagerMode | null>(null)
  const [gitGuideOpen, setGitGuideOpen] = useState(false)
  const [currentManagerInput, setCurrentManagerInput] = useState('')
  const [currentManagerDeleteTarget, setCurrentManagerDeleteTarget] = useState('')
  const [upstreamManagerRemoteName, setUpstreamManagerRemoteName] = useState('origin')
  const [upstreamManagerBranchName, setUpstreamManagerBranchName] = useState('')
  const [upstreamManagerDangerInput, setUpstreamManagerDangerInput] = useState('')
  const [branchManagerLoading, setBranchManagerLoading] = useState(false)
  const [branchManagerError, setBranchManagerError] = useState<string | null>(null)
  const currentBranchInputRef = useRef<HTMLInputElement | null>(null)
  const upstreamBranchInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (activePane === 'aicommit') return
    setBranchManagerMode(null)
    setGitGuideOpen(false)
  }, [activePane])

  useEffect(() => {
    if (!branchManagerMode) return
    setBranchManagerError(null)
    if (branchManagerMode === 'current') {
      setCurrentManagerDeleteTarget('')
      setCurrentManagerInput('')
      return
    }

    const upstream = branchUpstream || ''
    const match = upstream.match(/^([^/]+)\/(.+)$/)
    if (match) {
      setUpstreamManagerRemoteName(match[1])
      setUpstreamManagerBranchName(match[2])
    } else {
      setUpstreamManagerRemoteName('origin')
      setUpstreamManagerBranchName('')
    }
    setUpstreamManagerDangerInput('')
  }, [branchManagerMode, branchUpstream])

  useEffect(() => {
    if (!branchManagerMode) return
    const targetRef = branchManagerMode === 'current' ? currentBranchInputRef : upstreamBranchInputRef
    const frame = window.requestAnimationFrame(() => {
      targetRef.current?.focus()
    })
    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [branchManagerMode])

  const branchManagerDangerText = `${(upstreamManagerRemoteName.trim() || 'origin')}/${upstreamManagerBranchName.trim()}`

  const runBranchManagerOperation = useCallback(async (request: {
    operation: GitOperationKind
    targetBranch?: string
    remoteName?: string
  }): Promise<GitOperationResult> => {
    if (!gitSnapshot) {
      return {
        repoRoot: '',
        operation: request.operation,
        ok: false,
        checkedAt: Date.now(),
        command: '',
        output: t('detail.gitSnapshotUnavailable'),
        exitCode: null,
        error: t('detail.gitSnapshotUnavailable'),
      }
    }

    return window.electronAPI.runGitOperation({
      repoRoot: gitSnapshot.repoRoot,
      operation: request.operation,
      targetBranch: request.targetBranch,
      remoteName: request.remoteName,
    })
  }, [gitSnapshot, t])

  const runManagedOperation = useCallback(async (
    request: {
      operation: GitOperationKind
      targetBranch?: string
      remoteName?: string
    },
    onSuccess: () => void,
    failureKey: string,
  ) => {
    setBranchManagerLoading(true)
    setBranchManagerError(null)
    try {
      const result = await runBranchManagerOperation(request)
      onOperationResult(result)
      if (!result.ok) {
        setBranchManagerError(result.error || result.output || t(failureKey))
        return
      }
      onSuccess()
    } catch (error) {
      setBranchManagerError(error instanceof Error ? error.message : String(error))
    } finally {
      await onRefreshGitSnapshot()
      setBranchManagerLoading(false)
    }
  }, [onOperationResult, onRefreshGitSnapshot, runBranchManagerOperation, t])

  const handleCreateLocalBranch = useCallback(async () => {
    const branchName = currentManagerInput.trim()
    if (!branchName || branchManagerLoading) return
    await runManagedOperation(
      { operation: 'create-local-branch', targetBranch: branchName },
      () => setCurrentManagerInput(''),
      'detail.gitBranchCreateLocalFailed',
    )
  }, [branchManagerLoading, currentManagerInput, runManagedOperation])

  const handleDeleteLocalBranch = useCallback(async () => {
    const branchName = currentManagerDeleteTarget.trim()
    if (!branchName || branchManagerLoading) return
    await runManagedOperation(
      { operation: 'delete-local-branch', targetBranch: branchName },
      () => setCurrentManagerDeleteTarget(''),
      'detail.gitBranchDeleteLocalFailed',
    )
  }, [branchManagerLoading, currentManagerDeleteTarget, runManagedOperation])

  const handleSetUpstream = useCallback(async () => {
    const remoteName = upstreamManagerRemoteName.trim() || 'origin'
    const branchName = upstreamManagerBranchName.trim()
    if (!branchName || branchManagerLoading) return
    if (upstreamManagerDangerInput.trim() !== branchManagerDangerText) return
    await runManagedOperation(
      { operation: 'set-upstream', targetBranch: branchName, remoteName },
      () => {
        setUpstreamManagerDangerInput('')
        setBranchManagerMode(null)
      },
      'detail.gitBranchSetUpstreamFailed',
    )
  }, [
    branchManagerDangerText,
    branchManagerLoading,
    runManagedOperation,
    upstreamManagerBranchName,
    upstreamManagerDangerInput,
    upstreamManagerRemoteName,
  ])

  const handleCreateRemoteBranchFromUpstream = useCallback(async () => {
    const remoteName = upstreamManagerRemoteName.trim() || 'origin'
    const branchName = upstreamManagerBranchName.trim()
    if (!branchName || branchManagerLoading) return
    if (upstreamManagerDangerInput.trim() !== branchManagerDangerText) return
    await runManagedOperation(
      { operation: 'create-remote-branch', targetBranch: branchName, remoteName },
      () => {
        setUpstreamManagerDangerInput('')
        setBranchManagerMode(null)
      },
      'detail.gitBranchCreateRemoteFailed',
    )
  }, [
    branchManagerDangerText,
    branchManagerLoading,
    runManagedOperation,
    upstreamManagerBranchName,
    upstreamManagerDangerInput,
    upstreamManagerRemoteName,
  ])

  return {
    branchManagerDangerText,
    branchManagerError,
    branchManagerLoading,
    branchManagerMode,
    currentBranchInputRef,
    currentManagerDeleteTarget,
    currentManagerInput,
    gitGuideOpen,
    handleCreateLocalBranch,
    handleCreateRemoteBranchFromUpstream,
    handleDeleteLocalBranch,
    handleSetUpstream,
    setBranchManagerMode,
    setCurrentManagerDeleteTarget,
    setCurrentManagerInput,
    setGitGuideOpen,
    setUpstreamManagerBranchName,
    setUpstreamManagerDangerInput,
    setUpstreamManagerRemoteName,
    upstreamBranchInputRef,
    upstreamManagerBranchName,
    upstreamManagerDangerInput,
    upstreamManagerRemoteName,
  }
}
