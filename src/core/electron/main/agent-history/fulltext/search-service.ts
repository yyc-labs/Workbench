/**
 * FTS5 search service (plan 20 stage 5, D3/D10 + v2.2 coverage rules).
 *
 * Semantics locked by review: ONE result per session (messages aggregated),
 * snippets ≤3, rank = best bm25 within the session. Short queries (<3 chars)
 * never hit the trigram index — they fall back to exact metadata matching on
 * small fields with an explicit degradation note. Coverage comes from the
 * known project/source state, never from DB rows alone.
 */
import { detectProjectEnvironment } from '../../../../shared/projectEnvironment'
import { projectIdFromPath } from '../../../../shared/rules'
import type { AgentHistoryAgent } from '../../../../shared/types/agentHistory'
import type { AgentHistoryCache } from '../cache/db'
import type { AgentHistoryDataSourceRegistry } from '../datasource/registry'
import type { AgentHistoryLoadConfig } from '../scan-service'
import { extractSessionText } from './extract'

export interface AgentHistorySearchArgs {
  projectId?: string
  query: string
  agent?: string
  limit?: number
  cursor?: number
}

export interface AgentHistorySearchHit {
  sessionKey: string
  projectId: string
  provider: string
  updatedAt: string
  title: string | null
  snippets: string[]
  rank: number
}

export interface AgentHistorySearchResult {
  hits: AgentHistorySearchHit[]
  hasMore: boolean
  nextCursor: number | null
  degraded: 'none' | 'short-query-metadata-only'
  coverage: {
    status: 'complete' | 'partial'
    excluded: { scope: string; reason: 'NOT_INDEXED' | 'SOURCE_FAILED' | 'TRUNCATED_SESSIONS' }[]
  }
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const INDEX_TIME_BUDGET_MS = 2_000
const INDEX_COUNT_BUDGET = 50

/** Escape user input into a safe FTS5 phrase: query syntax characters are neutralized. */
export function escapeFtsQuery(input: string): string {
  // Keep letters (any script), digits and underscore; every other char is a
  // potential FTS5 syntax token (stage 0: even '!' alone breaks the query).
  const cleaned = input.replace(/[^\p{L}\p{N}_]/gu, ' ').trim()
  if (!cleaned) return ''
  return '"' + cleaned.replace(/"/g, ' ') + '"'
}

export interface FulltextSearchDeps {
  loadConfig: AgentHistoryLoadConfig
  cache: AgentHistoryCache | null
  dataSourceRegistry: AgentHistoryDataSourceRegistry
  getDefaultWslDistro?: () => string
}

export function createFulltextSearchService(deps: FulltextSearchDeps) {
  const { loadConfig, cache, dataSourceRegistry, getDefaultWslDistro } = deps

  function resolveProject(projectId: string) {
    const project = loadConfig().projects.find((candidate) => projectIdFromPath(candidate.path) === projectId)
    if (!project) return null
    return { path: project.path, environment: detectProjectEnvironment(project.path) === 'ubuntu' ? ('wsl' as const) : ('windows' as const) }
  }

  /** Lazy indexing within a time/count budget; failures mark nothing and stay covered by NOT_INDEXED. */
  async function ensureIndexBudget(projectId: string | undefined): Promise<void> {
    if (!cache) return
    const pending = cache.listUnindexedSessions(projectId ?? '', INDEX_COUNT_BUDGET)
    const deadline = Date.now() + INDEX_TIME_BUDGET_MS
    for (const item of pending) {
      if (Date.now() > deadline) break
      const project = resolveProject(item.projectId)
      if (!project) continue
      try {
        const dataSource = dataSourceRegistry.getFor({
          projectId: item.projectId,
          nativePath: project.path,
          executionEnvironment: project.environment,
          wslDistro: project.environment === 'wsl' ? (getDefaultWslDistro?.() ?? 'Ubuntu') : undefined,
        })
        const stat = await dataSource.stat(item.filePath)
        if (!stat || stat.sizeBytes === 0) continue
        const view = JSON.parse(item.dataJson) as { agent?: string }
        const agent = (view.agent ?? item.providerId) as AgentHistoryAgent
        const extracted = await extractSessionText(dataSource, agent, item.filePath, stat.sizeBytes)
        cache.indexSessionText(item.projectId, item.providerId, item.sessionKey, extracted.messages, extracted.truncated)
      } catch {
        // Unreachable source this round: leave fts_ready=0, coverage discloses it.
      }
    }
  }

  function coverageFor(projectId: string | undefined): AgentHistorySearchResult['coverage'] {
    if (!cache) return { status: 'partial', excluded: [{ scope: 'cache', reason: 'NOT_INDEXED' }] }
    const unindexed = cache.countUnindexedSessions(projectId ?? null)
    const truncated = cache.countTruncatedIndexRows()
    const excluded: AgentHistorySearchResult['coverage']['excluded'] = []
    if (unindexed > 0) excluded.push({ scope: `${unindexed} session(s)`, reason: 'NOT_INDEXED' })
    if (truncated > 0) excluded.push({ scope: `${truncated} session(s)`, reason: 'TRUNCATED_SESSIONS' })
    return { status: excluded.length === 0 ? 'complete' : 'partial', excluded }
  }

  return {
    async search(args: AgentHistorySearchArgs): Promise<AgentHistorySearchResult> {
      const query = args.query.trim()
      const limit = Math.min(Math.max(args.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
      const offset = Math.max(args.cursor ?? 0, 0)
      if (!cache || query.length === 0) {
        return { hits: [], hasMore: false, nextCursor: null, degraded: 'none', coverage: { status: 'partial', excluded: [{ scope: 'cache', reason: 'NOT_INDEXED' }] } }
      }

      await ensureIndexBudget(args.projectId)

      const isShort = [...query].length < 3
      if (isShort) {
        // Short queries: exact metadata match on small fields only (stage 0 baseline:
        // trigram cannot match 1-2 char CJK queries even on complete prefixes).
        const like = '%' + query.replace(/[%_\\]/g, '') + '%'
        const rows = cache.searchSessionMeta(like, args.projectId ?? null, args.agent ?? null, limit + 1, offset)
        const hasMore = rows.length > limit
        const hits: AgentHistorySearchHit[] = rows.slice(0, limit).map((row) => ({
          sessionKey: String(row.session_key),
          projectId: String(row.project_id),
          provider: String(row.provider_id),
          updatedAt: String(row.updated_at),
          title: row.title === null ? null : String(row.title),
          snippets: [],
          rank: 0,
        }))
        return { hits, hasMore, nextCursor: hasMore ? offset + limit : null, degraded: 'short-query-metadata-only', coverage: coverageFor(args.projectId) }
      }

      const match = escapeFtsQuery(query)
      if (!match) {
        return { hits: [], hasMore: false, nextCursor: null, degraded: 'none', coverage: coverageFor(args.projectId) }
      }
      const projectFilter = args.projectId ? 'AND m.project_id = ?' : ''
      const agentFilter = args.agent ? 'AND m.provider_id = ?' : ''
      const params: (string | number)[] = [match]
      if (args.projectId) params.push(args.projectId)
      if (args.agent) params.push(args.agent)
      const rows = cache.searchFtsSessions(params, projectFilter, agentFilter, limit + 1, offset)
      const hasMore = rows.length > limit
      const hits: AgentHistorySearchHit[] = rows.slice(0, limit).map((row) => ({
        sessionKey: String(row.session_key),
        projectId: String(row.project_id),
        provider: String(row.provider_id),
        updatedAt: row.updated_at === null ? '' : String(row.updated_at),
        title: row.title === null || row.title === undefined ? null : String(row.title),
        snippets: cache.searchFtsSnippets(String(row.session_key), match),
        rank: Number(row.rank),
      }))
      return { hits, hasMore, nextCursor: hasMore ? offset + limit : null, degraded: 'none', coverage: coverageFor(args.projectId) }
    },
  }
}
