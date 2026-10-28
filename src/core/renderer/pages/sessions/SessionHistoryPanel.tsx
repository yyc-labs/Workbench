import { ChevronDown, RefreshCw, Search, SlidersHorizontal } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentHistorySearchResult } from '../../../shared/types/agentHistory'
import { AGENT_HISTORY_AGENTS, type AgentHistoryAgent, type AgentHistoryIssue, type AgentHistorySearchHit, type AgentHistorySessionView } from '../../../shared/types/agentHistory'
import type { AgentHistoryRenderMode } from '../../../shared/types/agentHistoryRendering'
import { DEFAULT_AGENT_HISTORY_TAG_RULES } from '../../../shared/types/agentHistoryRendering'
import { Input } from '../../components/ui/input'
import { Select } from '../../components/ui/select'
import { useI18n } from '../../i18n'
import { createCustomAgentHistoryRule, loadAgentHistoryRenderingConfig, saveAgentHistoryRenderingConfig } from '../../lib/agentHistoryRendering'
import { SessionDetailPane } from './SessionDetailPane'
import { SessionRow } from './SessionRow'

const PAGE_SIZE = 200
const WSL_PATH_PREFIXES = ['\\\\wsl.localhost\\', '\\\\wsl$\\']

function isWslProjectPath(path: string): boolean {
  const unified = path.replace(/\//g, '\\').toLowerCase()
  return WSL_PATH_PREFIXES.some((prefix) => unified.startsWith(prefix.toLowerCase()))
}

type AgentFilter = 'all' | AgentHistoryAgent

interface SessionHistoryPanelProps {
  projectId: string
  projectPath: string
  headerCollapsed?: boolean
  projectName?: string
  headerTabs?: ReactNode
}

export function SessionHistoryPanel({ projectId, projectPath, headerCollapsed = false, projectName, headerTabs }: SessionHistoryPanelProps) {
  const { t } = useI18n()
  const [agentFilter, setAgentFilter] = useState<AgentFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [sessions, setSessions] = useState<AgentHistorySessionView[]>([])
  const [issues, setIssues] = useState<AgentHistoryIssue[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [isPartial, setIsPartial] = useState(false)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadingMore, setLoadingMore] = useState(false)
  const [issuesOpen, setIssuesOpen] = useState(false)
  const [hasRemoteUpdate, setHasRemoteUpdate] = useState(false)
  const [fulltextHits, setFulltextHits] = useState<AgentHistorySearchHit[] | null>(null)
  const [fulltextDegraded, setFulltextDegraded] = useState(false)
  const [fulltextCoverage, setFulltextCoverage] = useState<AgentHistorySearchResult['coverage'] | null>(null)
  const [renderingSettingsOpen, setRenderingSettingsOpen] = useState(false)
  const [renderingConfig, setRenderingConfig] = useState(loadAgentHistoryRenderingConfig)
  const [customTagName, setCustomTagName] = useState('')
  const [customTagMode, setCustomTagMode] = useState<AgentHistoryRenderMode>('collapsible')
  const requestSeqRef = useRef(0)

  const isWsl = isWslProjectPath(projectPath)
  const agent = agentFilter === 'all' ? undefined : agentFilter

  const loadFirstPage = useCallback(async () => {
    const seq = ++requestSeqRef.current
    setStatus('loading')
    try {
      const result = await window.electronAPI.listAgentHistorySessions({ projectId, limit: PAGE_SIZE, ...(agent ? { agent } : {}) })
      if (seq !== requestSeqRef.current) return
      setSessions(result.sessions)
      setIssues(result.issues)
      setHasMore(result.hasMore)
      setNextCursor(result.nextCursor)
      setIsPartial(result.isPartial)
      setHasRemoteUpdate(false)
      setStatus('ready')
    } catch {
      if (seq !== requestSeqRef.current) return
      setStatus('error')
    }
  }, [projectId, agent])

  useEffect(() => {
    if (isWsl) {
      requestSeqRef.current += 1
      setSessions([])
      setIssues([])
      setHasMore(false)
      setNextCursor(null)
      setIsPartial(false)
      setStatus('ready')
      return
    }
    void loadFirstPage()
  }, [isWsl, loadFirstPage])

  const handleLoadMore = async () => {
    if (!nextCursor || loadingMore) return
    const seq = requestSeqRef.current
    setLoadingMore(true)
    try {
      const result = await window.electronAPI.listAgentHistorySessions({ projectId, limit: PAGE_SIZE, ...(agent ? { agent } : {}), cursor: nextCursor })
      if (seq !== requestSeqRef.current) return
      setSessions((prev) => [...prev, ...result.sessions])
      setIssues(result.issues)
      setHasMore(result.hasMore)
      setNextCursor(result.nextCursor)
      setIsPartial(result.isPartial)
    } catch {
      if (seq !== requestSeqRef.current) return
      setHasMore(false)
      setNextCursor(null)
    } finally {
      if (seq === requestSeqRef.current) setLoadingMore(false)
    }
  }

  // Stage 4: watcher lifecycle — subscribe while the page is open; change
  // events only badge the list (克制原则: no auto-reordering, user refreshes).
  useEffect(() => {
    let disposed = false
    void window.electronAPI.watchAgentHistory({ projectId, sessionKey: '' })
    const unsubscribe = window.electronAPI.onAgentHistoryChanged((data) => {
      if (!disposed && data.projectId === projectId) setHasRemoteUpdate(true)
    })
    return () => {
      disposed = true
      unsubscribe()
      void window.electronAPI.unwatchAgentHistory({ projectId, sessionKey: '' })
    }
  }, [projectId])

  // Stage 5: ≥3-char queries run server-side FTS (full text, one hit per
  // session); shorter queries keep the instant local filter (trigram cannot
  // match 1-2 char CJK — stage 0 baseline).
  useEffect(() => {
    const query = searchQuery.trim()
    if (query.length < 3) {
      setFulltextHits(null)
      setFulltextDegraded(false)
      setFulltextCoverage(null)
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      void window.electronAPI
        .searchAgentHistory({ projectId, query, limit: 200 })
        .then((result) => {
          if (cancelled) return
          setFulltextHits(result.hits)
          setFulltextDegraded(result.degraded === 'short-query-metadata-only')
          setFulltextCoverage(result.coverage)
        })
        .catch(() => {
          if (!cancelled) setFulltextHits(null)
        })
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [projectId, searchQuery])

  const filteredSessions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return sessions
    if (fulltextHits !== null) {
      // Server FTS ordering (best bm25 first); sessions missing from the index
      // stay visible if their local fields match.
      const rankBy = new Map(fulltextHits.map((hit, index) => [hit.sessionKey, index]))
      return sessions
        .filter((session) => rankBy.has(session.sessionKey) || [session.title, session.sessionId, session.model, session.branch].filter(Boolean).join('\n').toLowerCase().includes(query))
        .sort((a, b) => (rankBy.get(a.sessionKey) ?? Number.MAX_SAFE_INTEGER) - (rankBy.get(b.sessionKey) ?? Number.MAX_SAFE_INTEGER))
    }
    return sessions.filter((session) => {
      const haystack = [session.title, session.sessionId, session.model, session.branch, ...session.previewMessages.map((message) => message.text)].filter(Boolean).join('\n').toLowerCase()
      return haystack.includes(query)
    })
  }, [sessions, searchQuery, fulltextHits])

  const selectedSession = useMemo(() => sessions.find((session) => session.sessionKey === selectedKey) ?? null, [sessions, selectedKey])

  const issueLabels = issues.map((issue) => ({
    key: `${issue.agent}:${issue.code}`,
    agent: issue.agent,
    text: t(`agentHistory.issueCodes.${issue.code}` as const),
  }))

  const updateRenderingConfig = (nextConfig: typeof renderingConfig) => {
    setRenderingConfig(nextConfig)
    saveAgentHistoryRenderingConfig(nextConfig)
  }

  const addCustomTagRule = () => {
    const rule = createCustomAgentHistoryRule(customTagName, customTagMode)
    if (!rule || renderingConfig.customRules.some((item) => item.tagNames.some((tagName) => tagName.toLowerCase() === rule.tagNames[0].toLowerCase()))) return
    updateRenderingConfig({ customRules: [...renderingConfig.customRules, rule] })
    setCustomTagName('')
  }

  const renderModeOptions = [
    { value: 'collapsible', label: t('agentHistory.rendering.modeCollapsible') },
    { value: 'inline', label: t('agentHistory.rendering.modeInline') },
    { value: 'image', label: t('agentHistory.rendering.modeImage') },
    { value: 'hidden', label: t('agentHistory.rendering.modeHidden') },
  ]

  const updateTagMode = (ruleId: string, tagName: string, mode: AgentHistoryRenderMode) => {
    const defaultRule = DEFAULT_AGENT_HISTORY_TAG_RULES.find((rule) => rule.id === ruleId)
    if (defaultRule) {
      const overrideId = `override:${tagName.toLowerCase()}`
      const overrides = renderingConfig.customRules.filter((rule) => rule.id !== overrideId)
      updateRenderingConfig({ customRules: [...overrides, { ...defaultRule, id: overrideId, tagNames: [tagName], mode }] })
      return
    }
    updateRenderingConfig({ customRules: renderingConfig.customRules.map((rule) => (rule.id === ruleId ? { ...rule, mode } : rule)) })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {searchQuery.trim().length >= 3 && fulltextCoverage?.status === 'partial' && <p className="text-[11px] text-[color:var(--color-muted-foreground)]/75">{t('agentHistory.fulltextCoveragePartial')}</p>}
      {searchQuery.trim().length >= 3 && fulltextDegraded && <p className="text-[11px] text-[color:var(--color-muted-foreground)]/75">{t('agentHistory.shortQueryMetadataOnly')}</p>}
      <div className="flex flex-wrap items-center gap-2 rounded-[18px] border border-[color:var(--color-border)]/70 bg-[color:var(--color-card)]/55 p-2 shadow-[0_8px_30px_rgb(15_23_42/0.035)]">
        {headerCollapsed && (
          <div className="flex min-w-0 items-center gap-2.5">
            <p className="max-w-[140px] truncate text-sm font-medium text-[color:var(--color-foreground)]" title={projectName ?? projectPath}>
              {projectName ?? projectPath}
            </p>
            {headerTabs}
          </div>
        )}
        <div className="relative min-w-[200px] flex-1 sm:max-w-[320px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[color:var(--color-muted-foreground)]" strokeWidth={1.8} />
          <Input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={t('agentHistory.searchPlaceholder')} textSize="xs" className="quiet-control h-8 rounded-full border-0 pl-9 pr-3 text-[color:var(--color-foreground)] placeholder:text-[color:var(--color-muted-foreground)]" />
        </div>
        <Select
          ariaLabel={t('agentHistory.filterAll')}
          value={agentFilter}
          textSize="xs"
          className="min-w-[112px]"
          triggerClassName="quiet-control h-8 rounded-full px-3"
          options={[{ value: 'all', label: t('agentHistory.filterAll') }, ...AGENT_HISTORY_AGENTS.map((agent) => ({ value: agent, label: agent }))]}
          onChange={(value) => setAgentFilter(value as AgentFilter)}
        />
        <div className="flex-1" />
        <button
          type="button"
          className="quiet-control inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-[color:var(--color-muted-foreground)] transition-colors hover:text-[color:var(--color-foreground)]"
          onClick={() => {
            void loadFirstPage()
          }}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${status === 'loading' ? 'animate-spin' : ''}`} />
          {hasRemoteUpdate ? t('agentHistory.remoteUpdate') : status === 'loading' ? t('agentHistory.refreshing') : t('agentHistory.refresh')}
        </button>
      </div>

      {isPartial && <div className="rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-muted)]/40 px-3 py-1.5 text-xs text-[color:var(--color-muted-foreground)]">{t('agentHistory.partialWarning')}</div>}

      {issueLabels.length > 0 && (
        <div className="rounded-lg border border-[color:var(--color-border)] px-3 py-1.5 text-xs">
          <button type="button" className="flex w-full items-center justify-between gap-2 text-left text-[color:var(--color-muted-foreground)] transition-colors hover:text-[color:var(--color-foreground)]" aria-expanded={issuesOpen} onClick={() => setIssuesOpen((prev) => !prev)}>
            <span>{t('agentHistory.issuesTitle', { count: issueLabels.length })}</span>
            <RefreshCw className={`h-3 w-3 transition-transform ${issuesOpen ? 'rotate-90' : ''}`} />
          </button>
          {issuesOpen && (
            <ul className="mt-1.5 flex flex-col gap-1">
              {issueLabels.map((issue) => (
                <li key={issue.key} className="text-[color:var(--color-muted-foreground)]">
                  <span className="mr-1.5 font-medium">{issue.agent}</span>
                  {issue.text}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="relative flex min-h-0 flex-1 gap-4">
        <section className="flex min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-[20px] border border-[color:var(--color-border)]/75 bg-[color:var(--color-muted)]/25 lg:w-[390px] lg:shrink-0">
          <div className="flex items-center justify-between border-b border-[color:var(--color-border)]/60 px-4 py-3">
            <p className="text-[13px] font-semibold text-[color:var(--color-foreground)]">{t('agentHistory.tab')}</p>
            <button
              type="button"
              className="button-interactive rounded-full p-1 text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
              onClick={() => setRenderingSettingsOpen((value) => !value)}
              aria-expanded={renderingSettingsOpen}
              title={t('agentHistory.rendering.configure')}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
            </button>
          </div>
          {renderingSettingsOpen && (
            <div className="border-t border-[color:var(--color-border)]/60 px-4 py-3">
              <p className="text-xs font-medium text-[color:var(--color-foreground)]">{t('agentHistory.rendering.title')}</p>
              <p className="mt-1 text-[11px] leading-5 text-[color:var(--color-muted-foreground)]">{t('agentHistory.rendering.description')}</p>
              <div className="mt-3 max-h-48 space-y-1 overflow-y-auto pr-1">
                {DEFAULT_AGENT_HISTORY_TAG_RULES.flatMap((rule) =>
                  rule.tagNames.map((tagName) => {
                    const override = renderingConfig.customRules.find((item) => item.id === `override:${tagName.toLowerCase()}`)
                    const mode = override?.mode ?? rule.mode
                    return (
                      <label key={tagName} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-[11px] hover:bg-[color:var(--color-accent)]/60">
                        <code className="min-w-0 truncate text-[color:var(--color-muted-foreground)]">{`<${tagName}>`}</code>
                        <Select ariaLabel={t('agentHistory.rendering.ruleMode', { tag: tagName })} value={mode} textSize={11} className="w-[112px] shrink-0" triggerClassName="h-7 rounded-md px-2" options={renderModeOptions} onChange={(value) => updateTagMode(rule.id, tagName, value as AgentHistoryRenderMode)} />
                      </label>
                    )
                  }),
                )}
                {renderingConfig.customRules
                  .filter((rule) => !rule.id.startsWith('override:'))
                  .map((rule) => (
                    <label key={rule.id} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-[11px] hover:bg-[color:var(--color-accent)]/60">
                      <code className="min-w-0 truncate text-[color:var(--color-muted-foreground)]">{`<${rule.tagNames[0]}>`}</code>
                      <Select
                        ariaLabel={t('agentHistory.rendering.ruleMode', { tag: rule.tagNames[0] })}
                        value={rule.mode}
                        textSize={11}
                        className="w-[112px] shrink-0"
                        triggerClassName="h-7 rounded-md px-2"
                        options={renderModeOptions}
                        onChange={(value) => updateTagMode(rule.id, rule.tagNames[0], value as AgentHistoryRenderMode)}
                      />
                    </label>
                  ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Input
                  value={customTagName}
                  onChange={(event) => setCustomTagName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') addCustomTagRule()
                  }}
                  placeholder={t('agentHistory.rendering.tagPlaceholder')}
                  textSize="xs"
                  className="quiet-control h-8 min-w-[180px] flex-1 rounded-lg border-0"
                />
                <Select
                  ariaLabel={t('agentHistory.rendering.ruleMode', { tag: customTagName || t('agentHistory.rendering.tagPlaceholder') })}
                  value={customTagMode}
                  textSize="xs"
                  className="w-[112px] shrink-0"
                  triggerClassName="h-8 rounded-lg px-2"
                  options={renderModeOptions}
                  onChange={(value) => setCustomTagMode(value as AgentHistoryRenderMode)}
                />
                <button type="button" className="quiet-control rounded-lg px-3 text-xs text-[color:var(--color-foreground)]" onClick={addCustomTagRule}>
                  {t('agentHistory.rendering.add')}
                </button>
              </div>
              {renderingConfig.customRules.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {renderingConfig.customRules.map((rule) => (
                    <span key={rule.id} className="inline-flex items-center gap-1 rounded-full bg-[color:var(--color-accent)] px-2 py-1 text-[11px] text-[color:var(--color-muted-foreground)]">
                      {`<${rule.tagNames[0]}>`}
                      <button type="button" className="ml-1 text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]" onClick={() => updateRenderingConfig({ customRules: renderingConfig.customRules.filter((item) => item.id !== rule.id) })}>
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {status === 'loading' && (
              <div className="flex h-32 items-center justify-center gap-2 text-sm text-[color:var(--color-muted-foreground)]">
                <RefreshCw className="h-4 w-4 animate-spin" />
                {t('agentHistory.loading')}
              </div>
            )}
            {status === 'error' && (
              <div className="flex h-32 flex-col items-center justify-center gap-3 text-sm text-[color:var(--color-muted-foreground)]">
                <span>{t('agentHistory.error')}</span>
                <button
                  type="button"
                  className="quiet-control rounded-full px-3 py-1 text-xs text-[color:var(--color-foreground)]"
                  onClick={() => {
                    void loadFirstPage()
                  }}
                >
                  {t('agentHistory.refresh')}
                </button>
              </div>
            )}
            {status === 'ready' && filteredSessions.length === 0 && <div className="flex h-32 items-center justify-center px-4 text-center text-sm text-[color:var(--color-muted-foreground)]">{isWsl ? t('agentHistory.wslUnsupported') : sessions.length > 0 ? t('agentHistory.searchEmpty') : t('agentHistory.empty')}</div>}
            {status === 'ready' && filteredSessions.length > 0 && (
              <ul className="flex flex-col">
                {filteredSessions.map((session) => (
                  <SessionRow key={session.sessionKey} session={session} selected={session.sessionKey === selectedKey} onSelect={() => setSelectedKey(session.sessionKey)} />
                ))}
              </ul>
            )}
            {status === 'ready' && hasMore && (
              <div className="mt-3 flex justify-center">
                <button
                  type="button"
                  className="quiet-control rounded-full px-4 py-1.5 text-xs text-[color:var(--color-muted-foreground)] transition-colors hover:text-[color:var(--color-foreground)]"
                  disabled={loadingMore}
                  onClick={() => {
                    void handleLoadMore()
                  }}
                >
                  {loadingMore ? t('agentHistory.loadingMore') : t('agentHistory.loadMore')} <ChevronDown className="ml-1 inline h-3 w-3" />
                </button>
              </div>
            )}
          </div>
        </section>
        <section
          className={`min-h-0 min-w-0 flex-col overflow-hidden rounded-[22px] border border-[color:var(--color-border)]/75 bg-[color:var(--color-card)] shadow-[0_10px_35px_rgb(15_23_42/0.04)] lg:relative lg:flex lg:flex-1 ${selectedSession ? 'flex max-lg:absolute max-lg:inset-0 max-lg:z-20 max-lg:shadow-[var(--shadow-popover)]' : 'hidden'}`}
        >
          {selectedSession ? (
            <SessionDetailPane key={selectedSession.sessionKey} projectId={projectId} projectPath={projectPath} renderingConfig={renderingConfig} session={selectedSession} onBack={() => setSelectedKey(null)} />
          ) : (
            <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-[color:var(--color-muted-foreground)]">{t('agentHistory.selectHint')}</div>
          )}
        </section>
      </div>
    </div>
  )
}
