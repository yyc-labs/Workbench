import { BaseEdge, EdgeLabelRenderer, MarkerType, getSmoothStepPath, type EdgeProps } from '@xyflow/react'
import { useI18n } from '../../i18n'

type GitWorkflowEdgeData = {
  kind: 'success' | 'failure'
  active?: boolean
}

export function DetailAiCommitGitWorkflowEdge(props: EdgeProps<any>) {
  const { t } = useI18n()
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, markerEnd } = props
  const data = props.data as GitWorkflowEdgeData | undefined
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 18,
  })
  const isFailure = data?.kind === 'failure'
  const stroke = isFailure ? 'var(--color-destructive)' : 'var(--color-success)'
  const label = isFailure ? t('detail.gitWorkflowEdgeFailure') : t('detail.gitWorkflowEdgeSuccess')

  return (
    <>
      <BaseEdge id={id} path={path} style={{ ...style, stroke, strokeWidth: data?.active ? 2.4 : 1.8 }} markerEnd={markerEnd} />
      <EdgeLabelRenderer>
        <div
          className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
            isFailure ? 'border-[color:var(--color-destructive)]/25 bg-[color:var(--color-destructive-background)] text-[color:var(--color-destructive)]' : 'border-[color:var(--color-success)]/25 bg-[color:var(--color-success-background)] text-[color:var(--color-success)]'
          } ${data?.active ? 'shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-card)_65%,transparent)]' : ''}`}
          style={{ left: labelX, top: labelY }}
        >
          {label}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
