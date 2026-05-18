import { useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAppStore } from '../stores/appStore'
import { runtimeManager } from '../runtime/RuntimeManager'
import { detectProjectEnvironment, projectEnvironmentLabel } from '../lib/projectEnvironment'
import {
  ChevronLeft,
  Play,
  Square,
  ExternalLink,
  RefreshCw,
  Terminal,
  Zap,
  Clock,
  FolderOpen,
  BookOpen,
  Plus,
  Trash2,
} from 'lucide-react'
import { UrlPopover } from '../components/UrlPopover'

/** Map tmux status → user-facing label */
function statusLabel(status: string): string {
  switch (status) {
    case 'attached':
      return 'Active'
    case 'detached':
      return 'Background'
    case 'stopped':
      return 'Offline'
    default:
      return status
  }
}

function createDocLinkId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizeDocUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const parsed = new URL(withProtocol)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }
    return parsed.toString()
  } catch {
    return null
  }
}

export function RuntimePage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()

  const project = useAppStore((s) => s.projects.find((p) => p.id === projectId))
  const session = useAppStore((s) => (projectId ? s.sessions[projectId] : undefined))
  const devStatus = useAppStore((s) => s.processes[projectId!]?.status ?? 'stopped')
  const devUrls = useAppStore((s) => s.processUrls[projectId!] || [])
  const isDevRunning = devStatus === 'running'

  const startRuntime = useAppStore((s) => s.startRuntime)
  const stopRuntime = useAppStore((s) => s.stopRuntime)
  const openTerminal = useAppStore((s) => s.openTerminal)
  const refreshSessions = useAppStore((s) => s.refreshSessions)
  const startProject = useAppStore((s) => s.startProject)
  const stopProject = useAppStore((s) => s.stopProject)
  const setProjectDocLinks = useAppStore((s) => s.setProjectDocLinks)

  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [docTitleInput, setDocTitleInput] = useState('')
  const [docUrlInput, setDocUrlInput] = useState('')
  const [docError, setDocError] = useState<string | null>(null)
  const [runtimeError, setRuntimeError] = useState<string | null>(null)

  const handleStartRuntime = useCallback(async () => {
    if (!projectId || !project) return
    setActionLoading('start')
    try {
      setRuntimeError(null)
      // Store action: starts runtime (main process computes session name via MD5),
      // reloads runtime entries, does initial session refresh
      await startRuntime(projectId)

      // Poll until the tmux session appears (background script is async in WSL)
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 500))
        await refreshSessions()
        const s = useAppStore.getState().sessions[projectId]
        if (s && s.status !== 'stopped') break
      }
    } catch (err) {
      console.error('[RuntimePage] start runtime failed:', err)
      setRuntimeError(err instanceof Error ? err.message : String(err))
    } finally {
      setActionLoading(null)
    }
  }, [projectId, project, startRuntime, refreshSessions])

  const handleStopRuntime = useCallback(async () => {
    if (!projectId) return
    setActionLoading('stop')
    try {
      await stopRuntime(projectId)
    } catch (err) {
      console.error('[RuntimePage] stop runtime failed:', err)
    } finally {
      setActionLoading(null)
    }
  }, [projectId, stopRuntime])

  const handleOpenTerminal = useCallback(async () => {
    console.log('[RuntimePage] handleOpenTerminal called', {
      projectId,
      hasSession: !!session,
      sessionName: session?.sessionName,
      sessionStatus: session?.status,
    })
    if (!projectId || !session) {
      console.log('[RuntimePage] handleOpenTerminal BAIL — projectId or session missing')
      return
    }
    setActionLoading('openTerminal')
    try {
      console.log('[RuntimePage] calling store.openTerminal...')
      const result = await openTerminal(projectId, session?.status)
      console.log('[RuntimePage] store.openTerminal returned', result)
    } catch (err) {
      console.error('[RuntimePage] open terminal failed:', err)
    } finally {
      setTimeout(() => setActionLoading(null), 300)
    }
  }, [projectId, session, openTerminal])

  const handleRestart = useCallback(async () => {
    if (!projectId || !project || !session) return
    setActionLoading('restart')
    try {
      const sessionName = session.sessionName

      // Kill
      await runtimeManager.stopRuntime(sessionName)

      // Wait for tmux to actually remove the session (poll, not blind sleep)
      await runtimeManager.waitForSessionGone(sessionName, 10000)

      // Re-create (store action computes session name + reloads entries + refreshes)
      await startRuntime(projectId)

      // Poll until the tmux session reappears
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 500))
        await refreshSessions()
        const s = useAppStore.getState().sessions[projectId]
        if (s && s.status !== 'stopped') break
      }
    } catch (err) {
      console.error('[RuntimePage] restart failed:', err)
    } finally {
      setActionLoading(null)
    }
  }, [projectId, project, session, startRuntime, refreshSessions])

  const handleAddDocLink = useCallback(async () => {
    if (!project) return

    const normalizedUrl = normalizeDocUrl(docUrlInput)
    if (!normalizedUrl) {
      setDocError('Please enter a valid http/https URL')
      return
    }

    const duplicate = (project.docLinks ?? []).some(
      (link) => link.url.toLowerCase() === normalizedUrl.toLowerCase()
    )
    if (duplicate) {
      setDocError('This documentation link already exists')
      return
    }

    let title = docTitleInput.trim()
    if (!title) {
      try {
        title = new URL(normalizedUrl).hostname
      } catch {
        title = 'Documentation'
      }
    }

    const nextLinks = [
      ...(project.docLinks ?? []),
      { id: createDocLinkId(), title, url: normalizedUrl },
    ]

    await setProjectDocLinks(project.id, nextLinks)
    setDocTitleInput('')
    setDocUrlInput('')
    setDocError(null)
  }, [project, docTitleInput, docUrlInput, setProjectDocLinks])

  const handleRemoveDocLink = useCallback(
    async (linkId: string) => {
      if (!project) return
      const nextLinks = (project.docLinks ?? []).filter((link) => link.id !== linkId)
      await setProjectDocLinks(project.id, nextLinks)
    },
    [project, setProjectDocLinks]
  )

  const handleSetDefaultDocLink = useCallback(
    async (linkId: string) => {
      if (!project) return
      const links = project.docLinks ?? []
      const index = links.findIndex((link) => link.id === linkId)
      if (index <= 0) return

      const nextLinks = [links[index], ...links.slice(0, index), ...links.slice(index + 1)]
      await setProjectDocLinks(project.id, nextLinks)
    },
    [project, setProjectDocLinks]
  )

  const docLinks = project?.docLinks ?? []
  const defaultDocLink = docLinks[0]
  const cliLabel = (project?.cli || 'claude') === 'codex' ? 'Codex' : 'Claude'
  const environmentLabel = project ? projectEnvironmentLabel(detectProjectEnvironment(project.path)) : 'Unknown'
  const isLoading = actionLoading !== null
  const isStopped = session?.status === 'stopped'
  const isAttached = session?.status === 'attached'
  const sessionLabel = statusLabel(session?.status ?? 'stopped')

  if (!project || !projectId) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4">
        <h2 className="text-lg font-semibold text-[color:var(--color-foreground)]">Project not found</h2>
        <button
          className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary transition-colors"
          onClick={() => navigate('/')}
        >
          <ChevronLeft className="w-4 h-4" strokeWidth={1.8} />
          Back to Home
        </button>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col">
      {/* ── Header ── */}
      <header
        className="flex items-center justify-between px-6 py-4 shrink-0 border-b"
        style={{
          background: 'var(--color-card)',
          borderBottomColor: 'var(--color-border)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
        }}
      >
        <div className="flex items-center gap-4 min-w-0">
          <button
            className="p-1.5 rounded-lg text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)] transition-colors"
            onClick={() => navigate('/')}
          >
            <ChevronLeft className="w-5 h-5" strokeWidth={1.8} />
          </button>

          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-[color:var(--color-foreground)] tracking-tight truncate">
              {project.name}
            </h1>
            <p className="text-xs text-[color:var(--color-muted-foreground)] truncate">{project.path}</p>
            <p className="text-[11px] text-[color:var(--color-muted-foreground)]/85 mt-0.5">
              Environment: {environmentLabel}
            </p>
          </div>

          {/* Runtime status badge */}
          <div
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium shrink-0 ${isAttached
                ? 'bg-emerald-500/12 text-emerald-500'
                : !isStopped
                  ? 'bg-amber-500/12 text-amber-500'
                  : 'bg-[color:var(--color-secondary)]/70 text-[color:var(--color-muted-foreground)] border border-[color:var(--color-border)]'
              }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${isAttached
                  ? 'bg-emerald-500'
                  : !isStopped
                    ? 'bg-amber-500'
                    : 'bg-[color:var(--color-muted-foreground)]'
                }`}
            />
            {sessionLabel}
          </div>
        </div>

        {/* Dev server / docs actions */}
        <div className="flex items-center gap-2 shrink-0">
          {isDevRunning && devUrls.length > 0 && (
            <UrlPopover urls={devUrls}>
              <button
                className="inline-flex items-center gap-1.5 text-xs text-primary rounded-lg px-3 py-1.5 transition-colors max-w-[200px] border border-[color:var(--color-border)] bg-[color:var(--color-secondary)]/50 hover:bg-[color:var(--color-secondary)]"
                onClick={() => window.electronAPI.openExternal(devUrls[0])}
              >
                <ExternalLink className="w-3 h-3" />
                <span className="truncate">{devUrls[0]}</span>
              </button>
            </UrlPopover>
          )}
          {defaultDocLink && (
            <UrlPopover items={docLinks.map((link) => ({ url: link.url, label: link.title }))}>
              <button
                className="inline-flex items-center gap-1.5 text-xs text-[color:var(--color-muted-foreground)] rounded-lg px-3 py-1.5 transition-colors max-w-[220px] border border-[color:var(--color-border)] bg-[color:var(--color-secondary)]/40 hover:bg-[color:var(--color-secondary)]/70 hover:text-[color:var(--color-foreground)]"
                onClick={() => window.electronAPI.openExternal(defaultDocLink.url)}
                title={defaultDocLink.url}
              >
                <BookOpen className="w-3 h-3" />
                <span className="truncate">Docs: {defaultDocLink.title}</span>
              </button>
            </UrlPopover>
          )}
          <button
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${isDevRunning
                ? 'border text-red-500 hover:bg-red-500/10'
                : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)] border border-[color:var(--color-border)]'
              }`}
            style={isDevRunning ? { borderColor: 'rgba(248, 113, 113, 0.35)' } : undefined}
            onClick={() =>
              isDevRunning ? stopProject(projectId) : startProject(projectId)
            }
          >
            {isDevRunning ? (
              <>
                <Square className="w-3 h-3" /> Stop Dev
              </>
            ) : (
              <>
                <Play className="w-3 h-3" /> Run Dev
              </>
            )}
          </button>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex-1 flex flex-col min-h-0 px-6 py-6 overflow-auto">
        <div className="max-w-2xl mx-auto w-full space-y-6">
          {runtimeError && (
            <div className="rounded-xl border border-red-300/40 bg-red-500/10 text-red-600 px-4 py-3 text-sm whitespace-pre-line">
              {runtimeError}
            </div>
          )}
          {/* Runtime Status Card */}
          <div className="rounded-2xl p-6 surface-card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-[color:var(--color-foreground)] uppercase tracking-wider">
                {cliLabel} Runtime
              </h2>
              <span className="text-[11px] text-[color:var(--color-muted-foreground)] font-mono">
                {session?.sessionName ?? '—'}
              </span>
            </div>

            {/* Status indicators — primary status emphasized */}
            <div className="flex items-center gap-6 mb-6">
              <div className="flex items-center gap-2.5">
                <span
                  className={`w-3 h-3 rounded-full ${isAttached
                      ? 'bg-emerald-500'
                      : !isStopped
                        ? 'bg-amber-500'
                        : 'bg-[color:var(--color-muted-foreground)]/60'
                    }`}
                />
                <div>
                  <p className="text-sm font-semibold text-[color:var(--color-foreground)]">{sessionLabel}</p>
                  <p className="text-[10px] text-[color:var(--color-muted-foreground)]">Runtime</p>
                </div>
              </div>
              <span className="w-px h-8 bg-[color:var(--color-border)]" />
              <div className="flex items-center gap-2.5">
                <span
                  className={`w-2 h-2 rounded-full ${isAttached ? 'bg-primary' : 'bg-[color:var(--color-muted-foreground)]/55'
                    }`}
                />
                <div>
                  <p className="text-xs text-[color:var(--color-muted-foreground)]">
                    {isAttached ? 'Connected' : 'Disconnected'}
                  </p>
                </div>
              </div>
              <span className="w-px h-8 bg-[color:var(--color-border)]" />
              <div className="text-xs text-[color:var(--color-muted-foreground)]">
                Created{' '}
                <span className="text-[color:var(--color-foreground)]/75 font-mono">
                  {session?.createdAt ? new Date(session.createdAt).toLocaleTimeString() : '—'}
                </span>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-3">
              {isStopped ? (
                <button
                  disabled={isLoading}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 shadow-sm"
                  onClick={handleStartRuntime}
                >
                  {actionLoading === 'start' ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Zap className="w-4 h-4" />
                  )}
                  Start Runtime
                </button>
              ) : (
                <>
                  <button
                    disabled={isLoading}
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all bg-primary text-white hover:bg-primary-hover shadow-sm disabled:opacity-50"
                    onClick={handleOpenTerminal}
                  >
                    {actionLoading === 'openTerminal' ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Terminal className="w-4 h-4" />
                    )}
                    Open Terminal
                  </button>
                  <button
                    disabled={isLoading}
                    className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)] border border-[color:var(--color-border)] disabled:opacity-50"
                    onClick={handleRestart}
                  >
                    {actionLoading === 'restart' ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <RefreshCw className="w-4 h-4" />
                    )}
                    Restart
                  </button>
                  <button
                    disabled={isLoading}
                    className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all text-red-500 hover:text-red-600 hover:bg-red-500/10 border disabled:opacity-50"
                    style={{ borderColor: 'rgba(248, 113, 113, 0.35)' }}
                    onClick={handleStopRuntime}
                  >
                    {actionLoading === 'stop' ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Square className="w-4 h-4" />
                    )}
                    Stop
                  </button>
                </>
              )}
            </div>

            {/* Quick actions — file system */}
            <div className="flex items-center gap-3 mt-3">
              <button
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)] border border-[color:var(--color-border)]"
                onClick={() => window.electronAPI.openFolder(project.path)}
              >
                <FolderOpen className="w-4 h-4" />
                Open Folder
              </button>
              <button
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)] border border-[color:var(--color-border)]"
                onClick={() => window.electronAPI.openInVsCode(project.path)}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M17.5 3.5L6.5 8.5L2 12L6.5 15.5L17.5 20.5L17.5 17L9.5 12L17.5 7Z"
                    fill="#007ACC"
                  />
                </svg>
                Open in VS Code
              </button>
            </div>
          </div>

          {/* Project Docs */}
          <div className="rounded-2xl p-6 surface-card">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div className="min-w-0">
                <h3 className="text-xs font-semibold text-[color:var(--color-muted-foreground)] uppercase tracking-wider">
                  Documentation Links
                </h3>
                <p className="text-xs text-[color:var(--color-muted-foreground)] mt-1">
                  Save project-specific docs for quick access.
                </p>
              </div>
              <span className="text-[11px] text-[color:var(--color-muted-foreground)]">{docLinks.length} links</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[1fr_1.6fr_auto] gap-2">
              <input
                type="text"
                value={docTitleInput}
                onChange={(e) => setDocTitleInput(e.target.value)}
                placeholder="Title (optional)"
                className="h-9 px-3 rounded-lg border text-sm bg-[color:var(--color-background-sunken)] border-[color:var(--color-border)] text-[color:var(--color-foreground)] placeholder:text-[color:var(--color-muted-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <input
                type="text"
                value={docUrlInput}
                onChange={(e) => setDocUrlInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleAddDocLink()
                }}
                placeholder="docs.example.com / https://..."
                className="h-9 px-3 rounded-lg border text-sm bg-[color:var(--color-background-sunken)] border-[color:var(--color-border)] text-[color:var(--color-foreground)] placeholder:text-[color:var(--color-muted-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <button
                className="h-9 px-3 rounded-lg bg-primary text-white hover:bg-primary-hover text-sm font-medium inline-flex items-center justify-center gap-1.5"
                onClick={() => {
                  void handleAddDocLink()
                }}
              >
                <Plus className="w-3.5 h-3.5" />
                Add
              </button>
            </div>

            {docError && <p className="text-xs text-red-500 mt-2">{docError}</p>}

            {defaultDocLink && (
              <div className="mt-3 flex items-center justify-between rounded-lg border border-[color:var(--color-border)] px-3 py-2 bg-[color:var(--color-secondary)]/35">
                <span className="text-xs text-[color:var(--color-muted-foreground)] truncate">
                  Default: <span className="text-[color:var(--color-foreground)]">{defaultDocLink.title}</span>
                </span>
                <button
                  className="h-7 px-2 rounded-md text-xs text-primary hover:bg-[color:var(--color-accent)] inline-flex items-center gap-1"
                  onClick={() => window.electronAPI.openExternal(defaultDocLink.url)}
                >
                  <ExternalLink className="w-3 h-3" />
                  Open Default
                </button>
              </div>
            )}

            {docLinks.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-[color:var(--color-border)] px-4 py-4 text-xs text-[color:var(--color-muted-foreground)]">
                No documentation links yet.
              </div>
            ) : (
              <div className="mt-4 space-y-2">
                {docLinks.map((link) => (
                  <div
                    key={link.id}
                    className="flex items-center gap-2 rounded-xl border border-[color:var(--color-border)] px-3 py-2"
                  >
                    <button
                      className="flex-1 min-w-0 text-left"
                      onClick={() => window.electronAPI.openExternal(link.url)}
                      title={link.url}
                    >
                      <p className="text-sm text-[color:var(--color-foreground)] truncate">{link.title}</p>
                    </button>
                    <button
                      className="h-8 px-2 rounded-lg text-[color:var(--color-muted-foreground)] hover:text-primary hover:bg-[color:var(--color-accent)] inline-flex items-center gap-1 text-xs"
                      onClick={() => window.electronAPI.openExternal(link.url)}
                    >
                      <ExternalLink className="w-3 h-3" />
                      Open
                    </button>
                    <button
                      className="h-8 px-2 rounded-lg text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)] inline-flex items-center gap-1 text-xs"
                      onClick={() => {
                        void handleSetDefaultDocLink(link.id)
                      }}
                      disabled={docLinks[0]?.id === link.id}
                      title={docLinks[0]?.id === link.id ? 'Default link' : 'Set as default'}
                    >
                      {docLinks[0]?.id === link.id ? 'Default' : 'Set Default'}
                    </button>
                    <button
                      className="h-8 w-8 rounded-lg text-[color:var(--color-muted-foreground)] hover:text-red-500 hover:bg-red-500/10 inline-flex items-center justify-center"
                      onClick={() => {
                        void handleRemoveDocLink(link.id)
                      }}
                      title="Remove"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Activity (placeholder) */}
          <div className="rounded-2xl p-6 surface-card">
            <h3 className="text-xs font-semibold text-[color:var(--color-muted-foreground)] uppercase tracking-wider mb-3">
              Recent Activity
            </h3>
            <div className="space-y-2 text-sm font-mono">
              {isStopped ? (
                <div className="flex items-center gap-3 text-[color:var(--color-muted-foreground)]">
                  <Clock className="w-4 h-4 text-[color:var(--color-muted-foreground)]/70" strokeWidth={1.5} />
                  <span>Press "Start Runtime" to launch {cliLabel}</span>
                </div>
              ) : isAttached ? (
                <div className="flex items-center gap-3 text-[color:var(--color-muted-foreground)]">
                  <Clock className="w-4 h-4 text-[color:var(--color-muted-foreground)]/70" strokeWidth={1.5} />
                  <span>{cliLabel} runtime active, terminal connected</span>
                </div>
              ) : (
                <div className="flex items-center gap-3 text-[color:var(--color-muted-foreground)]">
                  <Clock className="w-4 h-4 text-[color:var(--color-muted-foreground)]/70" strokeWidth={1.5} />
                  <span>Session running in background</span>
                </div>
              )}
            </div>
          </div>

          {/* Runtime Info */}
          <div className="rounded-2xl p-6 surface-card">
            <h3 className="text-xs font-semibold text-[color:var(--color-muted-foreground)] uppercase tracking-wider mb-3">
              Runtime Info
            </h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-[11px] text-[color:var(--color-muted-foreground)] mb-0.5">Session</p>
                <p className="text-[color:var(--color-foreground)] font-mono text-xs">{session?.sessionName ?? '—'}</p>
              </div>
              <div>
                <p className="text-[11px] text-[color:var(--color-muted-foreground)] mb-0.5">Type</p>
                <p className="text-[color:var(--color-foreground)]">{project.type}</p>
              </div>
              <div>
                <p className="text-[11px] text-[color:var(--color-muted-foreground)] mb-0.5">Runtime</p>
                <p className="text-[color:var(--color-foreground)] font-mono text-xs">{cliLabel} Code</p>
              </div>
              <div>
                <p className="text-[11px] text-[color:var(--color-muted-foreground)] mb-0.5">Backend</p>
                <p className="text-[color:var(--color-foreground)] font-mono text-xs">tmux</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
