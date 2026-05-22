import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { AiFlowNode } from './detail.types'
import { flowNodeTone, stepStatusText } from './detail.aiFlow.styles'

function AiFlowStepNode({ data }: NodeProps<AiFlowNode>) {
  const tone = flowNodeTone(data.status)
  return (
    <div
      className="nodrag nowheel relative flex h-full w-full flex-col overflow-hidden rounded-[18px] border px-4 py-3 transition-all duration-300"
      style={{
        borderColor: tone.border,
        background: tone.background,
        boxShadow: data.isFocused
          ? '0 12px 28px rgba(0, 0, 0, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.5)'
          : '0 6px 18px rgba(0, 0, 0, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.38)',
      }}
    >
      <span
        className="pointer-events-none absolute inset-x-0 top-0 h-[2.5px]"
        style={{ background: tone.accent, opacity: data.status === 'pending' ? 0.42 : 0.95 }}
      />
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        className="!h-2 !w-2 !border-0 !bg-transparent !opacity-0"
      />
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="!h-2 !w-2 !border-0 !bg-transparent !opacity-0"
      />
      <div className="mb-2 flex items-center justify-between gap-2">
        <span
          className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]"
          style={{ borderColor: 'color-mix(in srgb, var(--color-border) 86%, transparent)' }}
        >
          Step {data.index + 1}
        </span>
        <span
          className="rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em]"
          style={{
            color: tone.statusText,
            borderColor: tone.border,
            background: tone.statusBackground,
          }}
        >
          {stepStatusText(data.status)}
        </span>
      </div>
      <p className="truncate text-[13px] font-semibold tracking-[-0.01em] text-[color:var(--color-foreground)]" title={data.label}>
        {data.label}
      </p>
      {data.isFocused && data.detail && (
        <p className="mt-1 truncate text-[10.5px] text-[color:var(--color-muted-foreground)]" title={data.detail}>
          {data.detail}
        </p>
      )}
    </div>
  )
}

export { AiFlowStepNode }
