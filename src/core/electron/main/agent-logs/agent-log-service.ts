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

  clearAll(): void {
    this.clearAiGatewayLogs()
    this.clearAgentHookLogs()
  }
}

export function createAgentLogService(options: AgentLogServiceOptions): AgentLogService {
  return new AgentLogService(options)
}
