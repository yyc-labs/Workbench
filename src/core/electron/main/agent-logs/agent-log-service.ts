import type {
  AgentHookLogDetail,
  AgentLogDetail,
  AgentLogSource,
  AgentLogSummary,
  AiGatewayLogDetail,
} from '../../../shared/types'

type AgentLogServiceOptions = {
  getAiGatewayLogs: () => AiGatewayLogDetail[]
  getAgentHookLogs: () => AgentHookLogDetail[]
  clearAiGatewayLogs: () => void
  clearAgentHookLogs: () => void
}

function compareByTimestampDesc(a: AgentLogSummary, b: AgentLogSummary): number {
  return b.timestamp - a.timestamp
}

function buildJsonBlock(title: string, value: unknown): string {
  if (typeof value === 'undefined') return ''
  return `## ${title}\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n`
}

function buildGatewayMarkdown(detail: AiGatewayLogDetail): string {
  return [
    '# AI Gateway Request',
    '',
    buildJsonBlock('Summary', detail.summary),
    buildJsonBlock('Meta', detail.meta),
    buildJsonBlock('Ingress Request', detail.ingressRequest),
    buildJsonBlock('Normalized Request', detail.normalizedRequest),
    buildJsonBlock('Protocol Diagnostics', detail.protocolDiagnostics),
    buildJsonBlock('Upstream Request', detail.upstreamRequest),
    buildJsonBlock('Upstream Response', detail.upstreamResponse),
    buildJsonBlock('Client Response', detail.clientResponse),
    buildJsonBlock('Stream', detail.stream),
    buildJsonBlock('Error', detail.error),
  ].join('\n').trim()
}

function buildHookMarkdown(detail: AgentHookLogDetail): string {
  return [
    '# Agent Hook Event',
    '',
    buildJsonBlock('Summary', detail.summary),
    buildJsonBlock('Meta', detail.meta),
    buildJsonBlock('Ingress Request', detail.ingressRequest),
    buildJsonBlock('Normalized Envelope', detail.normalizedEnvelope),
    buildJsonBlock('Payload', detail.payload),
    buildJsonBlock('Error', detail.error),
  ].join('\n').trim()
}

export class AgentLogService {
  private readonly getAiGatewayLogs: AgentLogServiceOptions['getAiGatewayLogs']
  private readonly getAgentHookLogs: AgentLogServiceOptions['getAgentHookLogs']
  private readonly clearAiGatewayLogs: AgentLogServiceOptions['clearAiGatewayLogs']
  private readonly clearAgentHookLogs: AgentLogServiceOptions['clearAgentHookLogs']

  constructor(options: AgentLogServiceOptions) {
    this.getAiGatewayLogs = options.getAiGatewayLogs
    this.getAgentHookLogs = options.getAgentHookLogs
    this.clearAiGatewayLogs = options.clearAiGatewayLogs
    this.clearAgentHookLogs = options.clearAgentHookLogs
  }

  listSummaries(): AgentLogSummary[] {
    return [
      ...this.getAiGatewayLogs().map((item) => item.summary),
      ...this.getAgentHookLogs().map((item) => item.summary),
    ].sort(compareByTimestampDesc)
  }

  getDetail(source: AgentLogSource, id: string): AgentLogDetail | null {
    const collection = source === 'ai-gateway'
      ? this.getAiGatewayLogs()
      : this.getAgentHookLogs()
    return collection.find((item) => item.summary.id === id) ?? null
  }

  getMarkdown(source: AgentLogSource, id: string): string {
    const detail = this.getDetail(source, id)
    if (!detail) {
      throw new Error('Agent log detail not found.')
    }
    return detail.source === 'ai-gateway'
      ? buildGatewayMarkdown(detail)
      : buildHookMarkdown(detail)
  }

  clearAll(): void {
    this.clearAiGatewayLogs()
    this.clearAgentHookLogs()
  }
}

export function createAgentLogService(options: AgentLogServiceOptions): AgentLogService {
  return new AgentLogService(options)
}
