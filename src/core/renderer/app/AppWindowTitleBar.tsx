import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Copy, Minus, Square, X } from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import { useI18n } from '../i18n'
import { resolveWindowTitle } from './windowTitle'

const WINDOW_ICON_SRC = new URL('../../../../icon/Y.png', import.meta.url).href

function useWindowTitleText(): string {
  const location = useLocation()
  const projects = useAppStore((s) => s.projects)
  const { t, getSettingsSectionLabel } = useI18n()

  return useMemo(
    () =>
      resolveWindowTitle(
        location.pathname,
        projects,
        getSettingsSectionLabel,
        t('appName'),
        t('settings.title')
      ),
    [getSettingsSectionLabel, location.pathname, projects, t]
  )
}

export function WindowTitleSync() {
  const title = useWindowTitleText()

  useEffect(() => {
    if (document.title !== title) {
      document.title = title
    }
  }, [title])

  return null
}

export function AppWindowTitleBar() {
  const [isMaximized, setIsMaximized] = useState(false)
  const title = useWindowTitleText()
  const { t } = useI18n()

  useEffect(() => {
    let alive = true

    const sync = async () => {
      try {
        const next = await window.electronAPI.isWindowMaximized()
        if (alive) setIsMaximized(Boolean(next))
      } catch {
        // ignore and keep current state
      }
    }

    void sync()
    const unsubscribe = window.electronAPI.onWindowState(({ isMaximized: next }) => {
      setIsMaximized(Boolean(next))
    })

    return () => {
      alive = false
      unsubscribe()
    }
  }, [])

  return (
    <div className="window-titlebar">
      <div className="window-titlebar__drag drag flex h-full min-w-0 items-center px-3">
        <img
          src={WINDOW_ICON_SRC}
          alt={`${t('appName')} icon`}
          className="mr-2 h-4 w-4 shrink-0 rounded-[4px]"
          draggable={false}
        />
        <span className="truncate text-[12px] font-medium text-[color:var(--color-muted-foreground)]">
          {title}
        </span>
      </div>
      <div className="window-titlebar__controls nodrag">
        <button
          className="window-titlebar__button window-titlebar__button--neutral"
          aria-label={t('common.minimize')}
          title={t('common.minimize')}
          onClick={() => {
            void window.electronAPI.minimizeWindow()
          }}
        >
          <Minus className="h-3.5 w-3.5" strokeWidth={1.7} />
        </button>
        <button
          className="window-titlebar__button window-titlebar__button--neutral"
          aria-label={isMaximized ? t('common.restore') : t('common.maximize')}
          title={isMaximized ? t('common.restore') : t('common.maximize')}
          onClick={() => {
            void window.electronAPI.toggleMaximizeWindow()
          }}
        >
          {isMaximized
            ? <Copy className="h-3.5 w-3.5" strokeWidth={1.7} />
            : <Square className="h-3.5 w-3.5" strokeWidth={1.7} />}
        </button>
        <button
          className="window-titlebar__button window-titlebar__button--danger"
          aria-label={t('common.closeWindow')}
          title={t('common.closeWindow')}
          onClick={() => {
            void window.electronAPI.closeWindow()
          }}
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.7} />
        </button>
      </div>
    </div>
  )
}
