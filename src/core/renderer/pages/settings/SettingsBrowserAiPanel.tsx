import { CheckCircle2, Globe2, LogIn, Play, Plus, RefreshCw, Save, Square, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { BrowserAiConfig, BrowserAiSite, BrowserAiSnapshot } from '../../../shared/types'
import { Button } from '../../components/ui/button'
import { Checkbox } from '../../components/ui/checkbox'
import { Input } from '../../components/ui/input'
import { Select } from '../../components/ui/select'
import { useAppStore } from '../../stores/appStore'
import { useI18n } from '../../i18n'
import { SettingsBrowserAiDeleteSiteModal } from './SettingsBrowserAiDeleteSiteModal'

function statusLabel(snapshot: BrowserAiSnapshot | null, t: (key: string) => string): string {
  if (!snapshot) return t('settings.browserAi.notConfigured')
  if (snapshot.connection === 'connected') return t('settings.browserAi.connected')
  if (snapshot.connection === 'connecting') return t('settings.browserAi.connecting')
  if (snapshot.connection === 'needs-login') return t('settings.browserAi.needsLogin')
  if (snapshot.connection === 'error') return t('settings.browserAi.error')
  return t('settings.browserAi.disconnected')
}

export function SettingsBrowserAiPanel() {
  const { t } = useI18n()
  const snapshot = useAppStore((state) => state.browserAi)
  const loadBrowserAi = useAppStore((state) => state.loadBrowserAi)
  const saveBrowserAiConfig = useAppStore((state) => state.saveBrowserAiConfig)
  const startBrowserAi = useAppStore((state) => state.startBrowserAi)
  const stopBrowserAi = useAppStore((state) => state.stopBrowserAi)
  const testBrowserAiConnection = useAppStore((state) => state.testBrowserAiConnection)
  const openBrowserAiLogin = useAppStore((state) => state.openBrowserAiLogin)
  const [draft, setDraft] = useState<BrowserAiConfig | null>(null)
  const [busy, setBusy] = useState<'load' | 'save' | 'start' | 'stop' | 'test' | 'login' | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [siteToDelete, setSiteToDelete] = useState<BrowserAiConfig['sites'][number] | null>(null)

  useEffect(() => {
    void loadBrowserAi()
  }, [loadBrowserAi])

  useEffect(() => {
    const refreshTimer = window.setInterval(() => void loadBrowserAi(), 2000)
    return () => window.clearInterval(refreshTimer)
  }, [loadBrowserAi])

  useEffect(() => {
    if (snapshot && !draft) setDraft(snapshot.config)
  }, [draft, snapshot])

  const config = draft ?? snapshot?.config
  const activeSite = config?.sites.find((site) => site.id === config.activeSiteId) ?? config?.sites[0]
  const currentStatus = statusLabel(snapshot, t)
  const profileLabel = useMemo(() => {
    if (!snapshot) return t('settings.browserAi.notConfigured')
    return snapshot.profilePath || t('settings.browserAi.profileExternal')
  }, [snapshot, t])

  const updateDraft = <K extends keyof BrowserAiConfig>(key: K, value: BrowserAiConfig[K]) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current))
    setHint(null)
  }

  const updateActiveSite = (patch: Partial<NonNullable<typeof activeSite>>) => {
    setDraft((current) => {
      if (!current || !activeSite) return current
      const sites = current.sites.map((site) => (site.id === current.activeSiteId ? { ...site, ...patch } : site))
      const nextActiveSite = sites.find((site) => site.id === current.activeSiteId) ?? sites[0]
      return {
        ...current,
        sites,
        site: nextActiveSite.site,
        siteUrl: nextActiveSite.url,
      }
    })
    setHint(null)
  }

  const selectSite = (siteId: string) => {
    setDraft((current) => {
      if (!current) return current
      const selected = current.sites.find((site) => site.id === siteId)
      if (!selected) return current
      return {
        ...current,
        activeSiteId: selected.id,
        site: selected.site,
        siteUrl: selected.url,
      }
    })
    setHint(null)
  }

  const addSite = () => {
    setDraft((current) => {
      if (!current) return current
      const id = `browser-ai-site-${Date.now().toString(36)}`
      const site = {
        id,
        name: t('settings.browserAi.defaultSiteName', { value: String(current.sites.length + 1) }),
        url: '',
        site: 'generic-web' as const,
      }
      return {
        ...current,
        sites: [...current.sites, site],
        activeSiteId: id,
        site: site.site,
        siteUrl: site.url,
      }
    })
    setHint(t('settings.browserAi.siteAdded'))
  }

  const deleteSite = () => {
    if (!config || !activeSite || config.sites.length <= 1) return
    setSiteToDelete(activeSite)
  }

  const confirmDeleteSite = () => {
    if (!siteToDelete) return
    setDraft((current) => {
      if (!current || current.sites.length <= 1) return current
      const sites = current.sites.filter((site) => site.id !== siteToDelete.id)
      const nextActiveSite = sites[0]
      if (!nextActiveSite) return current
      return {
        ...current,
        sites,
        ...(current.activeSiteId === siteToDelete.id
          ? {
              activeSiteId: nextActiveSite.id,
              site: nextActiveSite.site,
              siteUrl: nextActiveSite.url,
            }
          : {}),
      }
    })
    setSiteToDelete(null)
    setHint(t('settings.browserAi.siteDeleted'))
  }

  const save = async (): Promise<BrowserAiSnapshot | null> => {
    if (!config) return null
    setBusy('save')
    try {
      const saved = await saveBrowserAiConfig(config)
      setDraft(saved.config)
      setHint(t('settings.browserAi.saved'))
      return saved
    } finally {
      setBusy(null)
    }
  }

  const handleStart = async () => {
    setBusy('start')
    try {
      await save()
      await startBrowserAi()
    } finally {
      setBusy(null)
    }
  }

  const handleStop = async () => {
    setBusy('stop')
    try {
      await stopBrowserAi()
    } finally {
      setBusy(null)
    }
  }

  const handleTest = async () => {
    setBusy('test')
    setHint(null)
    try {
      const result = await testBrowserAiConnection()
      setHint(result.status === 'connected' ? t('settings.browserAi.testPassed') : result.status === 'needs-login' ? t('settings.browserAi.testNeedsLogin') : t('settings.browserAi.testFailed'))
    } finally {
      setBusy(null)
    }
  }

  const handleLogin = async () => {
    setBusy('login')
    try {
      await save()
      await openBrowserAiLogin()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="section-label mb-3">{t('settings.browserAi.kicker')}</p>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-[color:var(--color-foreground)]">{t('settings.browserAi.title')}</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[color:var(--color-muted-foreground)]">{t('settings.browserAi.description')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setBusy('load')
                void loadBrowserAi().finally(() => setBusy(null))
              }}
              loading={busy === 'load'}
            >
              <RefreshCw />
              {t('settings.browserAi.refresh')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void handleTest()} loading={busy === 'test'} disabled={!config}>
              <CheckCircle2 />
              {t('settings.browserAi.test')}
            </Button>
          </div>
        </div>
      </div>

      {config ? (
        <>
          <section className="surface-card space-y-5 rounded-[24px] border p-6" style={{ borderColor: 'var(--color-border)' }}>
            <div className="flex items-start gap-3">
              <Globe2 className="mt-0.5 h-5 w-5 text-[color:var(--color-primary)]" strokeWidth={1.8} />
              <div>
                <h3 className="text-sm font-semibold text-[color:var(--color-foreground)]">{t('settings.browserAi.mode')}</h3>
                <p className="mt-1 text-xs leading-5 text-[color:var(--color-muted-foreground)]">{config.mode === 'managed-edge' ? t('settings.browserAi.managedEdgeHint') : t('settings.browserAi.externalCdpHint')}</p>
              </div>
            </div>

            <label className="flex items-start gap-3 text-sm text-[color:var(--color-foreground)]">
              <Checkbox checked={config.enabled} onChange={(event) => updateDraft('enabled', event.target.checked)} />
              <span>
                <span className="block font-medium">{t('settings.browserAi.enabled')}</span>
                <span className="mt-1 block text-xs text-[color:var(--color-muted-foreground)]">{t('settings.browserAi.enabledHint')}</span>
              </span>
            </label>

            <div className="quiet-control inline-flex rounded-full p-1">
              {(['managed-edge', 'external-cdp'] as const).map((mode) => (
                <Button
                  key={mode}
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => updateDraft('mode', mode)}
                  className={`button-interactive rounded-full px-4 py-2 text-sm font-medium ${config.mode === mode ? 'bg-[color:var(--color-card)] text-[color:var(--color-foreground)] shadow-sm' : 'text-[color:var(--color-muted-foreground)]'}`}
                  aria-pressed={config.mode === mode}
                >
                  {mode === 'managed-edge' ? t('settings.browserAi.managedEdge') : t('settings.browserAi.externalCdp')}
                </Button>
              ))}
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <div className="min-w-0 space-y-1.5">
                <label className="text-xs font-medium text-[color:var(--color-foreground)]">{t('settings.browserAi.browserPath')}</label>
                <Input value={config.edgeExecutablePath ?? ''} placeholder={t('settings.browserAi.browserPathPlaceholder')} onChange={(event) => updateDraft('edgeExecutablePath', event.target.value || undefined)} />
                <p className="text-xs leading-5 text-[color:var(--color-muted-foreground)]">{t('settings.browserAi.browserPathHint')}</p>
              </div>
              {config.mode === 'external-cdp' ? (
                <div className="min-w-0 space-y-1.5">
                  <label className="text-xs font-medium text-[color:var(--color-foreground)]">{t('settings.browserAi.cdpPort')}</label>
                  <Input type="number" min={1} max={65535} value={config.cdpPort ?? ''} placeholder={t('settings.browserAi.cdpPortPlaceholder')} onChange={(event) => updateDraft('cdpPort', event.target.value ? Number(event.target.value) : undefined)} />
                  <p className="text-xs leading-5 text-[color:var(--color-muted-foreground)]">{t('settings.browserAi.cdpPortHint')}</p>
                </div>
              ) : null}
              <div className="min-w-0 space-y-1.5">
                <label className="text-xs font-medium text-[color:var(--color-foreground)]">{t('settings.browserAi.responseTimeout')}</label>
                <Input type="number" min={10} max={600} value={Math.round(config.responseTimeoutMs / 1000)} placeholder={t('settings.browserAi.responseTimeoutPlaceholder')} onChange={(event) => updateDraft('responseTimeoutMs', Math.max(10, Number(event.target.value || 120)) * 1000)} />
              </div>
            </div>

            <div className="border-t pt-6" style={{ borderColor: 'var(--color-border)' }}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h4 className="text-sm font-semibold text-[color:var(--color-foreground)]">{t('settings.browserAi.sites')}</h4>
                  <p className="mt-1 text-xs leading-5 text-[color:var(--color-muted-foreground)]">{t('settings.browserAi.siteSelectionHint')}</p>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" title={t('settings.browserAi.addSite')} onClick={addSite}>
                    <Plus />
                  </Button>
                  <Button variant="ghost" size="icon" title={t('settings.browserAi.deleteSite')} onClick={deleteSite} disabled={!activeSite || config.sites.length <= 1}>
                    <Trash2 />
                  </Button>
                </div>
              </div>
              <div className="mt-4">
                <Select ariaLabel={t('settings.browserAi.sites')} value={activeSite?.id ?? ''} options={config.sites.map((site) => ({ value: site.id, label: site.name }))} onChange={selectSite} />
              </div>

              {activeSite ? (
                <div className="mt-5 grid gap-x-5 gap-y-5 md:grid-cols-2">
                  <div className="min-w-0 space-y-1.5">
                    <label className="text-xs font-medium text-[color:var(--color-foreground)]">{t('settings.browserAi.siteName')}</label>
                    <Input value={activeSite.name} placeholder={t('settings.browserAi.siteNamePlaceholder')} onChange={(event) => updateActiveSite({ name: event.target.value })} />
                  </div>
                  <div className="min-w-0 space-y-1.5">
                    <label className="text-xs font-medium text-[color:var(--color-foreground)]">{t('settings.browserAi.siteType')}</label>
                    <Select
                      ariaLabel={t('settings.browserAi.siteType')}
                      value={activeSite.site}
                      options={[
                        { value: 'generic-web', label: t('settings.browserAi.genericWeb') },
                        { value: 'chatgpt-web', label: t('settings.browserAi.chatgptWeb') },
                      ]}
                      onChange={(value) => updateActiveSite({ site: value as BrowserAiSite })}
                    />
                    <p className="text-xs leading-5 text-[color:var(--color-muted-foreground)]">{t('settings.browserAi.siteTypeHint')}</p>
                  </div>
                  <div className="min-w-0 space-y-1.5 md:col-span-2">
                    <label className="text-xs font-medium text-[color:var(--color-foreground)]">{t('settings.browserAi.siteUrl')}</label>
                    <Input type="url" value={activeSite.url} placeholder={t('settings.browserAi.siteUrlPlaceholder')} onChange={(event) => updateActiveSite({ url: event.target.value })} />
                    <p className="text-xs leading-5 text-[color:var(--color-muted-foreground)]">{t('settings.browserAi.siteUrlHint')}</p>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="flex items-start gap-3 text-sm text-[color:var(--color-foreground)]">
                <Checkbox checked={config.keepBrowserRunning} onChange={(event) => updateDraft('keepBrowserRunning', event.target.checked)} disabled={config.mode === 'external-cdp'} />
                <span>
                  <span className="block font-medium">{t('settings.browserAi.keepRunning')}</span>
                  <span className="mt-1 block text-xs leading-5 text-[color:var(--color-muted-foreground)]">{t('settings.browserAi.keepRunningHint')}</span>
                </span>
              </label>
              <label className="flex items-start gap-3 text-sm text-[color:var(--color-foreground)]">
                <Checkbox checked={!config.headless} onChange={(event) => updateDraft('headless', !event.target.checked)} />
                <span>
                  <span className="block font-medium">{t('settings.browserAi.headed')}</span>
                  <span className="mt-1 block text-xs leading-5 text-[color:var(--color-muted-foreground)]">{t('settings.browserAi.headedHint')}</span>
                </span>
              </label>
            </div>
          </section>

          <section className="surface-card space-y-5 rounded-[24px] border p-6" style={{ borderColor: 'var(--color-border)' }}>
            <div className="grid gap-4 md:grid-cols-4">
              <div>
                <div className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.browserAi.connection')}</div>
                <div className="mt-1 text-sm font-medium text-[color:var(--color-foreground)]">{currentStatus}</div>
              </div>
              <div>
                <div className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.browserAi.browserRuntime')}</div>
                <div className="mt-1 text-sm font-medium text-[color:var(--color-foreground)]">{snapshot?.browserRunning ? t('settings.browserAi.browserRunning') : t('settings.browserAi.browserStopped')}</div>
              </div>
              <div className="md:col-span-2">
                <div className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.browserAi.profile')}</div>
                <div className="mt-1 break-all font-mono text-xs text-[color:var(--color-foreground)]">{profileLabel}</div>
              </div>
            </div>
            {snapshot?.errorMessage ? <p className="text-sm text-[color:var(--color-destructive)]">{snapshot.errorMessage}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void save()} loading={busy === 'save'}>
                <Save />
                {t('settings.browserAi.save')}
              </Button>
              <Button variant="outline" onClick={() => void handleStart()} loading={busy === 'start'}>
                <Play />
                {t('settings.browserAi.start')}
              </Button>
              <Button variant="outline" onClick={() => void handleLogin()} loading={busy === 'login'}>
                <LogIn />
                {t('settings.browserAi.openLogin')}
              </Button>
              <Button variant="outline" onClick={() => void handleStop()} loading={busy === 'stop'} disabled={!snapshot?.browserRunning}>
                <Square />
                {t('settings.browserAi.stop')}
              </Button>
            </div>
            {hint ? <p className="text-sm text-[color:var(--color-muted-foreground)]">{hint}</p> : null}
          </section>
        </>
      ) : (
        <div className="text-sm text-[color:var(--color-muted-foreground)]">{t('settings.browserAi.notConfigured')}</div>
      )}
      <SettingsBrowserAiDeleteSiteModal site={siteToDelete} onClose={() => setSiteToDelete(null)} onConfirm={confirmDeleteSite} />
    </div>
  )
}
