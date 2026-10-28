import { ArrowLeft, Check, Copy, Cpu, FolderOpen, GitBranch, Play, SendHorizontal } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentHistorySessionView } from '../../../shared/types/agentHistory'
import { AGENT_HISTORY_AGENTS } from '../../../shared/types/agentHistory'
import type { AgentHistoryRenderingConfig } from '../../../shared/types/agentHistoryRendering'
import { useI18n } from '../../i18n'
import { Select } from '../../components/ui/select'
import { SessionPreviewList } from './SessionPreviewList'

interface SessionDetailPaneProps {
  projectId: string
  projectPath: string
  renderingConfig: AgentHistoryRenderingConfig
  session: AgentHistorySessionView
  onBack: () => void
}

export function SessionDetailPane({ projectId, projectPath, renderingConfig, session, onBack }: SessionDetailPaneProps) {
  const { t, formatDateTime } = useI18n()
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [resumeState, setResumeState] = useState<'idle' | 'starting' | 'started' | 'failed'>('idle')
  const [handoffTarget, setHandoffTarget] = useState<string>('codex')
  const [handoffState, setHandoffState] = useState<'idle' | 'working' | 'created' | 'failed'>('idle')
  const [messages, setMessages] = useState<AgentHistorySessionView['previewMessages']>([])
  const [messageCursor, setMessageCursor] = useState(session.messageCount)
  const [messagesLoading, setMessagesLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const preserveScrollRef = useRef<{ height: number; top: number } | null>(null)

  const loadOlderMessages = useCallback(
    async (initial = false) => {
      if (messagesLoading || (messageCursor === 0 && !initial)) return
      setMessagesLoading(true)
      try {
        const before = initial ? session.messageCount : messageCursor
        const page = await window.electronAPI.readAgentHistoryMessages({ projectId, sessionKey: session.sessionKey, agent: session.agent, before, limit: 30 })
        if (!initial && scrollRef.current) preserveScrollRef.current = { height: scrollRef.current.scrollHeight, top: scrollRef.current.scrollTop }
        setMessages((current) => (initial ? page.messages : [...page.messages, ...current]))
        setMessageCursor(page.nextBefore ?? 0)
        if (initial)
          requestAnimationFrame(() => {
            if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
          })
      } catch {
        // Keep the already loaded conversation visible when a page read fails.
      } finally {
        setMessagesLoading(false)
      }
    },
    [messageCursor, messagesLoading, projectId, session.agent, session.messageCount, session.sessionKey],
  )

  useEffect(() => {
    void loadOlderMessages(true)
    return () => {
      setMessages([])
      setMessageCursor(0)
    }
  }, [session.sessionKey])

  useEffect(() => {
    const preserved = preserveScrollRef.current
    if (!preserved || !scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight - preserved.height + preserved.top
    preserveScrollRef.current = null
  }, [messages])

  // Stage 6: capability-driven resume — the button starts the CLI via the AI
  // Runtime chain; fork semantics (claude) mean the continued conversation
  // appears as a NEW session (UI notice below).
  const handleHandoff = async () => {
    if (handoffState === 'working' || handoffTarget === session.agent) return
    setHandoffState('working')
    try {
      const result = await window.electronAPI.createAgentHistoryHandoff({
        sourceProjectId: projectId,
        sourceSessionKey: session.sessionKey,
        targetAgent: handoffTarget,
        targetProjectId: projectId,
        mode: 'focused',
      })
      setHandoffState(result.ok ? 'created' : 'failed')
    } catch {
      setHandoffState('failed')
    }
    setTimeout(() => setHandoffState('idle'), 4000)
  }

  const handleResume = async () => {
    if (resumeState === 'starting') return
    setResumeState('starting')
    try {
      const result = await window.electronAPI.resumeAgentHistory({ projectId, sessionKey: session.sessionKey })
      setResumeState(result.ok ? 'started' : 'failed')
    } catch {
      setResumeState('failed')
    }
    setTimeout(() => setResumeState('idle'), 4000)
  }

  const resolveSessionPath = async (sessionKey: string) => {
    try {
      const result = await window.electronAPI.resolveAgentHistorySessionPath({ projectId, sessionKey })
      return result.ok ? result.filePath : null
    } catch {
      return null
    }
  }

  const handleCopyPath = async () => {
    const filePath = await resolveSessionPath(session.sessionKey)
    if (!filePath) {
      setCopyState('failed')
      setTimeout(() => setCopyState('idle'), 1500)
      return
    }
    try {
      await navigator.clipboard.writeText(filePath)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
    setTimeout(() => setCopyState('idle'), 1500)
  }

  const handleOpenFolder = async () => {
    const filePath = await resolveSessionPath(session.sessionKey)
    if (!filePath) return
    try {
      await window.electronAPI.openFolder(filePath, filePath)
    } catch {
      // best effort only
    }
  }

  const title = session.title ?? session.sessionId ?? t('agentHistory.untitled')
  const previewMessages = messages.map((message, index) => {
    if (index !== 0 || message.role !== 'user') return message
    const heading = message.text.match(/^\s{0,3}#{1,6}\s+(.+?)(?:\r?\n|$)/)
    if (!heading) return message
    const normalize = (value: string) =>
      value
        .replace(/^\s{0,3}#{1,6}\s*/, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLocaleLowerCase()
    const normalizedTitle = normalize(title)
    const normalizedHeading = normalize(heading[1])
    const isDuplicateHeading = normalizedTitle === normalizedHeading || (session.agent === 'codex' && normalizedTitle.startsWith(normalizedHeading))
    if (!isDuplicateHeading) return message
    const text = message.text.slice(heading[0].length).replace(/^\s+/, '')
    return text ? { ...message, text } : message
  })

  return (
    <>
      <header className="flex items-start gap-3 border-b border-[color:var(--color-border)]/70 bg-[color:var(--color-card)]/80 px-5 py-4 backdrop-blur-xl">
        <button type="button" aria-label={t('common.back')} className="quiet-control mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:text-[color:var(--color-foreground)] lg:hidden" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-[15px] font-medium leading-snug text-[color:var(--color-foreground)]" title={title}>
            {title}
          </h3>
          <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-[color:var(--color-muted-foreground)]">
            <span className="font-medium">{session.agent}</span>
            <span className="rounded-full bg-[color:var(--color-accent)] px-2 py-0.5">{formatDateTime(session.updatedAt)}</span>
            <span className="rounded-full bg-[color:var(--color-accent)] px-2 py-0.5">{t('agentHistory.messageCount', { count: session.messageCount })}</span>
            <button type="button" onClick={handleResume} disabled={resumeState === 'starting'} className="quiet-control inline-flex items-center gap-1 rounded-full px-2 py-0.5">
              <Play className="h-3 w-3 shrink-0" />
              {resumeState === 'starting' ? t('agentHistory.resumeStarting') : resumeState === 'started' ? t('agentHistory.resumeStarted') : resumeState === 'failed' ? t('agentHistory.resumeFailed') : t('agentHistory.resume')}
            </button>
            <Select
              ariaLabel={t('agentHistory.handoffTarget')}
              value={handoffTarget}
              textSize={11}
              className="w-[104px]"
              triggerClassName="h-6 rounded-full px-2.5"
              options={AGENT_HISTORY_AGENTS.filter((candidate) => candidate !== session.agent).map((candidate) => ({ value: candidate, label: candidate }))}
              onChange={setHandoffTarget}
              renderValue={(option) => (
                <span className="flex min-w-0 items-center gap-1">
                  <SendHorizontal className="h-3 w-3 shrink-0" />
                  {option?.label}
                </span>
              )}
            />
            <button type="button" onClick={handleHandoff} disabled={handoffState === 'working' || handoffTarget === session.agent} className="quiet-control inline-flex items-center gap-1 rounded-full px-2 py-0.5">
              {handoffState === 'working' ? t('agentHistory.handoffWorking') : handoffState === 'created' ? t('agentHistory.handoffCreated') : handoffState === 'failed' ? t('agentHistory.handoffFailed') : t('agentHistory.handoff')}
            </button>
            {session.model && (
              <span className="inline-flex max-w-[180px] items-center gap-1 truncate rounded-full bg-[color:var(--color-accent)] px-2 py-0.5">
                <Cpu className="h-3 w-3 shrink-0" />
                {session.model}
              </span>
            )}
            {session.branch && (
              <span className="inline-flex max-w-[140px] items-center gap-1 truncate rounded-full bg-[color:var(--color-accent)] px-2 py-0.5">
                <GitBranch className="h-3 w-3 shrink-0" />
                {session.branch}
              </span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            className="quiet-control inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-[color:var(--color-muted-foreground)] transition-colors hover:text-[color:var(--color-foreground)]"
            onClick={() => {
              void handleCopyPath()
            }}
          >
            {copyState === 'copied' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copyState === 'copied' ? t('agentHistory.copied') : copyState === 'failed' ? t('agentHistory.copyFailed') : t('agentHistory.copyPath')}
          </button>
          <button
            type="button"
            className="quiet-control inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-[color:var(--color-muted-foreground)] transition-colors hover:text-[color:var(--color-foreground)]"
            onClick={() => {
              void handleOpenFolder()
            }}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            {t('agentHistory.openFolder')}
          </button>
        </div>
      </header>
      <div
        ref={scrollRef}
        onScroll={(event) => {
          if (event.currentTarget.scrollTop < 100 && messageCursor > 0 && !messagesLoading) void loadOlderMessages()
        }}
        className="min-h-0 flex-1 overflow-y-auto bg-[color:var(--color-background)]/35 px-5 py-5"
      >
        {messagesLoading && <p className="mb-3 text-center text-xs text-[color:var(--color-muted-foreground)]">{t('agentHistory.loadingMore')}</p>}
        <SessionPreviewList messages={previewMessages} projectPath={projectPath} renderingConfig={renderingConfig} />
      </div>
    </>
  )
}
