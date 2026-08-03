import { ChevronRight, Eye, EyeOff, Power } from 'lucide-react'
import { useEffect } from 'react'
import { useI18n } from './i18n'
import { useAppStore } from './stores/appStore'
import { resolveTheme } from './app/windowTitle'

function TrayPanelThemeSync() {
  const theme = useAppStore((s) => s.config.theme)
  const { locale } = useI18n()

  useEffect(() => {
    const applyTheme = () => {
      const nextTheme = resolveTheme(theme)
      document.documentElement.setAttribute('data-theme-mode', theme)
      document.documentElement.setAttribute('data-theme', nextTheme)
      document.documentElement.style.colorScheme = nextTheme
      document.documentElement.style.backgroundColor = 'transparent'
      document.documentElement.lang = locale
    }

    applyTheme()

    if (theme !== 'system') return

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', applyTheme)
    return () => media.removeEventListener('change', applyTheme)
  }, [locale, theme])

  return null
}

function TrayPanelInit() {
  useEffect(() => {
    let active = true

    void window.electronAPI.getConfig().then((config) => {
      if (!active) return
      useAppStore.setState((state) => ({
        config: {
          ...state.config,
          theme: config.theme,
          locale: config.locale,
          launchOnLogin: config.launchOnLogin ?? state.config.launchOnLogin,
        },
      }))
    })

    return () => {
      active = false
    }
  }, [])

  return null
}

function TrayPanelAutoSize() {
  useEffect(() => {
    let frameId = 0
    let lastWidth = 0
    let lastHeight = 0

    const sendSize = () => {
      const root = document.getElementById('root')
      const target = root?.firstElementChild instanceof HTMLElement ? root.firstElementChild : document.body
      const rect = target.getBoundingClientRect()
      const width = Math.ceil(rect.width) + 2
      const height = Math.ceil(rect.height) + 2
      if (width === lastWidth && height === lastHeight) {
        return
      }
      lastWidth = width
      lastHeight = height
      void window.electronAPI.trayPanelResizeToContent({ width, height })
    }

    const schedule = () => {
      window.cancelAnimationFrame(frameId)
      frameId = window.requestAnimationFrame(sendSize)
    }

    schedule()

    const root = document.getElementById('root')
    const target = root?.firstElementChild instanceof HTMLElement ? root.firstElementChild : document.body
    const observer = new ResizeObserver(() => {
      schedule()
    })
    observer.observe(document.body)
    observer.observe(target)
    window.addEventListener('resize', schedule)

    return () => {
      window.cancelAnimationFrame(frameId)
      observer.disconnect()
      window.removeEventListener('resize', schedule)
    }
  }, [])

  return null
}

export function TrayPanelApp() {
  const { t } = useI18n()

  return (
    <>
      <TrayPanelInit />
      <TrayPanelThemeSync />
      <TrayPanelAutoSize />
      <div className="bg-transparent p-1.5">
        <div
          className="mx-auto flex w-full max-w-[194px] flex-col overflow-hidden rounded-[14px] border shadow-[0_14px_32px_rgba(15,23,42,0.14)]"
          style={{
            borderColor: 'var(--color-border)',
            background: 'var(--color-popover-solid)',
          }}
        >
          <div className="px-3.5 py-2.5 text-[12px] font-semibold text-[color:var(--color-foreground)]">Workbench</div>

          <div className="mx-3 border-t" style={{ borderColor: 'var(--color-border)' }} />

          <div className="py-1">
            <button type="button" className="button-interactive flex h-10 w-full items-center gap-2.5 px-3.5 text-left text-[12px] font-medium text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]" onClick={() => void window.electronAPI.trayPanelShowMainWindow()}>
              <Eye className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-primary)]" strokeWidth={1.8} />
              <span className="min-w-0 flex-1">{t('common.show')}</span>
              <ChevronRight className="h-3 w-3 shrink-0 text-[color:var(--color-muted-foreground)]" strokeWidth={1.9} />
            </button>
            <button type="button" className="button-interactive flex h-10 w-full items-center gap-2.5 px-3.5 text-left text-[12px] font-medium text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]" onClick={() => void window.electronAPI.trayPanelHideMainWindow()}>
              <EyeOff className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-muted-foreground)]" strokeWidth={1.8} />
              <span className="min-w-0 flex-1">{t('common.hide')}</span>
            </button>
          </div>

          <div className="mx-3 border-t" style={{ borderColor: 'var(--color-border)' }} />

          <div className="py-1">
            <button type="button" className="button-interactive flex h-10 w-full items-center gap-2.5 px-3.5 text-left text-[12px] font-medium text-[color:var(--color-destructive)] transition-colors hover:bg-[color:var(--color-destructive-background)]" onClick={() => void window.electronAPI.trayPanelQuitApp()}>
              <Power className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
              <span className="min-w-0 flex-1">{t('common.close')}</span>
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
