/**
 * Agent history domain assembly (docs/todo/19 §2; plan 20 stages 1/2/4):
 * provider registry + data source registry + scan service + watch service.
 * Read-only over local AI CLI session files; the renderer only ever passes
 * projectId/sessionKey — disk paths are resolved here from trusted config.
 */
import { detectProjectEnvironment } from '../../../shared/projectEnvironment'
import { projectIdFromPath } from '../../../shared/rules'
import { openAgentHistoryCacheDb } from './cache/db'
import { createAgentHistoryDataSourceRegistry } from './datasource/registry'
import { createAgentHistoryProviderRegistry } from './provider-registry'
import { type AgentHistoryScanService, createAgentHistoryScanService } from './scan-service'
import { type AgentHistoryWatchService, createAgentHistoryWatchService } from './watch-service'

export type { AgentHistoryScanService } from './scan-service'
export type { AgentHistoryWatchService } from './watch-service'

export interface AgentHistoryServiceBundle {
  service: AgentHistoryScanService
  cache: ReturnType<typeof openAgentHistoryCacheDb> | null
  dataSourceRegistry: ReturnType<typeof createAgentHistoryDataSourceRegistry>
  providers: ReturnType<typeof createAgentHistoryProviderRegistry>
}

export function createAgentHistoryServiceBundle(deps: { loadConfig: Parameters<typeof createAgentHistoryScanService>[0]['loadConfig']; getDefaultWslDistro?: () => string; getCacheDbPath?: () => string }): AgentHistoryServiceBundle {
  const providers = createAgentHistoryProviderRegistry()
  const dataSourceRegistry = createAgentHistoryDataSourceRegistry({ getDefaultWslDistro: deps.getDefaultWslDistro })
  const cache = deps.getCacheDbPath ? openAgentHistoryCacheDb(deps.getCacheDbPath()) : null
  const service = createAgentHistoryScanService({ loadConfig: deps.loadConfig, registry: providers, dataSourceRegistry, cache })
  return { service, cache, dataSourceRegistry, providers }
}

/** Stage 4: session-change notifications for open session pages (watcher → debounced rescan → event). */
export function createAgentHistoryWatchServiceFor(deps: {
  loadConfig: Parameters<typeof createAgentHistoryScanService>[0]['loadConfig']
  getDefaultWslDistro?: () => string
  service: AgentHistoryScanService
  bundle: AgentHistoryServiceBundle
  notifyChanged: (hint: { projectId: string; bursts: number }) => void
}): AgentHistoryWatchService {
  const registry = deps.bundle.providers
  const dataSourceRegistry = deps.bundle.dataSourceRegistry

  function resolveProject(projectId: string) {
    const project = deps.loadConfig().projects.find((candidate) => projectIdFromPath(candidate.path) === projectId)
    if (!project) return null
    return { path: project.path, environment: detectProjectEnvironment(project.path) === 'ubuntu' ? ('wsl' as const) : ('windows' as const) }
  }

  return createAgentHistoryWatchService({
    resolveWatchRoots: async (projectId) => {
      const project = resolveProject(projectId)
      if (!project) return []
      const dataSource = dataSourceRegistry.getFor({ projectId, nativePath: project.path, executionEnvironment: project.environment })
      const roots: { dirKey: string; dataSource: { watch(dir: string, listener: (event: { eventType: string; filename: string | null }) => void): { close(): void } } }[] = []
      for (const provider of registry.all()) {
        if (!provider.getRootDir || !dataSource.supportsWatch || typeof dataSource.watch !== 'function') continue
        try {
          const dir = await provider.getRootDir({ projectId, nativePath: project.path, executionEnvironment: project.environment }, dataSource)
          if (dir) {
            const watchable = dataSource.watch?.bind(dataSource)
            if (!watchable) continue
            roots.push({ dirKey: dir, dataSource: { watch: watchable } })
          }
        } catch {
          /* provider root unavailable → degrade for this provider */
        }
      }
      return roots
    },
    onBurst: async (projectId) => {
      await deps.service.refresh(projectId)
    },
    notifyChanged: deps.notifyChanged,
  })
}
