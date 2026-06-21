import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, CheckCheck, ChevronLeft, ChevronRight, RefreshCw, Save, X } from 'lucide-react'
import { MonacoTextViewer } from '../../components/MonacoTextViewer'
import { useI18n } from '../../i18n'
import { ensureGitDiffMonacoLanguage, GIT_DIFF_MONACO_LANGUAGE_ID } from '../../lib/monacoDiffLanguage'
import { inferLanguageFromRelativePath } from '../code/code.helpers'
import { getChangeMeta, getScopeLabel } from './detail.gitOperations'
import { formatBytes, parseConflictMarkers, replaceConflictBlock, type ConflictBlock } from './detail.gitDiffConflicts'
import type { DetailGitSnapshot, GitConflictFileResult, GitDiffViewMode } from './detail.types'

type GitChangedFile = DetailGitSnapshot['changedFiles'][number]

type DetailGitDiffDrawerProps = {
  open: boolean
  changedFiles: GitChangedFile[]
  activeFilePath: string | null
  activeFile: GitChangedFile | null
  diffViewMode: GitDiffViewMode
  diffLoading: boolean
  diffContent: string
  diffError: string | null
  diffTruncated: boolean
  canViewUnstaged: boolean
  canViewStaged: boolean
  conflictLoading: boolean
  conflictData: GitConflictFileResult | null
  conflictError: string | null
  conflictSaving: boolean
  onClose: () => void
  onSelectFile: (filePath: string) => void
  onChangeDiffViewMode: (mode: GitDiffViewMode) => void
  onLoadConflict: (filePath: string) => void
  onSaveConflict: (payload: { filePath: string; content: string; markResolved: boolean }) => void
}

const DRAWER_TRANSITION_MS = 240
const DRAWER_CONTENT_REVEAL_MS = 90

const DetailGitDiffDrawer = memo(function DetailGitDiffDrawer({
  open,
  changedFiles,
  activeFilePath,
  activeFile,
  diffViewMode,
  diffLoading,
  diffContent,
  diffError,
  diffTruncated,
  canViewUnstaged,
  canViewStaged,
  conflictLoading,
  conflictData,
  conflictError,
  conflictSaving,
  onClose,
  onSelectFile,
  onChangeDiffViewMode,
  onLoadConflict,
  onSaveConflict,
}: DetailGitDiffDrawerProps) {
  const { t, tHtml } = useI18n()
  const [shouldRender, setShouldRender] = useState(open)
  const [visible, setVisible] = useState(open)
  const [contentVisible, setContentVisible] = useState(open)
  const [activeConflictBlockIndex, setActiveConflictBlockIndex] = useState(0)
  const [conflictDraft, setConflictDraft] = useState('')
  const conflictDraftDirtyRef = useRef(false)
  const languageHint = useMemo(
    () => inferLanguageFromRelativePath(activeFile?.path ?? ''),
    [activeFile?.path]
  )
  const shouldShowDiffViewer = open && visible && contentVisible
  const isConflictFile = activeFile?.scope === 'conflicted'
  const conflictDataForActiveFile = isConflictFile && conflictData?.filePath === activeFile?.path
    ? conflictData
    : null
  const oursStage = conflictDataForActiveFile?.stageContents.find((item) => item.stage === 2) ?? null
  const theirsStage = conflictDataForActiveFile?.stageContents.find((item) => item.stage === 3) ?? null
  const parsedConflicts = useMemo(() => parseConflictMarkers(conflictDraft), [conflictDraft])
  const conflictBlocks = parsedConflicts.blocks
  const activeConflictBlock = conflictBlocks[activeConflictBlockIndex] ?? null
  const hasConflictBlocks = conflictBlocks.length > 0
  const hasUnresolvedConflictMarkers = hasConflictBlocks
  const isOursStageTruncated = Boolean(oursStage?.outputLimit)
  const isTheirsStageTruncated = Boolean(theirsStage?.outputLimit)
  const currentConflictPreviewContent = activeConflictBlock ? activeConflictBlock.oursContent : (oursStage?.output ?? '')
  const incomingConflictPreviewContent = activeConflictBlock ? activeConflictBlock.theirsContent : (theirsStage?.output ?? '')

  useEffect(() => {
    if (!isConflictFile) {
      if (conflictDraft !== '') setConflictDraft('')
      conflictDraftDirtyRef.current = false
      return
    }
    if (!conflictDataForActiveFile) return
    if (conflictDraftDirtyRef.current) return
    const nextDraft = conflictDataForActiveFile.workingTreeContent
    setConflictDraft((prev) => (prev === nextDraft ? prev : nextDraft))
  }, [
    isConflictFile,
    activeFile?.path,
    conflictDataForActiveFile?.checkedAt,
    conflictDataForActiveFile?.workingTreeContent,
  ])

  useEffect(() => {
    if (open) {
      setShouldRender(true)
      setContentVisible(false)
      const enterTimer = window.setTimeout(() => setVisible(true), 16)
      const revealTimer = window.setTimeout(() => setContentVisible(true), DRAWER_CONTENT_REVEAL_MS)
      return () => {
        window.clearTimeout(enterTimer)
        window.clearTimeout(revealTimer)
      }
    }
    setContentVisible(false)
    setVisible(false)
    const timer = window.setTimeout(() => setShouldRender(false), DRAWER_TRANSITION_MS)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!shouldRender) return
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onEscape)
    return () => document.removeEventListener('keydown', onEscape)
  }, [shouldRender, onClose])

  useEffect(() => {
    if (conflictBlocks.length <= 0) {
      if (activeConflictBlockIndex !== 0) setActiveConflictBlockIndex(0)
      return
    }
    if (activeConflictBlockIndex >= conflictBlocks.length) {
      setActiveConflictBlockIndex(conflictBlocks.length - 1)
    }
  }, [conflictBlocks, activeConflictBlockIndex])

  const applyConflictBlockResolution = (
    mode: 'ours' | 'theirs' | 'both-ours-first' | 'both-theirs-first'
  ) => {
    if (!activeConflictBlock) return
    const replacement = mode === 'ours'
      ? activeConflictBlock.oursContent
      : mode === 'theirs'
        ? activeConflictBlock.theirsContent
        : mode === 'both-ours-first'
          ? `${activeConflictBlock.oursContent}${activeConflictBlock.theirsContent}`
          : `${activeConflictBlock.theirsContent}${activeConflictBlock.oursContent}`
    const nextDraft = replaceConflictBlock(conflictDraft, activeConflictBlock, replacement)
    conflictDraftDirtyRef.current = true
    setConflictDraft(nextDraft)
  }

  if (!shouldRender) return null

  return createPortal(
    <div className="fixed inset-0 z-[1200] overflow-hidden">
      <button
        type="button"
        className={`absolute inset-0 bg-[color:var(--color-background-sunken)]/72 backdrop-blur-[7px] transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
        aria-label={t('detail.gitDiffClose')}
      />
      <aside
        className={`absolute inset-y-3 right-3 w-[min(1480px,calc(100%-1.5rem))] overflow-hidden rounded-[26px] border border-[color:var(--color-border)] bg-[color:var(--color-popover)]/96 shadow-[0_28px_84px_rgba(15,15,20,0.34)] backdrop-blur-[26px] transition-[transform,opacity] duration-240 ease-out will-change-transform ${visible ? 'translate-x-0 opacity-100' : 'translate-x-[36px] opacity-0'}`}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('detail.gitDiffFileTitle')}
      >
        <div className={`flex h-full min-h-0 flex-col transition-opacity duration-120 ${contentVisible ? 'opacity-100' : 'opacity-0'}`}>
          <div className="flex shrink-0 items-center justify-between border-b border-[color:var(--color-border)]/85 bg-[color:var(--color-card)]/62 px-5 py-4 backdrop-blur-[14px]">
            <div className="min-w-0">
              <p className="section-label">{t('detail.gitDiffTitle')}</p>
              <p className="truncate text-[11px] text-[color:var(--color-muted-foreground)]">
                {t('detail.gitDiffDescription')}
              </p>
            </div>
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-background)]/80 text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
              onClick={onClose}
              title={t('detail.gitDiffClose')}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)] max-[980px]:grid-cols-1 max-[980px]:grid-rows-[minmax(220px,35%)_minmax(0,1fr)]">
            <div className="min-h-0 overflow-auto border-r border-[color:var(--color-border)]/85 bg-[color:var(--color-background-sunken)]/46 p-3 max-[980px]:border-r-0 max-[980px]:border-b">
              <div className="space-y-2">
                {changedFiles.map((file) => {
                  const itemActive = activeFilePath === file.path
                  const meta = getChangeMeta(file.kind)
                  return (
                    <button
                      key={`drawer-${file.path}-${file.indexStatus}-${file.worktreeStatus}`}
                      type="button"
                      className={`w-full rounded-[14px] border px-2.5 py-2.5 text-left backdrop-blur-[8px] transition-colors ${
                        itemActive
                          ? 'border-[color:var(--color-primary)]/40 bg-[color:var(--color-primary)]/10 shadow-[0_8px_18px_rgba(10,132,255,0.12)]'
                          : 'border-[color:var(--color-border)]/90 bg-[color:var(--color-card)]/86 hover:border-[color:var(--color-border-hover)] hover:bg-[color:var(--color-background)]/90'
                      }`}
                      onClick={() => onSelectFile(file.path)}
                    >
                      <div className="flex items-start gap-2">
                        <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${meta.className}`}>
                          {meta.label}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-mono text-[11.5px] text-[color:var(--color-foreground)]">{file.path}</p>
                          {file.originalPath && (
                            <p className="mt-0.5 truncate font-mono text-[10px] text-[color:var(--color-muted-foreground)]">
                              {t('detail.workingTreeFrom', { path: file.originalPath })}
                            </p>
                          )}
                          <p className="mt-1 text-[10px] text-[color:var(--color-muted-foreground)]">
                            {getScopeLabel(file)} · {file.indexStatus}{file.worktreeStatus}
                          </p>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="min-h-0 p-3 sm:p-4">
              {activeFile ? (
                <div className="flex h-full min-h-0 flex-col rounded-[18px] border border-[color:var(--color-border)]/90 bg-[color:var(--color-background)]/72 shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[color:var(--color-border)]/85 bg-[color:var(--color-card)]/54 px-3.5 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-[12px] text-[color:var(--color-foreground)]">{activeFile.path}</p>
                      <p className="text-[10.5px] text-[color:var(--color-muted-foreground)]">
                        {isConflictFile
                          ? `${t('detail.gitDiffConflictMode')} · ${languageHint}`
                          : `${diffViewMode === 'staged' ? t('detail.gitDiffStagedMode') : t('detail.gitDiffUnstagedMode')} · ${languageHint}`
                        }
                      </p>
                      {!isConflictFile && diffTruncated && (
                        <p className="mt-1 text-[10.5px] text-[color:var(--color-warning)]">
                          {t('detail.gitDiffTruncated')}
                        </p>
                      )}
                    </div>
                    {!isConflictFile ? (
                      <div className="quiet-control flex items-center gap-1 rounded-full border border-[color:var(--color-border)]/75 p-1">
                        <button
                          type="button"
                          className={`rounded-full px-2.5 py-1 text-[10.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                            diffViewMode === 'unstaged'
                              ? 'bg-primary text-white shadow-[0_6px_14px_rgba(10,132,255,0.3)]'
                              : 'text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]'
                          }`}
                          disabled={!canViewUnstaged || diffLoading}
                          onClick={() => onChangeDiffViewMode('unstaged')}
                        >
                          {t('detail.gitDiffUnstagedMode')}
                        </button>
                        <button
                          type="button"
                          className={`rounded-full px-2.5 py-1 text-[10.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                            diffViewMode === 'staged'
                              ? 'bg-primary text-white shadow-[0_6px_14px_rgba(10,132,255,0.3)]'
                              : 'text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]'
                          }`}
                          disabled={!canViewStaged || diffLoading}
                          onClick={() => onChangeDiffViewMode('staged')}
                        >
                          {t('detail.gitDiffStagedMode')}
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          className="inline-flex h-8 items-center gap-1 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-3 text-[10.5px] text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-60"
                          onClick={() => {
                            conflictDraftDirtyRef.current = false
                            onLoadConflict(activeFile.path)
                          }}
                          disabled={conflictLoading || conflictSaving}
                        >
                          <RefreshCw className={`h-3.5 w-3.5 ${conflictLoading ? 'animate-spin' : ''}`} />
                          {t('detail.gitDiffReload')}
                        </button>
                        <button
                          type="button"
                          className="inline-flex h-8 items-center gap-1 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-3 text-[10.5px] text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-60"
                          onClick={() => {
                            conflictDraftDirtyRef.current = false
                            onSaveConflict({ filePath: activeFile.path, content: conflictDraft, markResolved: false })
                          }}
                          disabled={conflictLoading || conflictSaving || hasUnresolvedConflictMarkers}
                          title={hasUnresolvedConflictMarkers ? t('detail.gitDiffHasUnresolvedMarkers') : undefined}
                        >
                          <Save className="h-3.5 w-3.5" />
                          {t('detail.gitDiffSaveOnly')}
                        </button>
                        <button
                          type="button"
                          className="inline-flex h-8 items-center gap-1 rounded-full bg-primary px-3 text-[10.5px] font-medium text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
                          onClick={() => {
                            conflictDraftDirtyRef.current = false
                            onSaveConflict({ filePath: activeFile.path, content: conflictDraft, markResolved: true })
                          }}
                          disabled={conflictLoading || conflictSaving || hasUnresolvedConflictMarkers}
                          title={hasUnresolvedConflictMarkers ? t('detail.gitDiffHasUnresolvedMarkers') : undefined}
                        >
                          <CheckCheck className="h-3.5 w-3.5" />
                          {t('detail.gitDiffSaveAndMarkResolved')}
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="min-h-0 flex-1">
                    {!isConflictFile ? (
                      diffLoading ? (
                        <div className="flex h-full items-center justify-center text-[11px] text-[color:var(--color-muted-foreground)]">
                          {t('detail.gitDiffLoading')}
                        </div>
                      ) : diffError ? (
                        <div className="flex h-full items-center justify-center px-4 text-[11px] text-[color:var(--color-destructive)]">
                          {diffError}
                        </div>
                      ) : shouldShowDiffViewer ? (
                        <MonacoTextViewer
                          value={diffContent || ''}
                          filePath={activeFile.path}
                          language={GIT_DIFF_MONACO_LANGUAGE_ID}
                          readOnly
                          modelNamespace="git-diff"
                          prepareMonaco={ensureGitDiffMonacoLanguage}
                        />
                      ) : (
                        <div className="h-full w-full" aria-hidden="true" />
                      )
                    ) : (
                      <div className="flex h-full min-h-0 flex-col gap-3 p-3">
                        <div className={`rounded-[12px] border px-3 py-2 text-[11px] ${
                          hasConflictBlocks
                            ? 'border-[color:var(--color-destructive)]/35 bg-[color:var(--color-destructive-background)] text-[color:var(--color-destructive)]'
                            : 'border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)] text-[color:var(--color-muted-foreground)]'
                        }`}>
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <AlertTriangle className="h-3.5 w-3.5" />
                              <span>
                                {hasConflictBlocks
                                  ? t('detail.gitDiffConflictDetected', { count: conflictBlocks.length })
                                  : t('detail.gitDiffConflictDetailsMissing')
                                }
                              </span>
                            </div>
                            {hasConflictBlocks && (
                              <span className="shrink-0 rounded-full border border-[color:var(--color-warning)]/35 bg-[color:var(--color-warning-background)] px-2 py-0.5 text-[10px]">
                                {t('detail.gitDiffConflictCount', {
                                  current: Math.min(activeConflictBlockIndex + 1, conflictBlocks.length),
                                  total: conflictBlocks.length,
                                })}
                              </span>
                            )}
                          </div>
                        </div>

                        {conflictLoading ? (
                          <div className="flex min-h-0 flex-1 items-center justify-center text-[11px] text-[color:var(--color-muted-foreground)]">
                            {t('detail.gitDiffLoadingConflict')}
                          </div>
                        ) : conflictError ? (
                          <div className="flex min-h-0 flex-1 items-center justify-center rounded-[12px] border border-[color:var(--color-destructive)]/25 bg-[color:var(--color-destructive-background)] px-4 text-[11px] text-[color:var(--color-destructive)]">
                            {conflictError}
                          </div>
                        ) : !conflictDataForActiveFile ? (
                          <div className="flex min-h-0 flex-1 items-center justify-center rounded-[12px] border border-dashed border-[color:var(--color-border)] px-4 text-[11px] text-[color:var(--color-muted-foreground)]">
                            {t('detail.gitDiffConflictDetailsMissing')}
                          </div>
                        ) : (
                          <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)_minmax(0,1fr)] gap-3">
                            {hasConflictBlocks && (
                              <div className="rounded-[12px] border border-[color:var(--color-border)] bg-[color:var(--color-card)]/75 px-3 py-2.5">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-[11px] font-medium text-[color:var(--color-foreground)]">
                                    {t('detail.gitDiffConflictNav')}
                                  </p>
                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[color:var(--color-border)] text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)] disabled:cursor-not-allowed disabled:opacity-45"
                                      onClick={() => setActiveConflictBlockIndex((prev) => Math.max(0, prev - 1))}
                                      disabled={activeConflictBlockIndex <= 0}
                                      title={t('detail.gitDiffPrevConflict')}
                                    >
                                      <ChevronLeft className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[color:var(--color-border)] text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)] disabled:cursor-not-allowed disabled:opacity-45"
                                      onClick={() => setActiveConflictBlockIndex((prev) => Math.min(conflictBlocks.length - 1, prev + 1))}
                                      disabled={activeConflictBlockIndex >= conflictBlocks.length - 1}
                                      title={t('detail.gitDiffNextConflict')}
                                    >
                                      <ChevronRight className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                </div>
                                {activeConflictBlock && (
                                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10.5px]">
                                    <span className="rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)] px-2 py-0.5 text-[color:var(--color-foreground)]">
                                      {t('detail.gitDiffLineRange', { start: activeConflictBlock.startLine, end: activeConflictBlock.endLine })}
                                    </span>
                                    <span className="rounded-full border border-[color:var(--color-primary)]/25 bg-[color:var(--color-primary)]/10 px-2 py-0.5 text-[color:var(--color-primary)]">
                                      {t('detail.gitDiffCurrent')}: {activeConflictBlock.oursLabel || 'OURS'}
                                    </span>
                                    <span className="rounded-full border border-[color:var(--color-warning)]/35 bg-[color:var(--color-warning-background)] px-2 py-0.5 text-[color:var(--color-warning)]">
                                      {t('detail.gitDiffIncoming')}: {activeConflictBlock.theirsLabel || 'THEIRS'}
                                    </span>
                                  </div>
                                )}
                              </div>
                            )}

                            <div className="grid min-h-0 grid-cols-2 gap-3 max-[1280px]:grid-cols-1">
                              <div className="grid min-h-0 grid-rows-[56px_minmax(160px,1fr)] rounded-[12px] border border-[color:var(--color-border)] bg-[color:var(--color-card)]/75">
                                <div className="flex items-center justify-between gap-2 border-b border-[color:var(--color-border)]/85 px-3 py-2">
                                  <div className="min-w-0">
                                    <p className="text-[11px] font-medium text-[color:var(--color-foreground)]">{t('detail.gitDiffCurrent')} (OURS)</p>
                                    <p className="text-[10px] text-[color:var(--color-muted-foreground)]">{t('detail.gitDiffCurrentReadonly')}</p>
                                  </div>
                                    <button
                                      type="button"
                                      className="inline-flex h-7 items-center rounded-full border border-[color:var(--color-border)] px-2.5 text-[10px] font-medium text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-45"
                                      disabled={conflictLoading || conflictSaving || (!hasConflictBlocks && (!oursStage?.exists || isOursStageTruncated))}
                                      onClick={() => {
                                        if (hasConflictBlocks) {
                                          applyConflictBlockResolution('ours')
                                          return
                                        }
                                      if (!oursStage?.exists) return
                                      conflictDraftDirtyRef.current = true
                                      setConflictDraft(oursStage.output)
                                    }}
                                      title={hasConflictBlocks ? t('detail.gitDiffAcceptCurrent') : isOursStageTruncated ? t('detail.gitDiffTruncated') : t('detail.gitDiffAcceptCurrentWhole')}
                                    >
                                      {t('detail.gitDiffAcceptCurrent')}
                                    </button>
                                </div>
                                {oursStage?.outputLimit && (
                                  <div className="px-3 pb-2 text-[10px] text-[color:var(--color-warning)]">
                                    {t('detail.gitDiffTruncated')} {formatBytes(oursStage.outputLimit.keptBytes)} / {formatBytes(oursStage.outputLimit.totalBytes)}
                                  </div>
                                )}
                                <div className="min-h-0">
                                  {currentConflictPreviewContent ? (
                                    <MonacoTextViewer
                                      value={currentConflictPreviewContent}
                                      filePath={`${activeFile.path}:current-preview`}
                                      language={languageHint}
                                      readOnly
                                      modelNamespace="git-conflict-current-preview"
                                    />
                                  ) : (
                                    <div className="flex h-full items-center justify-center text-[11px] text-[color:var(--color-muted-foreground)]">
                                      {t('detail.gitDiffCurrentMissing')}
                                    </div>
                                  )}
                                </div>
                              </div>

                              <div className="grid min-h-0 grid-rows-[56px_minmax(160px,1fr)] rounded-[12px] border border-[color:var(--color-border)] bg-[color:var(--color-card)]/75">
                                <div className="flex items-center justify-between gap-2 border-b border-[color:var(--color-border)]/85 px-3 py-2">
                                  <div className="min-w-0">
                                    <p className="text-[11px] font-medium text-[color:var(--color-foreground)]">{t('detail.gitDiffIncoming')} (THEIRS)</p>
                                    <p className="text-[10px] text-[color:var(--color-muted-foreground)]">{t('detail.gitDiffIncomingReadonly')}</p>
                                  </div>
                                    <button
                                      type="button"
                                      className="inline-flex h-7 items-center rounded-full border border-[color:var(--color-border)] px-2.5 text-[10px] font-medium text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-45"
                                      disabled={conflictLoading || conflictSaving || (!hasConflictBlocks && (!theirsStage?.exists || isTheirsStageTruncated))}
                                      onClick={() => {
                                        if (hasConflictBlocks) {
                                          applyConflictBlockResolution('theirs')
                                          return
                                        }
                                      if (!theirsStage?.exists) return
                                      conflictDraftDirtyRef.current = true
                                      setConflictDraft(theirsStage.output)
                                    }}
                                      title={hasConflictBlocks ? t('detail.gitDiffAcceptIncoming') : isTheirsStageTruncated ? t('detail.gitDiffTruncated') : t('detail.gitDiffAcceptIncomingWhole')}
                                    >
                                      {t('detail.gitDiffAcceptIncoming')}
                                    </button>
                                </div>
                                {theirsStage?.outputLimit && (
                                  <div className="px-3 pb-2 text-[10px] text-[color:var(--color-warning)]">
                                    {t('detail.gitDiffTruncated')} {formatBytes(theirsStage.outputLimit.keptBytes)} / {formatBytes(theirsStage.outputLimit.totalBytes)}
                                  </div>
                                )}
                                <div className="min-h-0">
                                  {incomingConflictPreviewContent ? (
                                    <MonacoTextViewer
                                      value={incomingConflictPreviewContent}
                                      filePath={`${activeFile.path}:incoming-preview`}
                                      language={languageHint}
                                      readOnly
                                      modelNamespace="git-conflict-incoming-preview"
                                    />
                                  ) : (
                                    <div className="flex h-full items-center justify-center text-[11px] text-[color:var(--color-muted-foreground)]">
                                      {t('detail.gitDiffIncomingMissing')}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="grid min-h-0 grid-rows-[58px_minmax(260px,1fr)] rounded-[12px] border border-[color:var(--color-border)] bg-[color:var(--color-card)]/75">
                              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[color:var(--color-border)]/85 px-3 py-2">
                                <div className="min-w-0">
                                  <p className="text-[11px] font-medium text-[color:var(--color-foreground)]">{t('detail.gitDiffResultTitle')}</p>
                                  <p className="text-[10px] text-[color:var(--color-muted-foreground)]" dangerouslySetInnerHTML={tHtml('detail.gitDiffResultDescription')} />
                                </div>
                                <div className="quiet-control flex flex-wrap items-center gap-1 rounded-full border border-[color:var(--color-border)]/75 p-1">
                                  {hasConflictBlocks ? (
                                    <>
                                      <button
                                        type="button"
                                        className="rounded-full px-2.5 py-1 text-[10px] font-medium text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)] disabled:cursor-not-allowed disabled:opacity-45"
                                        disabled={conflictLoading || conflictSaving || !activeConflictBlock}
                                        onClick={() => applyConflictBlockResolution('both-ours-first')}
                                        title={t('detail.gitDiffAcceptCombinedCurrentFirst')}
                                      >
                                        {t('detail.gitDiffAcceptCombinedCurrentFirst')}
                                      </button>
                                      <button
                                        type="button"
                                        className="rounded-full px-2.5 py-1 text-[10px] font-medium text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)] disabled:cursor-not-allowed disabled:opacity-45"
                                        disabled={conflictLoading || conflictSaving || !activeConflictBlock}
                                        onClick={() => applyConflictBlockResolution('both-theirs-first')}
                                        title={t('detail.gitDiffAcceptCombinedIncomingFirst')}
                                      >
                                        {t('detail.gitDiffAcceptCombinedIncomingFirst')}
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      <button
                                        type="button"
                                        className="rounded-full px-2.5 py-1 text-[10px] font-medium text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)] disabled:cursor-not-allowed disabled:opacity-45"
                                        disabled={conflictLoading || conflictSaving || !oursStage?.exists || !theirsStage?.exists || isOursStageTruncated || isTheirsStageTruncated}
                                        onClick={() => {
                                          conflictDraftDirtyRef.current = true
                                          setConflictDraft(`${oursStage?.output ?? ''}${theirsStage?.output ?? ''}`)
                                        }}
                                        title={isOursStageTruncated || isTheirsStageTruncated ? t('detail.gitDiffTruncated') : t('detail.gitDiffAcceptWholeCurrentFirst')}
                                      >
                                        {t('detail.gitDiffAcceptWholeCurrentFirst')}
                                      </button>
                                      <button
                                        type="button"
                                        className="rounded-full px-2.5 py-1 text-[10px] font-medium text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)] disabled:cursor-not-allowed disabled:opacity-45"
                                        disabled={conflictLoading || conflictSaving || !oursStage?.exists || !theirsStage?.exists || isOursStageTruncated || isTheirsStageTruncated}
                                        onClick={() => {
                                          conflictDraftDirtyRef.current = true
                                          setConflictDraft(`${theirsStage?.output ?? ''}${oursStage?.output ?? ''}`)
                                        }}
                                        title={isOursStageTruncated || isTheirsStageTruncated ? t('detail.gitDiffTruncated') : t('detail.gitDiffAcceptWholeIncomingFirst')}
                                      >
                                        {t('detail.gitDiffAcceptWholeIncomingFirst')}
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>
                              <div className="min-h-0">
                                <MonacoTextViewer
                                  value={conflictDraft}
                                  filePath={`${activeFile.path}:resolved`}
                                  language={languageHint}
                                  readOnly={conflictSaving}
                                  modelNamespace="git-conflict-resolved"
                                  onChange={(nextValue) => {
                                    conflictDraftDirtyRef.current = true
                                    setConflictDraft(nextValue)
                                  }}
                                />
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex h-full items-center justify-center rounded-[18px] border border-dashed border-[color:var(--color-border)] bg-[color:var(--color-background)]/55 text-xs text-[color:var(--color-muted-foreground)]">
                  {t('detail.gitDiffSelectFile')}
                </div>
              )}
            </div>
          </div>
        </div>
      </aside>
    </div>,
    document.body
  )
})

export { DetailGitDiffDrawer }
