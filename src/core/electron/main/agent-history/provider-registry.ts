/**
 * Unified provider registration — the single source of truth for agent mapping
 * (docs/todo/19 v2①). Adding an agent = one provider file + one line here.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AgentHistoryAgent } from '../../../shared/types/agentHistory'
import { AGENT_HISTORY_AGENTS } from '../../../shared/types/agentHistory'
import { createClaudeAgentHistoryProvider } from './providers/claude/provider'
import { createCodebuddyAgentHistoryProvider } from './providers/codebuddy/provider'
import { createCodexAgentHistoryProvider } from './providers/codex/provider'
import type { AgentHistoryProvider } from './providers/types'

export interface AgentHistoryProviderDeps {
  getHomeDir: () => string
  getCodexHome: () => string
}

export function createDefaultProviderDeps(): AgentHistoryProviderDeps {
  return {
    getHomeDir: () => homedir(),
    // Plan v2⑧: CODEX_HOME env takes precedence over the default ~/.codex.
    getCodexHome: () => process.env.CODEX_HOME || join(homedir(), '.codex'),
  }
}

export interface AgentHistoryProviderRegistry {
  all(): readonly AgentHistoryProvider[]
  get(agent: AgentHistoryAgent): AgentHistoryProvider | null
  /** Stage 8: dynamically loaded declarative providers (id = branded string). */
  dynamicProviders(): readonly AgentHistoryProvider[]
  registerDynamic(provider: AgentHistoryProvider): boolean
}

export function createAgentHistoryProviderRegistry(deps: AgentHistoryProviderDeps = createDefaultProviderDeps()): AgentHistoryProviderRegistry {
  const codexProvider = createCodexAgentHistoryProvider({ getCodexHome: deps.getCodexHome })
  const providers: readonly AgentHistoryProvider[] = [createClaudeAgentHistoryProvider({ getHomeDir: deps.getHomeDir }), createCodebuddyAgentHistoryProvider({ getHomeDir: deps.getHomeDir }), codexProvider]
  const dynamic: AgentHistoryProvider[] = []
  return {
    all: () => [...providers, ...dynamic],
    dynamicProviders: () => dynamic,
    get(agent) {
      return providers.find((provider) => provider.id === agent) ?? dynamic.find((provider) => provider.id === agent) ?? null
    },
    registerDynamic(provider) {
      if (dynamic.some((existing) => existing.id === provider.id)) return false
      dynamic.push(provider)
      return true
    },
  }
}

export function isAgentHistoryAgent(value: unknown): value is AgentHistoryAgent {
  return typeof value === 'string' && (AGENT_HISTORY_AGENTS as readonly string[]).includes(value)
}
