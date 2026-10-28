/**
 * Data source registry (plan 20 stage 1): routes a resolved project context to
 * its data source. Windows projects share one local-fs instance; WSL projects
 * get a per-distro UNC source. SSH lands here later (stage 9) as another id.
 */

import type { AgentHistoryProjectContext } from '../../../../shared/types/agentHistory'
import { createLocalFsDataSource } from './local-fs'
import { createSshDataSource } from './ssh'
import type { AgentHistoryDataSource } from './types'
import { createWslDataSource } from './wsl'

export interface AgentHistoryDataSourceRegistry {
  getFor(context: AgentHistoryProjectContext): AgentHistoryDataSource
}

export function createAgentHistoryDataSourceRegistry(deps: { getDefaultWslDistro?: () => string } = {}): AgentHistoryDataSourceRegistry {
  const localFs = createLocalFsDataSource()
  const wslSources = new Map<string, AgentHistoryDataSource>()
  const sshSources = new Map<string, AgentHistoryDataSource>()
  return {
    getFor(context: AgentHistoryProjectContext): AgentHistoryDataSource {
      if (context.executionEnvironment === 'ssh') {
        if (!context.sshHost) throw new Error('ssh data source requires sshHost in the project context')
        const key = (context.sshUser ? context.sshUser + '@' : '') + context.sshHost + ':' + (context.sshPort ?? 22)
        let source = sshSources.get(key)
        if (!source) {
          source = createSshDataSource({ target: { host: context.sshHost, user: context.sshUser, port: context.sshPort } })
          sshSources.set(key, source)
        }
        return source
      }
      if (context.executionEnvironment !== 'wsl') return localFs
      const distro = context.wslDistro?.trim() || deps.getDefaultWslDistro?.() || 'Ubuntu'
      const key = distro.toLowerCase()
      let source = wslSources.get(key)
      if (!source) {
        source = createWslDataSource({ distro })
        wslSources.set(key, source)
      }
      return source
    },
  }
}
