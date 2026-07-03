import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { pickDefaultDiffViewMode } from './detail.gitOperations'
import type {
  DetailGitSnapshot,
  GitConflictFileResult,
  GitDiffViewMode,
  GitFileDiffResult,
  GitResolveConflictResult,
} from './detail.types'

type GitChangedFile = DetailGitSnapshot['changedFiles'][number]
type TranslateFn = (key: string, values?: Record<string, number | string>) => string

type UseDetailGitDiffStateArgs = {
  activePane: 'code' | 'aicommit'
  changedFiles: GitChangedFile[]
  changedFilesMap: Map<string, GitChangedFile>
  gitSnapshot: DetailGitSnapshot | null
  onFileActionErrorChange?: (message: string | null) => void
  onRefreshGitSnapshot: () => void | Promise<void>
  t: TranslateFn
}

export function useDetailGitDiffState({
  activePane,
  changedFiles,
  changedFilesMap,
  gitSnapshot,
  onFileActionErrorChange,
  onRefreshGitSnapshot,
  t,
}: UseDetailGitDiffStateArgs) {
  const [diffDrawerOpen, setDiffDrawerOpen] = useState(false)
  const [activeDiffFilePath, setActiveDiffFilePath] = useState<string | null>(null)
  const [diffViewMode, setDiffViewMode] = useState<GitDiffViewMode>('unstaged')
  const [diffLoading, setDiffLoading] = useState(false)
  const [diffContent, setDiffContent] = useState('')
  const [diffError, setDiffError] = useState<string | null>(null)
  const [diffTruncated, setDiffTruncated] = useState(false)
  const [conflictLoading, setConflictLoading] = useState(false)
  const [conflictData, setConflictData] = useState<GitConflictFileResult | null>(null)
  const [conflictError, setConflictError] = useState<string | null>(null)
  const [conflictSaving, setConflictSaving] = useState(false)
  const diffRequestSeqRef = useRef(0)
  const conflictRequestSeqRef = useRef(0)
  const conflictSavingRef = useRef(conflictSaving)

  const activeDiffFile = activeDiffFilePath ? changedFilesMap.get(activeDiffFilePath) ?? null : null
  const activeDiffSupportsUnstaged = Boolean(activeDiffFile && (activeDiffFile.unstaged || activeDiffFile.scope === 'untracked'))
  const activeDiffSupportsStaged = Boolean(activeDiffFile?.staged)

  useEffect(() => {
    conflictSavingRef.current = conflictSaving
  }, [conflictSaving])

  useEffect(() => {
    if (activePane === 'aicommit') return
    setDiffDrawerOpen(false)
    setActiveDiffFilePath(null)
    setDiffContent('')
    setDiffError(null)
    setDiffTruncated(false)
    setConflictData(null)
    setConflictError(null)
  }, [activePane])

  const loadDiff = useCallback(async (filePath: string, staged: boolean) => {
    if (!gitSnapshot) return
    const requestSeq = diffRequestSeqRef.current + 1
    diffRequestSeqRef.current = requestSeq
    setDiffLoading(true)
    setDiffError(null)
    setDiffTruncated(false)
    try {
      const result: GitFileDiffResult = await window.electronAPI.getGitFileDiff({
        repoRoot: gitSnapshot.repoRoot,
        filePath,
        staged,
      })
      if (requestSeq !== diffRequestSeqRef.current) return
      if (!result.ok) {
        setDiffContent('')
        setDiffError(result.error || result.output || t('detail.gitDiffLoadFailed'))
        return
      }
      setDiffTruncated(Boolean(result.outputLimit))
      setDiffContent(result.output)
    } catch (error) {
      if (requestSeq !== diffRequestSeqRef.current) return
      setDiffContent('')
      setDiffError(error instanceof Error ? error.message : String(error))
      setDiffTruncated(false)
    } finally {
      if (requestSeq === diffRequestSeqRef.current) setDiffLoading(false)
    }
  }, [gitSnapshot, t])

  const loadConflict = useCallback(async (filePath: string) => {
    if (!gitSnapshot) return
    const requestSeq = conflictRequestSeqRef.current + 1
    conflictRequestSeqRef.current = requestSeq
    setConflictLoading(true)
    setConflictError(null)
    try {
      const result: GitConflictFileResult = await window.electronAPI.getGitConflictFile({
        repoRoot: gitSnapshot.repoRoot,
        filePath,
      })
      if (requestSeq !== conflictRequestSeqRef.current) return
      if (!result.ok) {
        setConflictData(null)
        setConflictError(result.error || result.output || t('detail.gitConflictLoadFailed'))
        return
      }
      setConflictData(result)
    } catch (error) {
      if (requestSeq !== conflictRequestSeqRef.current) return
      setConflictData(null)
      setConflictError(error instanceof Error ? error.message : String(error))
    } finally {
      if (requestSeq === conflictRequestSeqRef.current) setConflictLoading(false)
    }
  }, [gitSnapshot, t])

  const saveConflict = useCallback(async (payload: { filePath: string; content: string; markResolved: boolean }) => {
    if (!gitSnapshot || conflictSavingRef.current) return
    setConflictSaving(true)
    setConflictError(null)
    onFileActionErrorChange?.(null)
    try {
      const result: GitResolveConflictResult = await window.electronAPI.resolveGitConflictFile({
        repoRoot: gitSnapshot.repoRoot,
        filePath: payload.filePath,
        content: payload.content,
        markResolved: payload.markResolved,
      })
      if (!result.ok) {
        const message = result.error || result.output || t('detail.gitConflictSaveFailed')
        setConflictError(message)
        onFileActionErrorChange?.(message)
        return
      }
      if (!payload.markResolved) {
        await loadConflict(payload.filePath)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setConflictError(message)
      onFileActionErrorChange?.(message)
    } finally {
      await onRefreshGitSnapshot()
      setConflictSaving(false)
    }
  }, [gitSnapshot, loadConflict, onFileActionErrorChange, onRefreshGitSnapshot, t])

  useEffect(() => {
    if (!diffDrawerOpen) return
    if (activeDiffFilePath && changedFilesMap.has(activeDiffFilePath)) return
    if (changedFiles.length <= 0) {
      setDiffDrawerOpen(false)
      setActiveDiffFilePath(null)
      setDiffContent('')
      setDiffError(null)
      setDiffTruncated(false)
      setConflictData(null)
      setConflictError(null)
      return
    }
    setActiveDiffFilePath(changedFiles[0].path)
  }, [activeDiffFilePath, changedFiles, changedFilesMap, diffDrawerOpen])

  useEffect(() => {
    if (!activeDiffFile) {
      setDiffViewMode('unstaged')
      return
    }
    if (diffViewMode === 'staged' && !activeDiffSupportsStaged) {
      setDiffViewMode(activeDiffSupportsUnstaged ? 'unstaged' : 'staged')
      return
    }
    if (diffViewMode === 'unstaged' && !activeDiffSupportsUnstaged && activeDiffSupportsStaged) {
      setDiffViewMode('staged')
    }
  }, [activeDiffFile, activeDiffSupportsStaged, activeDiffSupportsUnstaged, diffViewMode])

  useEffect(() => {
    if (!diffDrawerOpen) return
    if (!activeDiffFilePath || !activeDiffFile) return
    if (activeDiffFile.scope === 'conflicted') return
    if (diffViewMode === 'staged' && !activeDiffSupportsStaged) return
    if (diffViewMode === 'unstaged' && !activeDiffSupportsUnstaged) return
    void loadDiff(activeDiffFilePath, diffViewMode === 'staged')
  }, [
    activeDiffFile,
    activeDiffFilePath,
    activeDiffSupportsStaged,
    activeDiffSupportsUnstaged,
    diffDrawerOpen,
    diffViewMode,
    gitSnapshot?.checkedAt,
    loadDiff,
  ])

  useEffect(() => {
    if (diffLoading) return
    if (diffError || diffContent) return
    if (!activeDiffFilePath || !changedFilesMap.has(activeDiffFilePath)) return
    const file = changedFilesMap.get(activeDiffFilePath)
    if (!file) return
    if (file.scope === 'conflicted') return
    if (file.scope === 'untracked' && diffViewMode === 'unstaged') return
    if (file.kind === 'deleted') return
    setDiffContent('(no diff output)')
  }, [activeDiffFilePath, changedFilesMap, diffContent, diffError, diffLoading, diffViewMode])

  useEffect(() => {
    if (!diffDrawerOpen) return
    if (!activeDiffFilePath || !activeDiffFile) return
    if (activeDiffFile.scope !== 'conflicted') return
    void loadConflict(activeDiffFilePath)
  }, [activeDiffFile, activeDiffFilePath, diffDrawerOpen, gitSnapshot?.checkedAt, loadConflict])

  useEffect(() => {
    return () => {
      diffRequestSeqRef.current += 1
      conflictRequestSeqRef.current += 1
    }
  }, [])

  const openDiffDrawerForFile = useCallback((filePath: string) => {
    const target = changedFilesMap.get(filePath)
    if (!target) return
    onFileActionErrorChange?.(null)
    setConflictError(null)
    setDiffDrawerOpen(true)
    setActiveDiffFilePath(filePath)
    setDiffViewMode(pickDefaultDiffViewMode(target))
    if (target.scope !== 'conflicted') {
      setConflictData(null)
      return
    }
    void loadConflict(filePath)
  }, [changedFilesMap, loadConflict, onFileActionErrorChange])

  const handleDiffDrawerClose = useCallback(() => {
    setDiffDrawerOpen(false)
  }, [])

  const handleDiffDrawerSelectFile = useCallback((filePath: string) => {
    const file = changedFilesMap.get(filePath)
    if (!file) return
    setActiveDiffFilePath(filePath)
    setDiffViewMode(pickDefaultDiffViewMode(file))
    if (file.scope === 'conflicted') {
      void loadConflict(filePath)
      return
    }
    setConflictData(null)
    setConflictError(null)
  }, [changedFilesMap, loadConflict])

  const handleDiffViewModeChange = useCallback((mode: GitDiffViewMode) => {
    if (mode === diffViewMode) return
    setDiffViewMode(mode)
  }, [diffViewMode])

  const handleLoadConflict = useCallback((filePath: string) => {
    void loadConflict(filePath)
  }, [loadConflict])

  const handleSaveConflict = useCallback((payload: { filePath: string; content: string; markResolved: boolean }) => {
    void saveConflict(payload)
  }, [saveConflict])

  return {
    activeDiffFile,
    activeDiffFilePath,
    activeDiffSupportsStaged,
    activeDiffSupportsUnstaged,
    conflictData,
    conflictError,
    conflictLoading,
    conflictSaving,
    diffContent,
    diffDrawerOpen,
    diffError,
    diffLoading,
    diffTruncated,
    diffViewMode,
    handleDiffDrawerClose,
    handleDiffDrawerSelectFile,
    handleDiffViewModeChange,
    handleLoadConflict,
    handleSaveConflict,
    openDiffDrawerForFile,
  }
}
