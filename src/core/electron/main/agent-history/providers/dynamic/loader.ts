/**
 * Dynamic provider loader (plan 20 stage 8): reads declarative provider JSONs
 * from userData/agent-history/providers/*.provider.json, validates each
 * strictly, and registers the survivors. Invalid files raise an issue-shaped
 * console warning and are skipped — never executed.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentHistoryProvider } from '../types'
import { createDynamicAgentHistoryProvider, validateDynamicProviderConfig } from './dynamic-provider'

export interface LoadDynamicProvidersResult {
  providers: AgentHistoryProvider[]
  issues: { file: string; reason: string }[]
}

export function loadDynamicProviders(storageDir: string, deps: { getHomeDir: () => string; getWslHomeDir: () => Promise<string | null> }): LoadDynamicProvidersResult {
  const dir = join(storageDir, 'agent-history', 'providers')
  const result: LoadDynamicProvidersResult = { providers: [], issues: [] }
  if (!existsSync(dir)) return result
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.provider.json')) continue
    const file = join(dir, name)
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
      const validation = validateDynamicProviderConfig(parsed)
      if (!validation.ok) {
        result.issues.push({ file: name, reason: validation.reason })
        continue
      }
      result.providers.push(createDynamicAgentHistoryProvider(validation.config, deps))
    } catch (error) {
      result.issues.push({ file: name, reason: error instanceof Error ? error.message : 'read failed' })
    }
  }
  return result
}
