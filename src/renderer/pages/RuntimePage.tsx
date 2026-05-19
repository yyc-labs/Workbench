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
  const runtimeStatus = session?.status ?? 'stopped'
  const isStopped = runtimeStatus === 'stopped'
  const isAttached = runtimeStatus === 'attached'
  const sessionLabel = statusLabel(runtimeStatus)

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
      <header className="app-chrome flex min-h-[84px] items-center justify-between px-8 py-4 shrink-0">
        <div className="flex items-center gap-4 min-w-0">
          <button
            className="p-2 rounded-full text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)] transition-colors"
            onClick={() => navigate('/')}
          >
            <ChevronLeft className="w-5 h-5" strokeWidth={1.8} />
          </button>

          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-[color:var(--color-foreground)] tracking-[-0.03em] truncate">
              {project.name}
            </h1>
            <p className="mt-0.5 text-xs text-[color:var(--color-muted-foreground)] truncate">{project.path}</p>
            <p className="text-[11px] text-[color:var(--color-muted-foreground)]/85 mt-0.5">
              Environment: {environmentLabel}
            </p>
          </div>

          {/* Runtime status badge */}
          <div
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium shrink-0 ${isAttached
                ? 'bg-[color:var(--color-success-background)] text-[color:var(--color-success)]'
                : !isStopped
                  ? 'bg-[color:var(--color-warning-background)] text-[color:var(--color-warning)]'
                  : 'bg-[color:var(--color-secondary)]/70 text-[color:var(--color-muted-foreground)] border border-[color:var(--color-border)]'
              }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${isAttached
                  ? 'bg-[color:var(--color-success)]'
                  : !isStopped
                    ? 'bg-[color:var(--color-warning)]'
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
                className="quiet-control inline-flex items-center gap-1.5 text-xs text-primary rounded-full px-3 py-1.5 transition-colors max-w-[200px] border-0 hover:bg-[color:var(--color-accent)]"
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
                className="quiet-control inline-flex items-center gap-1.5 text-xs text-[color:var(--color-muted-foreground)] rounded-full px-3 py-1.5 transition-colors max-w-[220px] border-0 hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
                onClick={() => window.electronAPI.openExternal(defaultDocLink.url)}
                title={defaultDocLink.url}
              >
                <BookOpen className="w-3 h-3" />
                <span className="truncate">Docs: {defaultDocLink.title}</span>
              </button>
            </UrlPopover>
          )}
          <button
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${isDevRunning
                ? 'border text-[color:var(--color-destructive)] hover:bg-[color:var(--color-destructive-background)]'
                : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)] border border-[color:var(--color-border)]'
              }`}
            style={
              isDevRunning
                ? { borderColor: 'color-mix(in srgb, var(--color-destructive) 34%, transparent)' }
                : undefined
            }
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
      <div className="min-h-0 flex-1 overflow-auto px-8 py-8">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          {runtimeError && (
            <div className="rounded-[18px] border px-5 py-4 text-sm whitespace-pre-line text-[color:var(--color-destructive)] bg-[color:var(--color-destructive-background)] xl:col-span-2" style={{ borderColor: 'color-mix(in srgb, var(--color-destructive) 30%, transparent)' }}>
              {runtimeError}
            </div>
          )}
          <div className="space-y-6">
            <div className="rounded-[22px] p-7 surface-card">
              <div className="mb-7 flex items-center justify-between gap-4">
                <div>
                  <p className="section-label mb-2">{cliLabel} Runtime</p>
                  <div className="flex items-center gap-3">
                    <span
                      className={`h-3 w-3 rounded-full ${isAttached
                          ? 'bg-[color:var(--color-success)]'
                          : !isStopped
                            ? 'bg-[color:var(--color-warning)]'
                            : 'bg-[color:var(--color-muted-foreground)]/55'
                        }`}
                    />
                    <h2 className="text-[32px] font-semibold tracking-[-0.045em] text-[color:var(--color-foreground)]">{sessionLabel}</h2>
                  </div>
                </div>
                <span className="max-w-[260px] truncate rounded-full bg-[color:var(--color-secondary)]/45 px-3 py-1 text-[11px] font-mono text-[color:var(--color-muted-foreground)]">
                  {session?.sessionName ?? 'No session'}
                </span>
              </div>

              <div className="mb-7 grid grid-cols-3 gap-3">
                <div className="quiet-control rounded-[16px] px-4 py-3">
                  <p className="mb-1 text-[11px] text-[color:var(--color-muted-foreground)]">Connection</p>
                  <p className="text-sm font-medium text-[color:var(--color-foreground)]">{isAttached ? 'Connected' : 'Disconnected'}</p>
                </div>
                <div className="quiet-control rounded-[16px] px-4 py-3">
                  <p className="mb-1 text-[11px] text-[color:var(--color-muted-foreground)]">Created</p>
                  <p className="text-sm font-medium text-[color:var(--color-foreground)]">{session?.createdAt ? new Date(session.createdAt).toLocaleTimeString() : '--'}</p>
                </div>
                <div className="quiet-control rounded-[16px] px-4 py-3">
                  <p className="mb-1 text-[11px] text-[color:var(--color-muted-foreground)]">Backend</p>
                  <p className="text-sm font-medium text-[color:var(--color-foreground)]">tmux</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {isStopped ? (
                  <button
                    disabled={isLoading}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-semibold text-white shadow-sm transition-all disabled:opacity-50"
                    style={{ background: 'var(--color-success)' }}
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
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-primary-hover disabled:opacity-50"
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
                      className="quiet-control inline-flex items-center justify-center gap-2 rounded-full border-0 px-4 py-2.5 text-sm font-medium text-[color:var(--color-muted-foreground)] transition-all hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)] disabled:opacity-50"
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
                      className="inline-flex items-center justify-center gap-2 rounded-full border px-4 py-2.5 text-sm font-medium text-[color:var(--color-destructive)] transition-all hover:bg-[color:var(--color-destructive-background)] disabled:opacity-50"
                      style={{ borderColor: 'color-mix(in srgb, var(--color-destructive) 34%, transparent)' }}
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
            </div>

            <div className="rounded-[22px] p-6 surface-card">
              <p className="section-label mb-4">Project Actions</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                  className="quiet-control inline-flex items-center justify-center gap-2 rounded-full border-0 px-4 py-2.5 text-sm font-medium text-[color:var(--color-muted-foreground)] transition-all hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
                  onClick={() => window.electronAPI.openFolder(project.path)}
                >
                  <FolderOpen className="w-4 h-4" />
                  Open Folder
                </button>
                <button
                  className="quiet-control inline-flex items-center justify-center gap-2 rounded-full border-0 px-4 py-2.5 text-sm font-medium text-[color:var(--color-muted-foreground)] transition-all hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
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
          </div>

          <aside className="space-y-6">
            <div className="rounded-[22px] p-6 surface-card">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="section-label">Documentation</h3>
                  <p className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">Project-specific links.</p>
                </div>
                <span className="text-[11px] text-[color:var(--color-muted-foreground)]">{docLinks.length}</span>
              </div>

              <div className="grid grid-cols-1 gap-2">
              <input
                type="text"
                value={docTitleInput}
                onChange={(e) => setDocTitleInput(e.target.value)}
                placeholder="Title (optional)"
                className="quiet-control h-10 px-4 rounded-full border-0 text-sm text-[color:var(--color-foreground)] placeholder:text-[color:var(--color-muted-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <input
                type="text"
                value={docUrlInput}
                onChange={(e) => setDocUrlInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleAddDocLink()
                }}
                placeholder="docs.example.com / https://..."
                className="quiet-control h-10 px-4 rounded-full border-0 text-sm text-[color:var(--color-foreground)] placeholder:text-[color:var(--color-muted-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <button
                className="h-10 px-4 rounded-full bg-primary text-white hover:bg-primary-hover text-sm font-medium inline-flex items-center justify-center gap-1.5"
                onClick={() => {
                  void handleAddDocLink()
                }}
              >
                <Plus className="w-3.5 h-3.5" />
                Add
              </button>
            </div>

            {docError && <p className="text-xs text-[color:var(--color-destructive)] mt-2">{docError}</p>}

            {defaultDocLink && (
              <div className="quiet-control mt-4 flex items-center justify-between rounded-[16px] px-4 py-3">
                <span className="text-xs text-[color:var(--color-muted-foreground)] truncate">
                  Default: <span className="text-[color:var(--color-foreground)]">{defaultDocLink.title}</span>
                </span>
                <button
                  className="h-7 px-2 rounded-full text-xs text-primary hover:bg-[color:var(--color-accent)] inline-flex items-center gap-1"
                  onClick={() => window.electronAPI.openExternal(defaultDocLink.url)}
                >
                  <ExternalLink className="w-3 h-3" />
                  Open Default
                </button>
              </div>
            )}

            {docLinks.length === 0 ? (
              <div className="mt-5 rounded-[16px] border border-dashed border-[color:var(--color-border)] px-5 py-5 text-xs text-[color:var(--color-muted-foreground)]">
                No documentation links yet.
              </div>
            ) : (
              <div className="mt-5 space-y-2.5">
                {docLinks.map((link) => (
                  <div
                    key={link.id}
                    className="quiet-control flex items-center gap-2 rounded-[16px] px-4 py-3"
                  >
                    <button
                      className="flex-1 min-w-0 text-left"
                      onClick={() => window.electronAPI.openExternal(link.url)}
                      title={link.url}
                    >
                      <p className="text-sm text-[color:var(--color-foreground)] truncate">{link.title}</p>
                    </button>
                    <button
                      className="h-8 px-2 rounded-full text-[color:var(--color-muted-foreground)] hover:text-primary hover:bg-[color:var(--color-accent)] inline-flex items-center gap-1 text-xs"
                      onClick={() => window.electronAPI.openExternal(link.url)}
                    >
                      <ExternalLink className="w-3 h-3" />
                      Open
                    </button>
                    <button
                      className="h-8 px-2 rounded-full text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)] inline-flex items-center gap-1 text-xs"
                      onClick={() => {
                        void handleSetDefaultDocLink(link.id)
                      }}
                      disabled={docLinks[0]?.id === link.id}
                      title={docLinks[0]?.id === link.id ? 'Default link' : 'Set as default'}
                    >
                      {docLinks[0]?.id === link.id ? 'Default' : 'Set Default'}
                    </button>
                    <button
                      className="h-8 w-8 rounded-full text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-destructive)] hover:bg-[color:var(--color-destructive-background)] inline-flex items-center justify-center"
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

            <div className="rounded-[22px] p-6 surface-card">
            <h3 className="section-label mb-4">Recent Activity</h3>
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

            <div className="rounded-[22px] p-6 surface-card">
            <h3 className="section-label mb-4">Runtime Info</h3>
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
          </aside>
        </div>
      </div>
    </div>
  )
}
