import type {
  AgentLogLevel,
  AgentLogSource,
  AgentLogSummary,
  AiGatewayLogRoute,
} from '../../../../shared/types'

export type AgentLogFilterSource = AgentLogSource | 'all'
export type AgentLogFilterLevel = AgentLogLevel | 'all'
export type AgentLogFilterRoute = AiGatewayLogRoute | 'all'
export type AgentLogDetailTab = 'summary' | 'request' | 'json' | 'markdown'

export type AgentLogFilters = {
  source: AgentLogFilterSource
  level: AgentLogFilterLevel
  route: AgentLogFilterRoute
  query: string
}

export type AgentLogSelection = Pick<AgentLogSummary, 'id' | 'source'>
