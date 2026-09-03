import { Handle, type NodeProps, Position } from '@xyflow/react'
import { GitBranch, GitCommitHorizontal, GitMerge, type LucideIcon, Play, ShieldCheck, Shuffle } from 'lucide-react'
import { useI18n } from '../../i18n'
import { getGitWorkflowOperationDefinition } from './gitWorkflow.operations'
import type { GitWorkflowNodeData, GitWorkflowNodeState } from './gitWorkflow.types'

type NodeRenderData = GitWorkflowNodeData & {
  state?: GitWorkflowNodeState
  validationMessages?: string[]
  active?: boolean
  selected?: boolean
  isEntry?: boolean
}

function getOperationIcon(operation: GitWorkflowNodeData['operation']): LucideIcon {
  if (operation === 'fetch') return GitBranch
  if (operation === 'pull') return GitBranch
  if (operation === 'push') return GitBranch
  if (operation === 'switch') return Shuffle
  if (operation === 'merge') return GitMerge
  return GitCommitHorizontal
}

function getNodeSummary(data: GitWorkflowNodeData): string {
  if (data.operation === 'switch') {
    return data.config.target.mode === 'fixed' ? `switch ${data.config.target.branch}` : 'switch prompt'
  }
  if (data.operation === 'merge') {
    return data.config.source.mode === 'fixed' ? `merge ${data.config.source.branch}` : 'merge prompt'
  }
  if (data.operation === 'commit') {
    if (data.config.message.mode === 'ai') {
      if (data.config.execution === 'preset-direct') return 'commit · ai direct'
      if (data.config.execution === 'skip-if-no-changes') return 'commit · ai, skip if clean'
      return 'commit · ai confirm'
    }
    const preset = data.config.message.preset
    if (data.config.execution === 'preset-direct') return preset ? `commit ${preset}` : 'commit preset'
    if (data.config.execution === 'skip-if-no-changes') return preset ? `commit ${preset}` : 'commit · skip if clean'
    return preset ? preset : 'commit prompt'
  }
  if (data.operation === 'push' && data.config.setUpstreamWhenMissing) return 'push + set upstream'
  if (data.operation === 'pull') return 'ff-only'
  return data.config.remoteName || 'default remote'
}

function getStateLabel(status: GitWorkflowNodeState['status'] | undefined, t: ReturnType<typeof useI18n>['t']): string {
  if (status === 'running') return t('detail.gitWorkflowStateRunning')
  if (status === 'succeeded') return t('detail.gitWorkflowStateSucceeded')
  if (status === 'failed') return t('detail.gitWorkflowStateFailed')
  if (status === 'cancelled') return t('detail.gitWorkflowStateCancelled')
  return t('detail.gitWorkflowStateIdle')
}

export function DetailAiCommitGitWorkflowNode(props: NodeProps<any>) {
  const { t } = useI18n()
  const data = props.data as NodeRenderData
  const definition = getGitWorkflowOperationDefinition(data.operation)
  const Icon = getOperationIcon(data.operation)
  const stateTone = data.state?.status === 'succeeded' ? 'success' : data.state?.status === 'failed' ? 'failure' : data.state?.status === 'running' ? 'running' : 'idle'

  return (
    <div className={`relative min-w-[220px] rounded-[18px] border px-3 py-3 shadow-[var(--shadow-card)] ${data.active ? 'border-[color:var(--color-primary)]/45' : 'border-[color:var(--color-border)]'} bg-[color:var(--color-card)]`}>
      {data.isEntry && (
        <span className="absolute -top-2.5 left-3 z-10 inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[9px] font-semibold text-[color:var(--color-primary-foreground)] shadow-[var(--shadow-popover)]">
          <Play className="h-2.5 w-2.5 fill-current" />
          {t('detail.gitWorkflowEntryBadge')}
        </span>
      )}
      <Handle type="target" position={Position.Left} id="input" className="!h-3.5 !w-3.5 !border-2 !border-[color:var(--color-card)] !bg-[color:var(--color-primary)]" />
      <Handle type="source" position={Position.Right} id="success" className="!top-[28%] !h-3.5 !w-3.5 !border-2 !border-[color:var(--color-card)] !bg-[color:var(--color-success)]" />
      <Handle type="source" position={Position.Right} id="failure" className="!top-[72%] !h-3.5 !w-3.5 !border-2 !border-[color:var(--color-card)] !bg-[color:var(--color-destructive)]" />
      <div className="flex items-start gap-2">
        <div
          className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
            stateTone === 'success'
              ? 'bg-[color:var(--color-success-background)] text-[color:var(--color-success)]'
              : stateTone === 'failure'
                ? 'bg-[color:var(--color-destructive-background)] text-[color:var(--color-destructive)]'
                : stateTone === 'running'
                  ? 'bg-[color:var(--color-primary)]/10 text-[color:var(--color-primary)]'
                  : 'bg-[color:var(--color-background-sunken)] text-[color:var(--color-muted-foreground)]'
          }`}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="flex items-center gap-1 truncate text-[12px] font-semibold text-[color:var(--color-foreground)]">
                <span className="truncate">{t(definition.labelKey as never)}</span>
                {data.requiresConfirmation && <ShieldCheck className="h-3 w-3 shrink-0 text-[color:var(--color-muted-foreground)]" aria-label={t('detail.gitWorkflowRequiresConfirmation')} />}
              </p>
              <p className="truncate text-[10.5px] text-[color:var(--color-muted-foreground)]">{data.label || getNodeSummary(data)}</p>
            </div>
            {data.state?.status && (
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  data.state.status === 'succeeded'
                    ? 'bg-[color:var(--color-success-background)] text-[color:var(--color-success)]'
                    : data.state.status === 'failed'
                      ? 'bg-[color:var(--color-destructive-background)] text-[color:var(--color-destructive)]'
                      : data.state.status === 'running'
                        ? 'bg-[color:var(--color-primary)]/10 text-[color:var(--color-primary)]'
                        : 'bg-[color:var(--color-background-sunken)] text-[color:var(--color-muted-foreground)]'
                }`}
              >
                {getStateLabel(data.state.status, t)}
              </span>
            )}
          </div>
          <p className="mt-1 truncate text-[10px] text-[color:var(--color-muted-foreground)]">{getNodeSummary(data)}</p>
          {data.state?.reason && <p className="mt-1 line-clamp-2 text-[10px] text-[color:var(--color-destructive)]">{data.state.reason}</p>}
          {data.validationMessages?.length ? <p className="mt-1 line-clamp-2 text-[10px] text-[color:var(--color-warning)]">{data.validationMessages[0]}</p> : null}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between text-[9.5px] uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">
        <span>{t('detail.gitWorkflowHandleInput')}</span>
        <div className="flex gap-2">
          <span>{t('detail.gitWorkflowHandleSuccess')}</span>
          <span>{t('detail.gitWorkflowHandleFailure')}</span>
        </div>
      </div>
    </div>
  )
}
