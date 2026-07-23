import type { GatewayRequestTrace } from './gateway-trace'
import { buildStreamMergedSnapshot } from './stream-trace'

export type GatewayStreamTraceUpdate = {
  requested: boolean
  enabled: boolean
  upstreamEventCount: number
  previewEvents: unknown[]
  upstreamText: string
  upstreamPayload?: Record<string, unknown>
  clientText?: string
  clientPayload?: Record<string, unknown>
  finishReason?: string | null
  usage?: unknown
  maxBodyBytes: number
}

/** Apply a bounded, provider-neutral stream snapshot to a gateway trace. */
export function updateGatewayStreamTrace(trace: GatewayRequestTrace, update: GatewayStreamTraceUpdate): void {
  const clientText = update.clientText ?? update.upstreamText
  const clientPayload = update.clientPayload ?? update.upstreamPayload
  trace.stream = {
    ...(trace.stream ?? { requested: update.requested, enabled: update.enabled }),
    upstreamEventCount: update.upstreamEventCount,
    previewEvents: update.previewEvents,
    merged: buildStreamMergedSnapshot({
      upstreamText: update.upstreamText,
      upstreamPayload: update.upstreamPayload,
      clientText,
      clientPayload,
      finishReason: update.finishReason,
      usage: update.usage,
      maxBodyBytes: update.maxBodyBytes,
    }),
  }
}
