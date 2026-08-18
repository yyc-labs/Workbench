import { ReactFlowProvider, type Connection } from '@xyflow/react'
import { Trash2 } from 'lucide-react'
import { type DragEvent, useCallback, useRef } from 'react'
import { Combobox } from '../../components/ui/combobox'
import { Textarea } from '../../components/ui/textarea'
import { useI18n } from '../../i18n'
import { DetailAiCommitGitWorkflowSurface, type WorkflowSurfaceHandle } from './DetailAiCommitGitWorkflowSurface'
import { getGitWorkflowOperationDefinition } from './gitWorkflow.operations'
import type { GitWorkflowNodeData } from './gitWorkflow.types'
import type { GitWorkflowRunnerApi } from './useGitWorkflowRunner'

type WorkflowRunner = GitWorkflowRunnerApi
type SwitchNodeData = Extract<GitWorkflowNodeData, { operation: 'switch' }>
type MergeNodeData = Extract<GitWorkflowNodeData, { operation: 'merge' }>
type CommitNodeData = Extract<GitWorkflowNodeData, { operation: 'commit' }>

function WorkflowCanvasInner({ runner }: { runner: WorkflowRunner }) {
  const { t } = useI18n()
  const surfaceRef = useRef<WorkflowSurfaceHandle>(null)
  const selectedNode = runner.selectedNode
  const runStatusText =
    runner.runState.status === 'validating'
      ? t('detail.gitWorkflowRunValidating')
      : runner.runState.status === 'waiting-for-input'
        ? t('detail.gitWorkflowRunWaitingInput')
        : runner.runState.status === 'waiting-for-confirmation'
          ? t('detail.gitWorkflowRunWaitingConfirmation')
          : runner.runState.status === 'paused'
            ? t('detail.gitWorkflowRunPaused')
            : runner.runState.status === 'completed'
              ? t('detail.gitWorkflowRunCompleted')
              : runner.runState.status

  const canEdit = runner.runState.status === 'idle' || runner.runState.status === 'paused' || runner.runState.status === 'completed'

  const handleSaveGraph = useCallback(() => {
    const nextGraph = surfaceRef.current?.getGraphSnapshot()
    if (nextGraph) {
      runner.commitNodePositions(nextGraph.nodes.map((node) => ({ id: node.id, position: node.position })))
      runner.saveGraph(nextGraph)
      return
    }
    runner.saveGraph()
  }, [runner.commitNodePositions, runner.saveGraph])

  const handleDragStart = useCallback((event: DragEvent<HTMLButtonElement>, operation: GitWorkflowNodeData['operation']) => {
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData('application/x-git-workflow-operation', operation)
    event.dataTransfer.setData('text/plain', operation)
  }, [])

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target || connection.sourceHandle == null) return
      const sourceHandle = connection.sourceHandle === 'failure' ? 'failure' : 'success'
      runner.connect(connection.source, sourceHandle, connection.target)
    },
    [runner.connect],
  )

  return (
    <div className="grid min-h-[72vh] grid-cols-[220px_minmax(0,1fr)_320px] gap-4 overflow-hidden">
      <div className="flex min-h-0 flex-col rounded-[18px] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-3">
        <p className="section-label mb-2">{t('detail.gitWorkflowPaletteTitle')}</p>
        <div className="space-y-2 overflow-auto">
          {(['fetch', 'pull', 'push', 'switch', 'merge', 'commit'] as GitWorkflowNodeData['operation'][]).map((operation) => {
            const def = getGitWorkflowOperationDefinition(operation)
            const Icon = def.icon
            return (
              <button key={operation} type="button" draggable onDragStart={(event) => handleDragStart(event, operation)} onClick={() => runner.addNode(operation)} className="surface-card-hover flex w-full items-center gap-2 rounded-[14px] border border-[color:var(--color-border)] px-3 py-2 text-left">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[color:var(--color-primary)]/10 text-[color:var(--color-primary)]">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[12px] font-medium text-[color:var(--color-foreground)]">{t(def.labelKey as never)}</span>
                  <span className="block truncate text-[10px] text-[color:var(--color-muted-foreground)]">{t(def.descriptionKey as never)}</span>
                </span>
              </button>
            )
          })}
          <div className="pt-2">
            <button type="button" className="quiet-control flex w-full items-center justify-center gap-1 rounded-full px-3 py-2 text-[11px]" onClick={handleSaveGraph}>
              <span>{t('detail.gitWorkflowSave')}</span>
            </button>
          </div>
        </div>
      </div>

      <DetailAiCommitGitWorkflowSurface
        ref={surfaceRef}
        graph={runner.graph}
        runState={runner.runState}
        selectedNodeId={runner.selectedNodeId}
        validationResult={runner.validationResult}
        canEdit={canEdit}
        onAddNode={runner.addNode}
        onConnect={handleConnect}
        onDeleteNode={runner.deleteNode}
        onDeleteEdge={runner.deleteEdge}
        onSelectNode={runner.setSelectedNodeId}
        onCommitNodePositions={runner.commitNodePositions}
      />

      <div className="flex min-h-0 flex-col gap-3 overflow-auto rounded-[18px] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-3">
        <div>
          <p className="section-label mb-2">{t('detail.gitWorkflowInspectorTitle')}</p>
          {selectedNode ? (
            <div className="space-y-3">
              <div>
                <p className="text-sm font-semibold text-[color:var(--color-foreground)]">{t('detail.gitWorkflowNodeTitle')}</p>
                <p className="text-[11px] text-[color:var(--color-muted-foreground)]">{selectedNode.data.operation}</p>
              </div>
              <label htmlFor="git-workflow-node-label" className="block">
                <span className="mb-1 block text-[10.5px] uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">{t('detail.gitWorkflowNodeLabel')}</span>
                <input
                  id="git-workflow-node-label"
                  type="text"
                  value={selectedNode.data.label || ''}
                  onChange={(event) => runner.updateNodeConfig(selectedNode.id, (data) => ({ ...data, label: event.target.value || undefined }))}
                  className="h-9 w-full rounded-[12px] border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-3 text-[12px] text-[color:var(--color-foreground)] outline-none"
                  placeholder={t('detail.gitWorkflowNodeLabelPlaceholder')}
                />
              </label>

              {selectedNode.data.operation === 'switch' && (
                <div className="space-y-2">
                  <p className="text-[10.5px] uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">{t('detail.gitWorkflowSwitchTarget')}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      className={`quiet-control rounded-[12px] px-3 py-2 text-left text-[11px] ${selectedNode.data.config.target.mode === 'prompt' ? 'bg-[color:var(--color-primary)]/10' : ''}`}
                      onClick={() =>
                        runner.updateNodeConfig(selectedNode.id, (data) => {
                          const next = data as SwitchNodeData
                          return { ...next, config: { ...next.config, target: { mode: 'prompt' } } }
                        })
                      }
                    >
                      {t('detail.gitWorkflowTargetPrompt')}
                    </button>
                    <button
                      type="button"
                      className={`quiet-control rounded-[12px] px-3 py-2 text-left text-[11px] ${selectedNode.data.config.target.mode === 'fixed' ? 'bg-[color:var(--color-primary)]/10' : ''}`}
                      onClick={() =>
                        runner.updateNodeConfig(selectedNode.id, (data) => {
                          const next = data as SwitchNodeData
                          return { ...next, config: { ...next.config, target: { mode: 'fixed', branch: runner.branchTargetOptions[0] || '' } } }
                        })
                      }
                    >
                      {t('detail.gitWorkflowTargetFixed')}
                    </button>
                  </div>
                  {selectedNode.data.config.target.mode === 'fixed' && (
                    <Combobox
                      ariaLabel={t('detail.gitWorkflowSwitchTarget')}
                      value={selectedNode.data.config.target.branch}
                      options={runner.branchTargetOptions.map((branch) => ({ value: branch, label: branch }))}
                      onChange={(value) =>
                        runner.updateNodeConfig(selectedNode.id, (data) => {
                          const next = data as SwitchNodeData
                          return { ...next, config: { ...next.config, target: { mode: 'fixed', branch: value } } }
                        })
                      }
                      triggerPlaceholder={t('detail.gitWorkflowSwitchTarget')}
                      inputPlaceholder={t('detail.gitWorkflowSwitchTarget')}
                      emptyText={t('detail.branchPanelNoBranches')}
                      triggerClassName="h-9 rounded-[12px] px-3 text-[11px]"
                      contentClassName="surface-card rounded-[12px] p-1"
                      optionClassName="rounded-[8px] px-2 py-1.5 text-[11px]"
                    />
                  )}
                </div>
              )}

              {selectedNode.data.operation === 'merge' && (
                <div className="space-y-2">
                  <p className="text-[10.5px] uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">{t('detail.gitWorkflowMergeSource')}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      className={`quiet-control rounded-[12px] px-3 py-2 text-left text-[11px] ${selectedNode.data.config.source.mode === 'prompt' ? 'bg-[color:var(--color-primary)]/10' : ''}`}
                      onClick={() =>
                        runner.updateNodeConfig(selectedNode.id, (data) => {
                          const next = data as MergeNodeData
                          return { ...next, config: { ...next.config, source: { mode: 'prompt' }, noEdit: true } }
                        })
                      }
                    >
                      {t('detail.gitWorkflowTargetPrompt')}
                    </button>
                    <button
                      type="button"
                      className={`quiet-control rounded-[12px] px-3 py-2 text-left text-[11px] ${selectedNode.data.config.source.mode === 'fixed' ? 'bg-[color:var(--color-primary)]/10' : ''}`}
                      onClick={() =>
                        runner.updateNodeConfig(selectedNode.id, (data) => {
                          const next = data as MergeNodeData
                          return { ...next, config: { ...next.config, source: { mode: 'fixed', branch: runner.branchTargetOptions[0] || '' }, noEdit: true } }
                        })
                      }
                    >
                      {t('detail.gitWorkflowTargetFixed')}
                    </button>
                  </div>
                  {selectedNode.data.config.source.mode === 'fixed' && (
                    <Combobox
                      ariaLabel={t('detail.gitWorkflowMergeSource')}
                      value={selectedNode.data.config.source.branch}
                      options={runner.branchTargetOptions.map((branch) => ({ value: branch, label: branch }))}
                      onChange={(value) =>
                        runner.updateNodeConfig(selectedNode.id, (data) => {
                          const next = data as MergeNodeData
                          return { ...next, config: { ...next.config, source: { mode: 'fixed', branch: value }, noEdit: true } }
                        })
                      }
                      triggerPlaceholder={t('detail.gitWorkflowMergeSource')}
                      inputPlaceholder={t('detail.gitWorkflowMergeSource')}
                      emptyText={t('detail.branchPanelNoBranches')}
                      triggerClassName="h-9 rounded-[12px] px-3 text-[11px]"
                      contentClassName="surface-card rounded-[12px] p-1"
                      optionClassName="rounded-[8px] px-2 py-1.5 text-[11px]"
                    />
                  )}
                </div>
              )}

              {selectedNode.data.operation === 'commit' && (
                <label htmlFor="git-workflow-commit-preset" className="block">
                  <span className="mb-1 block text-[10.5px] uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">{t('detail.gitWorkflowCommitPreset')}</span>
                  <Textarea
                    id="git-workflow-commit-preset"
                    value={selectedNode.data.config.message.preset || ''}
                    onChange={(event) =>
                      runner.updateNodeConfig(selectedNode.id, (data) => {
                        const next = data as CommitNodeData
                        return { ...next, config: { ...next.config, message: { ...next.config.message, preset: event.target.value || undefined } } }
                      })
                    }
                    placeholder={t('detail.gitWorkflowCommitPresetPlaceholder')}
                    className="min-h-[96px] text-[12px]"
                  />
                </label>
              )}

              <label className="block">
                <span className="mb-1 block text-[10.5px] uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">{t('detail.gitWorkflowFailurePolicy')}</span>
                <select
                  value={selectedNode.data.failurePolicy}
                  onChange={(event) => runner.updateNodeConfig(selectedNode.id, (data) => ({ ...data, failurePolicy: event.target.value as GitWorkflowNodeData['failurePolicy'] }))}
                  className="h-9 w-full rounded-[12px] border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-3 text-[12px] text-[color:var(--color-foreground)] outline-none"
                >
                  <option value="pause">{t('detail.gitWorkflowFailurePause')}</option>
                  <option value="follow-failure-edge">{t('detail.gitWorkflowFailureFollowEdge')}</option>
                </select>
              </label>

              <button type="button" className="quiet-control inline-flex w-full items-center justify-center gap-1 rounded-[12px] px-3 py-2 text-[11px] text-[color:var(--color-destructive)]" onClick={() => runner.deleteNode(selectedNode.id)}>
                <Trash2 className="h-3.5 w-3.5" />
                {t('detail.gitWorkflowRemoveNode')}
              </button>
            </div>
          ) : (
            <p className="rounded-[14px] border border-dashed border-[color:var(--color-border)] px-3 py-4 text-[12px] text-[color:var(--color-muted-foreground)]">{t('detail.gitWorkflowInspectorEmpty')}</p>
          )}
        </div>

        <div className="rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]/65 p-3">
          <p className="section-label mb-2">{t('detail.gitWorkflowStatusTitle')}</p>
          <p className="text-[12px] text-[color:var(--color-foreground)]">{runStatusText}</p>
          {runner.validationResult.issues.length > 0 && (
            <div className="mt-2 space-y-1 text-[10.5px]">
              {runner.validationResult.issues.slice(0, 3).map((issue) => (
                <p key={`${issue.code}-${issue.message || ''}`} className={issue.level === 'error' ? 'text-[color:var(--color-destructive)]' : 'text-[color:var(--color-warning)]'}>
                  {issue.message || issue.code}
                </p>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button type="button" className="quiet-control flex-1 rounded-full px-3 py-2 text-[11px]" onClick={handleSaveGraph}>
            {t('detail.gitWorkflowSave')}
          </button>
          <button
            type="button"
            className="flex-1 rounded-full bg-primary px-3 py-2 text-[11px] font-medium text-white"
            onClick={() => void runner.startWorkflow()}
            disabled={!runner.graph.entryNodeId || runner.runState.status === 'running' || runner.runState.status === 'waiting-for-confirmation' || runner.runState.status === 'waiting-for-input'}
          >
            {t('detail.gitWorkflowRun')}
          </button>
        </div>
        {runner.runState.status === 'waiting-for-input' && runner.runtimeTarget
          ? (() => {
              const runtimeTarget = runner.runtimeTarget
              return (
                <div className="rounded-[14px] border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning-background)]/45 p-3">
                  <p className="mb-2 text-[11px] font-medium text-[color:var(--color-foreground)]">{t('detail.gitWorkflowChooseTarget')}</p>
                  <Combobox
                    ariaLabel={t('detail.gitWorkflowChooseTarget')}
                    value={runner.runtimeTargetValue}
                    options={runner.branchTargetOptions.map((branch) => ({ value: branch, label: branch }))}
                    onChange={(value) => runner.setRuntimeTargetForNode(runtimeTarget.nodeId, value)}
                    triggerPlaceholder={t('detail.gitWorkflowChooseTarget')}
                    inputPlaceholder={t('detail.gitWorkflowChooseTarget')}
                    emptyText={t('detail.branchPanelNoBranches')}
                    triggerClassName="h-9 rounded-[12px] px-3 text-[11px]"
                    contentClassName="surface-card rounded-[12px] p-1"
                    optionClassName="rounded-[8px] px-2 py-1.5 text-[11px]"
                  />
                  <button type="button" className="mt-2 quiet-control w-full rounded-full px-3 py-2 text-[11px]" onClick={() => void runner.continueRuntimeTarget()} disabled={!runner.runtimeTargetValue}>
                    {t('detail.gitWorkflowContinue')}
                  </button>
                </div>
              )
            })()
          : null}
      </div>
    </div>
  )
}

export function DetailAiCommitGitWorkflowCanvas({ runner }: { runner: WorkflowRunner }) {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner runner={runner} />
    </ReactFlowProvider>
  )
}
