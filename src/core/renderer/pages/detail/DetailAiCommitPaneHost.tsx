import { useEffect, useMemo, useRef } from 'react'
import type { AiCommitConfig } from '../../../shared/types'
import type { ProjectPanePreload } from '../../components/ProjectPaneTabs'
import { useAppStore } from '../../stores/appStore'
import { useI18n } from '../../i18n'
import { detectProjectEnvironment } from '../../lib/projectEnvironment'
import { DetailAiCommitPanel } from './DetailAiCommitPanel'
import type { ProjectLinkItem } from './detail.aiCommitPanel.types'
import { useAiCommitFlow } from './useAiCommitFlow'

type DetailAiCommitPaneHostProps = {
  projectId: string
  projectPath: string
  projectHeaderCollapsed: boolean
  projectName: string
  projectLinkItems: ProjectLinkItem[]
  hasProjectDocLinks?: boolean
  projectLinkTagOptions: ReadonlyArray<{ value: string; label: string }>
  projectDevUrlActionVisible?: boolean
  projectDevUrlPending?: boolean
  projectDevUrlReady?: boolean
  aiCommitConfig: AiCommitConfig | undefined
  activePane: 'code' | 'aicommit'
  onPreloadPane?: ProjectPanePreload
  onSwitchPane: (pane: 'code' | 'aicommit') => void
  onStartAndOpenDevUrl?: () => void | Promise<unknown>
  onOpenTranscript: () => void
  onOpenProjectLinksManager: () => void
  onCloseProjectContextMenu: () => void
}

export function DetailAiCommitPaneHost({
  projectId,
  projectPath,
  projectHeaderCollapsed,
  projectName,
  projectLinkItems,
  hasProjectDocLinks = false,
  projectLinkTagOptions,
  projectDevUrlActionVisible = false,
  projectDevUrlPending = false,
  projectDevUrlReady = false,
  aiCommitConfig,
  activePane,
  onPreloadPane,
  onSwitchPane,
  onStartAndOpenDevUrl,
  onOpenTranscript,
  onOpenProjectLinksManager,
  onCloseProjectContextMenu,
}: DetailAiCommitPaneHostProps) {
  const { t } = useI18n()
  const toolProcessId = useMemo(() => `${projectId}::toolbox`, [projectId])
  const toolProcessStatus = useAppStore((s) => s.processes[toolProcessId]?.status ?? 'stopped')
  const startProject = useAppStore((s) => s.startProject)
  const stopProject = useAppStore((s) => s.stopProject)
  const clearOutput = useAppStore((s) => s.clearOutput)
  const environment = detectProjectEnvironment(projectPath)
  const toolboxAutoStartKeyRef = useRef<string | null>(null)
  const aiCommitFlow = useAiCommitFlow({
    projectId,
    projectPath,
    toolProcessId,
    aiCommitConfig,
  })
  const {
    aiCommitStatus,
    aiRawText,
    jumpToAiLogToken,
    gitSnapshot,
    gitSnapshotLoading,
    gitSnapshotError,
    gitRepositories,
    gitRepositoriesLoading,
    gitRepositoriesError,
    gitRepositoriesTruncated,
    selectedGitRepositoryId,
    setSelectedGitRepositoryId,
    refreshGitRepositories,
    refreshGitSnapshot,
    activeCommitHash,
    setActiveCommitHash,
    aiCommitUndo,
    aiCommitUndoAuthActive,
    aiCommitUndoAvailable,
    aiCommitUndoActionAvailable,
    aiCommitUndoRemainingSeconds,
    aiCommitUndoGraceActive,
    aiCommitUndoGraceRemainingSeconds,
    aiCommitCanceling,
    aiCommitUndoRunning,
    aiCommitUndoError,
    quickConfigOpen,
    setQuickConfigOpen,
    quickSplit,
    setQuickSplit,
    quickSplitMaxBatches,
    setQuickSplitMaxBatches,
    quickMaxBullets,
    setQuickMaxBullets,
    quickConfigPos,
    setQuickConfigPos,
    quickConfigRef,
    quickButtonRef,
    isAiEnabled,
    defaultSplit,
    defaultSplitMaxBatches,
    defaultMaxBullets,
    quickSplitMaxBatchesNumber,
    quickMaxBulletsNumber,
    handleAiCommit,
    handleCancelAiCommit,
    handleBeginUndoAiCommitAuth,
    handleCancelUndoAiCommitAuth,
    handleUndoAiCommit,
    runWithQuickConfig,
    saveQuickConfigAsDefault,
    statusText,
    statusClass,
    flowNodes,
  } = aiCommitFlow

  useEffect(() => {
    if (toolProcessStatus !== 'stopped') return
    const autoStartKey = `${projectId}\n${projectPath}\n${environment}`
    if (toolboxAutoStartKeyRef.current === autoStartKey) return
    toolboxAutoStartKeyRef.current = autoStartKey
    const toolCommand = environment === 'ubuntu' ? 'exec bash -i' : 'powershell -NoLogo -NoExit'
    const useWsl = environment === 'ubuntu'
    clearOutput(toolProcessId)
    void startProject(projectId, toolCommand, toolProcessId, useWsl)
  }, [clearOutput, environment, projectId, projectPath, startProject, toolProcessId, toolProcessStatus])

  useEffect(() => {
    return () => {
      clearOutput(toolProcessId)
      void stopProject(toolProcessId)
    }
  }, [clearOutput, stopProject, toolProcessId])

  return (
    <>
      {quickConfigOpen && (
        <div
          ref={quickConfigRef}
          className="fixed z-[120] w-[260px] rounded-[16px] border p-3 shadow-xl surface-card"
          style={{
            left: `${quickConfigPos.x}px`,
            top: `${quickConfigPos.y}px`,
            borderColor: 'var(--color-border)',
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
        >
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-semibold text-[color:var(--color-foreground)]">{t('detail.quickAiCommitConfigTitle')}</p>
            <button
              className="rounded-full px-2 py-0.5 text-[11px] text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
              onClick={() => setQuickConfigOpen(false)}
            >
              {t('common.close')}
            </button>
          </div>

          <label className="mb-2 flex items-center gap-2 text-xs text-[color:var(--color-foreground)]">
            <input
              type="checkbox"
              checked={quickSplit}
              onChange={(e) => setQuickSplit(e.target.checked)}
            />
            {t('detail.quickAiCommitEnableSplitCommit')}
          </label>

          <div className="mb-3">
            <p className="mb-1 text-[11px] text-[color:var(--color-muted-foreground)]">{t('detail.quickAiCommitSplitBatches')}</p>
            <input
              type="number"
              min={1}
              max={12}
              step={1}
              value={quickSplitMaxBatches}
              disabled={!quickSplit}
              onChange={(e) => setQuickSplitMaxBatches(e.target.value)}
              className="quiet-control h-8 w-full rounded-full border-0 px-3 text-xs text-[color:var(--color-foreground)]"
            />
          </div>

          <div className="mb-3">
            <p className="mb-1 text-[11px] text-[color:var(--color-muted-foreground)]">{t('detail.quickAiCommitMaxBullets')}</p>
            <div className="mb-2 flex items-center gap-1.5">
              {[8, 12, 16].map((value) => {
                const active = quickMaxBulletsNumber === value
                return (
                  <button
                    key={value}
                    type="button"
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      active
                        ? 'bg-primary text-white'
                        : 'border border-[color:var(--color-border)] text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]'
                    }`}
                    onClick={() => setQuickMaxBullets(String(value))}
                  >
                    {value}
                  </button>
                )
              })}
            </div>
            <input
              type="number"
              min={1}
              max={20}
              step={1}
              value={quickMaxBullets}
              onChange={(e) => setQuickMaxBullets(e.target.value)}
              className="quiet-control h-8 w-full rounded-full border-0 px-3 text-xs text-[color:var(--color-foreground)]"
              placeholder="8"
            />
          </div>

          <div className="mb-2 text-[10px] text-[color:var(--color-muted-foreground)]">
            {t('detail.quickAiCommitDefaultSummary', {
              split: defaultSplit ? t('detail.quickAiCommitSplitOn') : t('detail.quickAiCommitSplitOff'),
              batches: defaultSplitMaxBatches,
              bullets: defaultMaxBullets,
            })}
          </div>

          <div className="flex items-center gap-2">
            <button
              className="flex-1 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover"
              onClick={() => void runWithQuickConfig()}
              disabled={aiCommitStatus === 'running'}
            >
              {t('detail.quickAiCommitRunThisTime')}
            </button>
            <button
              className="rounded-full border border-[color:var(--color-border)] px-3 py-1.5 text-xs text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]"
              onClick={() => void saveQuickConfigAsDefault()}
            >
              {t('detail.quickAiCommitSaveDefault')}
            </button>
          </div>
        </div>
      )}

      <DetailAiCommitPanel
        projectHeaderCollapsed={projectHeaderCollapsed}
        projectName={projectName}
        projectLinkItems={projectLinkItems}
        hasProjectDocLinks={hasProjectDocLinks}
        projectLinkTagOptions={projectLinkTagOptions}
        projectDevUrlActionVisible={projectDevUrlActionVisible}
        projectDevUrlPending={projectDevUrlPending}
        projectDevUrlReady={projectDevUrlReady}
        activePane={activePane}
        onPreloadPane={onPreloadPane}
        onSwitchPane={onSwitchPane}
        onStartAndOpenDevUrl={onStartAndOpenDevUrl}
        onOpenTranscript={onOpenTranscript}
        onOpenProjectLinksManager={onOpenProjectLinksManager}
        jumpToAiLogToken={jumpToAiLogToken}
        flowNodes={flowNodes}
        aiRawText={aiRawText}
        statusClass={statusClass}
        statusText={statusText}
        gitSnapshot={gitSnapshot}
        gitSnapshotLoading={gitSnapshotLoading}
        gitSnapshotError={gitSnapshotError}
        gitRepositories={gitRepositories}
        gitRepositoriesLoading={gitRepositoriesLoading}
        gitRepositoriesError={gitRepositoriesError}
        gitRepositoriesTruncated={gitRepositoriesTruncated}
        selectedGitRepositoryId={selectedGitRepositoryId}
        onChangeGitRepository={setSelectedGitRepositoryId}
        onRefreshGitRepositories={() => void refreshGitRepositories()}
        onRefreshGitSnapshot={() => void refreshGitSnapshot()}
        activeCommitHash={activeCommitHash}
        setActiveCommitHash={setActiveCommitHash}
        aiCommitUndo={aiCommitUndo}
        aiCommitUndoAuthActive={aiCommitUndoAuthActive}
        aiCommitUndoAvailable={aiCommitUndoAvailable}
        aiCommitUndoActionAvailable={aiCommitUndoActionAvailable}
        aiCommitUndoRemainingSeconds={aiCommitUndoRemainingSeconds}
        aiCommitUndoGraceActive={aiCommitUndoGraceActive}
        aiCommitUndoGraceRemainingSeconds={aiCommitUndoGraceRemainingSeconds}
        aiCommitCanceling={aiCommitCanceling}
        aiCommitUndoRunning={aiCommitUndoRunning}
        aiCommitUndoError={aiCommitUndoError}
        aiCommitStatus={aiCommitStatus}
        isAiEnabled={isAiEnabled}
        aiAutoCommitButtonRef={quickButtonRef}
        onAiAutoCommit={() => {
          void handleAiCommit()
        }}
        onBeginUndoAiCommitAuth={() => handleBeginUndoAiCommitAuth()}
        onCancelUndoAiCommitAuth={() => handleCancelUndoAiCommitAuth()}
        onCancelAiCommit={() => {
          void handleCancelAiCommit()
        }}
        onUndoAiCommit={() => {
          void handleUndoAiCommit()
        }}
        onAiAutoCommitContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (aiCommitStatus === 'running') return
          onCloseProjectContextMenu()
          const panelWidth = 260
          const panelHeight = 320
          const x = Math.max(8, Math.min(e.clientX, window.innerWidth - panelWidth - 8))
          const y = Math.max(8, Math.min(e.clientY, window.innerHeight - panelHeight - 8))
          setQuickConfigPos({ x, y })
          setQuickConfigOpen(true)
        }}
      />
    </>
  )
}
