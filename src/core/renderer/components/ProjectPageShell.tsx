import { ChevronDown, ChevronLeft, ChevronUp } from 'lucide-react'
import { type MouseEvent, type ReactNode, useEffect, useState } from 'react'
import { useI18n } from '../i18n'
import { middleTruncatePath } from '../lib/projectDisplay'
import { type ProjectPanePreload, type ProjectPaneTab, ProjectPaneTabs } from './ProjectPaneTabs'

const PROJECT_HEADER_COLLAPSED_STORAGE_KEY = 'app:project-header-collapsed'

function readProjectHeaderCollapsed(): boolean {
  try {
    return localStorage.getItem(PROJECT_HEADER_COLLAPSED_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Shared collapsible project-page header state: persisted to localStorage and
 * toggled by the `app:toggle-project-header` event (header mouse gesture /
 * sidebar gesture host). Extraction base: the code workspace page (Detail.tsx).
 */
export function useProjectHeaderCollapsed(): [boolean, (collapsed: boolean) => void] {
  const [collapsed, setCollapsed] = useState<boolean>(() => readProjectHeaderCollapsed())

  useEffect(() => {
    try {
      localStorage.setItem(PROJECT_HEADER_COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0')
    } catch {
      // ignore storage errors
    }
  }, [collapsed])

  useEffect(() => {
    const onToggleProjectHeader = () => {
      setCollapsed((prev) => !prev)
    }
    window.addEventListener('app:toggle-project-header', onToggleProjectHeader as EventListener)
    return () => {
      window.removeEventListener('app:toggle-project-header', onToggleProjectHeader as EventListener)
    }
  }, [])

  return [collapsed, setCollapsed]
}

interface ProjectPageShellProps {
  title: string
  path?: string
  /** Meta lines rendered under the path (environment label, errors, …). */
  titleMeta?: ReactNode
  /** Badge rendered as a sibling of the title block (e.g. run status). */
  titleBadge?: ReactNode
  onBack: () => void
  activePane: ProjectPaneTab
  onPreloadPane?: ProjectPanePreload
  onSelectPane: (pane: ProjectPaneTab) => void
  /** Extra actions rendered after the pane tabs on the right side. */
  headerRight?: ReactNode
  projectHeaderCollapsed: boolean
  onProjectHeaderCollapsedChange: (collapsed: boolean) => void
  /** Class for the inner content container (width/layout differs per page). */
  contentClassName?: string
  onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void
  children: ReactNode
}

/**
 * Shared project-page chrome extracted from the code workspace page: absolute
 * collapsible header + collapsed restore pill + content padding that tracks
 * the header state.
 */
export function ProjectPageShell({ title, path, titleMeta, titleBadge, onBack, activePane, onPreloadPane, onSelectPane, headerRight, projectHeaderCollapsed, onProjectHeaderCollapsedChange, contentClassName, onContextMenu, children }: ProjectPageShellProps) {
  const { t } = useI18n()
  const contentTopPaddingClass = projectHeaderCollapsed ? 'pt-5' : 'pt-[calc(var(--window-titlebar-height)+84px+8px)]'

  return (
    <div className="relative flex h-full flex-col" onContextMenu={onContextMenu}>
      {!projectHeaderCollapsed && (
        <header className="app-chrome pointer-events-auto absolute inset-x-0 top-0 z-[85] flex min-h-[84px] items-center justify-between px-8 py-4">
          <div className="flex min-w-0 items-center gap-4">
            <button type="button" className="rounded-full p-2 text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]" onClick={onBack}>
              <ChevronLeft className="h-5 w-5" strokeWidth={1.8} />
            </button>

            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold tracking-[-0.03em] text-[color:var(--color-foreground)]">{title}</h1>
              {path && (
                <p className="mt-0.5 truncate text-xs text-[color:var(--color-muted-foreground)]" title={path}>
                  {middleTruncatePath(path)}
                </p>
              )}
              {titleMeta}
            </div>

            {titleBadge}
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <ProjectPaneTabs activePane={activePane} onPreloadPane={onPreloadPane} onSelectPane={onSelectPane} />
            {headerRight}
          </div>

          <button
            type="button"
            aria-label={t('transcript.collapseProjectHeader')}
            title={t('transcript.collapseProjectHeader')}
            className="absolute bottom-0 left-1/2 z-[87] inline-flex h-6 w-6 -translate-x-1/2 translate-y-1/2 items-center justify-center rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-card)] text-[color:var(--color-muted-foreground)] shadow-[0_6px_18px_rgba(0,0,0,0.08)] backdrop-blur-md transition-all hover:scale-105 hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
            onClick={() => onProjectHeaderCollapsedChange(true)}
          >
            <ChevronUp className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
        </header>
      )}

      {projectHeaderCollapsed && (
        <button
          type="button"
          aria-label={t('transcript.expandProjectHeader')}
          className="app-chrome fixed left-1/2 top-[calc(var(--window-titlebar-height)+6px)] z-[86] inline-flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full border border-[color:var(--color-border)] text-[color:var(--color-muted-foreground)] shadow-[0_6px_18px_rgba(0,0,0,0.08)] backdrop-blur-md transition-all hover:scale-105 hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
          onClick={() => onProjectHeaderCollapsedChange(false)}
          title={t('transcript.expandProjectHeader')}
        >
          <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
      )}

      <div className={`min-h-0 flex-1 px-6 pb-6 sm:px-8 ${contentTopPaddingClass}`}>
        <div className={contentClassName}>{children}</div>
      </div>
    </div>
  )
}
