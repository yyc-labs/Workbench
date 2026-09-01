import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight, FileText, FolderOpen, Menu, Save, Search, Trash2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { Editor } from '@milkdown/core'
import { Button } from '../../components/ui/button'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Input } from '../../components/ui/input'
import { SidebarGestureHost } from '../../components/SidebarGestureHost'
import { useI18n } from '../../i18n'
import { useAppStore } from '../../stores/appStore'
import { MarkdownDocumentRichEditorLazy } from './MarkdownDocumentRichEditor.lazy'
import { MarkdownDocumentReadOnlyPreview } from './MarkdownDocumentReadOnlyPreview'
import { MarkdownDocumentSourceEditor } from './MarkdownDocumentSourceEditor'
import { MarkdownFormatCascader } from './MarkdownFormatCascader'
import { getMarkdownDocumentSelectionContext } from './markdownDocumentCommands'
import type { MarkdownDocumentDisplayMode } from './markdownDocumentTypes'
import { useMarkdownDocumentScrollSync } from './useMarkdownDocumentScrollSync'

type FormatMenuState = {
  x: number
  y: number
  editor: Editor
  selectionContext: ReturnType<typeof getMarkdownDocumentSelectionContext>
}

type RichEditorSession = {
  key: string
  initialMarkdown: string
  sequence: number
}

const MARKDOWN_LEFT_SIDEBAR_COLLAPSED_STORAGE_KEY = 'app:markdown-left-sidebar-collapsed'

function modeLabel(mode: MarkdownDocumentDisplayMode, t: ReturnType<typeof useI18n>['t']): string {
  if (mode === 'rich') return t('markdownDocument.rich')
  if (mode === 'source') return t('markdownDocument.source')
  if (mode === 'preview') return t('markdownDocument.preview')
  return t('markdownDocument.split')
}

export function MarkdownDocumentPage() {
  const { t, formatDateTime } = useI18n()
  const navigate = useNavigate()
  const history = useAppStore((state) => state.markdownDocumentHistory)
  const active = useAppStore((state) => state.markdownDocumentActive)
  const value = useAppStore((state) => state.markdownDocumentValue)
  const mode = useAppStore((state) => state.markdownDocumentMode)
  const dirty = useAppStore((state) => state.markdownDocumentDirty)
  const loading = useAppStore((state) => state.markdownDocumentLoading)
  const saving = useAppStore((state) => state.markdownDocumentSaving)
  const error = useAppStore((state) => state.markdownDocumentError)
  const conflict = useAppStore((state) => state.markdownDocumentConflict)
  const compatibility = useAppStore((state) => state.markdownDocumentCompatibility)
  const complexity = useAppStore((state) => state.markdownDocumentComplexity)
  const setValue = useAppStore((state) => state.setMarkdownDocumentValue)
  const setMode = useAppStore((state) => state.setMarkdownDocumentMode)
  const save = useAppStore((state) => state.saveMarkdownDocument)
  const reload = useAppStore((state) => state.reloadMarkdownDocument)
  const loadHistory = useAppStore((state) => state.loadMarkdownDocumentHistory)
  const openDocument = useAppStore((state) => state.openMarkdownDocument)
  const removeHistory = useAppStore((state) => state.removeMarkdownDocumentHistory)
  const clearHistory = useAppStore((state) => state.clearMarkdownDocumentHistory)
  const pageRootRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const richEditorRef = useRef<Editor | null>(null)
  const flushRichEditorRef = useRef<(() => string | null) | null>(null)
  const restoredHistoryRef = useRef(false)
  const discardingRef = useRef(false)
  const [query, setQuery] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.localStorage.getItem(MARKDOWN_LEFT_SIDEBAR_COLLAPSED_STORAGE_KEY) === '1')
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)
  const [pendingRemovePath, setPendingRemovePath] = useState<string | null>(null)
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  const [formatMenu, setFormatMenu] = useState<FormatMenuState | null>(null)
  const [richEditorSession, setRichEditorSession] = useState<RichEditorSession | null>(null)
  const isDirty = dirty || Boolean(active && value !== active.content)
  const scrollMode = mode === 'rich' ? 'preview' : mode === 'source' ? 'edit' : 'split'
  const { previewRef, handleEditorScroll } = useMarkdownDocumentScrollSync(scrollMode, editorRef, active?.path ?? null)

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  useEffect(() => {
    window.localStorage.setItem(MARKDOWN_LEFT_SIDEBAR_COLLAPSED_STORAGE_KEY, sidebarCollapsed ? '1' : '0')
  }, [sidebarCollapsed])

  useEffect(() => {
    if (restoredHistoryRef.current || active || loading || history.length === 0) return
    restoredHistoryRef.current = true
    void openDocument(history[0].path)
  }, [active, history, loading, openDocument])

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirty || discardingRef.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isDirty])

  const runWithDirtyConfirmation = useCallback(
    (action: () => void) => {
      if (!isDirty) action()
      else setPendingAction(() => action)
    },
    [isDirty],
  )

  const requestOpen = useCallback((filePath: string, options?: { refreshHistory?: boolean }) => runWithDirtyConfirmation(() => void openDocument(filePath, options)), [openDocument, runWithDirtyConfirmation])

  const handleBack = useCallback(() => {
    const hash = window.location.hash
    if (hash === '#markdown-document' || hash === '#learning-center') {
      runWithDirtyConfirmation(() => {
        discardingRef.current = true
        void window.electronAPI.closeWindow()
      })
      return
    }
    navigate('/')
  }, [navigate, runWithDirtyConfirmation])

  useEffect(() => {
    void window.electronAPI.consumePendingMarkdownDocumentOpen().then((request) => {
      if (request) requestOpen(request.path, { refreshHistory: true })
    })
    return window.electronAPI.onMarkdownDocumentOpenRequested((request) => requestOpen(request.path, { refreshHistory: true }))
  }, [requestOpen])

  useEffect(() => {
    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return
      event.preventDefault()
      if (active && isDirty && !saving) {
        if (mode === 'rich' && flushRichEditorRef.current) {
          const markdown = flushRichEditorRef.current()
          if (markdown != null) setValue(markdown)
        }
        void save()
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [active, isDirty, mode, save, saving, setValue])

  const handleOpen = async () => {
    const selected = await window.electronAPI.selectMarkdownDocument()
    if (selected) runWithDirtyConfirmation(() => void openDocument(selected, { refreshHistory: true }))
  }

  const handleModeChange = useCallback(
    (nextMode: MarkdownDocumentDisplayMode) => {
      if (mode === 'rich' && nextMode !== 'rich' && flushRichEditorRef.current) {
        const markdown = flushRichEditorRef.current()
        if (markdown != null) setValue(markdown)
      }
      if (nextMode === 'rich' && mode !== 'rich' && active) {
        setRichEditorSession((session) => {
          const sequence = (session?.sequence ?? 0) + 1
          return {
            key: `${active.path}:${active.mtimeMs}:${sequence}`,
            initialMarkdown: value,
            sequence,
          }
        })
      }
      setMode(nextMode)
    },
    [active, mode, setMode, setValue, value],
  )

  const handleSave = useCallback(async () => {
    if (!active || saving) return
    if (mode === 'rich' && flushRichEditorRef.current) {
      const markdown = flushRichEditorRef.current()
      if (markdown != null) setValue(markdown)
    }
    await save()
  }, [active, mode, save, saving, setValue])

  const filteredHistory = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return normalized ? history.filter((item) => (item.displayName + ' ' + item.path).toLowerCase().includes(normalized)) : history
  }, [history, query])

  const handleRichContextMenu = useCallback((event: MouseEvent<HTMLDivElement>, editor: Editor, selectionContext: ReturnType<typeof getMarkdownDocumentSelectionContext>) => {
    event.preventDefault()
    setFormatMenu({ x: event.clientX, y: event.clientY, editor, selectionContext })
  }, [])

  return (
    <div ref={pageRootRef} className="markdown-document-workspace">
      <header className="app-chrome markdown-document-header">
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 rounded-full text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]" onClick={handleBack} title={t('common.back')} aria-label={t('common.back')}>
          <ArrowLeft className="h-4 w-4" strokeWidth={1.8} />
        </Button>
        <div className="flex min-w-0 items-center gap-3">
          <FileText className="h-5 w-5 text-[color:var(--color-primary)]" />
          <span className="font-medium">{t('markdownDocument.title')}</span>
        </div>
        <Button size="sm" onClick={() => void handleOpen()}>
          <FolderOpen className="mr-1.5 h-4 w-4" />
          {t('markdownDocument.open')}
        </Button>
        <button type="button" className="markdown-document-drawer-toggle" onClick={() => setDrawerOpen((open) => !open)} aria-label={t('markdownDocument.drawerOpen')} title={t('markdownDocument.drawerOpen')}>
          <Menu className="h-4 w-4" />
        </button>
        <div className="ml-auto flex items-center gap-1 rounded-full quiet-control p-1">
          {(['rich', 'source', 'preview', 'split'] as MarkdownDocumentDisplayMode[]).map((item) => (
            <button key={item} type="button" className={mode === item ? 'markdown-document-mode is-active' : 'markdown-document-mode'} onClick={() => handleModeChange(item)}>
              {modeLabel(item, t)}
            </button>
          ))}
        </div>
        <Button size="sm" disabled={!active || !isDirty || saving} onClick={() => void handleSave()}>
          <Save className="mr-1.5 h-4 w-4" />
          {saving ? t('common.saving') : t('common.save')}
        </Button>
        <Button size="sm" variant="ghost" disabled={!active || saving} onClick={() => setPendingRemovePath(active?.path ?? null)} title={t('markdownDocument.removeHistory')}>
          <Trash2 className="mr-1.5 h-4 w-4" />
          {t('markdownDocument.removeHistory')}
        </Button>
      </header>
      <div className={sidebarCollapsed ? 'markdown-document-body is-sidebar-collapsed' : 'markdown-document-body'}>
        {!sidebarCollapsed || drawerOpen ? (
          <aside className={drawerOpen ? 'markdown-document-sidebar surface-card is-open' : 'markdown-document-sidebar surface-card'}>
            <div className="markdown-document-sidebar-title-row">
              <span className="text-sm font-medium">{t('markdownDocument.recent')}</span>
              <button type="button" className="markdown-document-sidebar-clear" onClick={() => setClearConfirmOpen(true)}>
                {t('markdownDocument.clearHistory')}
              </button>
            </div>
            <div className="relative mt-3">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--color-muted-foreground)]" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('markdownDocument.search')} className="pl-9" />
            </div>
            <div className="mt-3 min-h-0 flex-1 overflow-auto">
              {filteredHistory.map((item) => (
                <div key={item.normalizedPath} className={active?.path === item.path ? 'markdown-document-history-item is-active group' : 'markdown-document-history-item group'}>
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => requestOpen(item.path)}>
                    <div className="truncate text-sm">{item.displayName}</div>
                    <div className="truncate text-xs text-[color:var(--color-muted-foreground)]" title={item.path}>
                      {item.path}
                    </div>
                    <div className={item.missing ? 'text-[10px] text-[color:var(--color-destructive)]' : 'text-[10px] text-[color:var(--color-muted-foreground)]'}>{item.missing ? t('markdownDocument.missing') : formatDateTime(item.lastOpenedAt)}</div>
                  </button>
                  <button
                    type="button"
                    className="opacity-0 transition-opacity group-hover:opacity-100"
                    aria-label={t('markdownDocument.removeHistory')}
                    title={t('markdownDocument.removeHistory')}
                    onClick={(event) => {
                      event.stopPropagation()
                      setPendingRemovePath(item.path)
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="markdown-document-sidebar-rail"
              onClick={() => {
                setDrawerOpen(false)
                setSidebarCollapsed(true)
              }}
              aria-label={t('markdownDocument.collapseSidebar')}
              title={t('markdownDocument.collapseSidebar')}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
          </aside>
        ) : (
          <button type="button" className="markdown-document-sidebar-rail markdown-document-sidebar-rail--expand" onClick={() => setSidebarCollapsed(false)} aria-label={t('markdownDocument.expandSidebar')} title={t('markdownDocument.expandSidebar')}>
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        )}
        <main className="markdown-document-main surface-card">
          {active ? (
            <div className="markdown-document-meta">
              <span className="truncate">{active.path}</span>
              <span className={isDirty ? 'text-[color:var(--color-primary)]' : ''}>{isDirty ? t('markdownDocument.unsaved') : t('markdownDocument.saved')}</span>
            </div>
          ) : null}
          {compatibility?.level === 'normalized' ? <div className="markdown-document-note">{t('markdownDocument.normalizedNotice')}</div> : null}
          {complexity && complexity.level !== 'normal' ? <div className="markdown-document-note">{complexity.level === 'source-first' ? t('markdownDocument.sourceFirstNotice') : t('markdownDocument.reducedNotice')}</div> : null}
          {error ? (
            <div className="markdown-document-error">
              {conflict ? t('markdownDocument.conflict') : error}
              {conflict ? (
                <Button size="sm" variant="outline" className="ml-3" onClick={() => runWithDirtyConfirmation(() => void reload())}>
                  {t('markdownDocument.reload')}
                </Button>
              ) : null}
            </div>
          ) : null}
          {!active && !loading ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <FileText className="h-10 w-10 text-[color:var(--color-muted-foreground)]" />
              <p className="text-sm text-[color:var(--color-muted-foreground)]">{t('markdownDocument.empty')}</p>
              <Button onClick={() => void handleOpen()}>{t('markdownDocument.open')}</Button>
            </div>
          ) : null}
          {loading ? <div className="flex h-full items-center justify-center text-sm text-[color:var(--color-muted-foreground)]">{t('common.loading')}</div> : null}
          {active && !loading ? (
            <div className="markdown-document-content">
              {mode === 'rich' ? (
                <Suspense fallback={<div className="flex h-full min-w-0 flex-1 items-center justify-center text-sm text-[color:var(--color-muted-foreground)]">{t('common.loading')}</div>}>
                  <MarkdownDocumentRichEditorLazy
                    key={richEditorSession?.key ?? `${active.path}:${active.mtimeMs}`}
                    initialMarkdown={richEditorSession?.initialMarkdown ?? value}
                    documentPath={active.path}
                    onEditorChange={(editor) => {
                      richEditorRef.current = editor
                      if (!editor) setFormatMenu(null)
                    }}
                    onMarkdownChange={(markdown) => setValue(markdown)}
                    onContextMenu={handleRichContextMenu}
                    onDocumentProfileChange={() => undefined}
                    onFlushReady={(flush) => {
                      flushRichEditorRef.current = flush
                    }}
                  />
                </Suspense>
              ) : null}
              {mode === 'source' ? <MarkdownDocumentSourceEditor editorRef={editorRef} value={value} onChange={(nextValue) => setValue(nextValue)} onScroll={handleEditorScroll} className="markdown-document-editor" /> : null}
              {mode === 'preview' ? <MarkdownDocumentReadOnlyPreview content={value} activePath={active?.path ?? null} previewRootRef={previewRef} onOpenPath={(path) => requestOpen(path)} /> : null}
              {mode === 'split' ? (
                <>
                  <MarkdownDocumentSourceEditor editorRef={editorRef} value={value} onChange={(nextValue) => setValue(nextValue)} onScroll={handleEditorScroll} className="markdown-document-editor is-split" />
                  <MarkdownDocumentReadOnlyPreview content={value} activePath={active?.path ?? null} previewRootRef={previewRef} onOpenPath={(path) => requestOpen(path)} className="is-split" />
                </>
              ) : null}
            </div>
          ) : null}
        </main>
      </div>
      {formatMenu ? <MarkdownFormatCascader x={formatMenu.x} y={formatMenu.y} editor={formatMenu.editor} selectionContext={formatMenu.selectionContext} onClose={() => setFormatMenu(null)} /> : null}
      <SidebarGestureHost
        pageRootRef={pageRootRef}
        onBeforeToggle={() => setFormatMenu(null)}
        onToggleLeftSidebar={() => {
          setDrawerOpen(false)
          setSidebarCollapsed((collapsed) => !collapsed)
        }}
      />
      <ConfirmDialog
        open={Boolean(pendingAction)}
        onClose={() => setPendingAction(null)}
        onConfirm={() => {
          const action = pendingAction
          setPendingAction(null)
          action?.()
        }}
        ariaLabel={t('markdownDocument.unsavedConfirmTitle')}
        title={t('markdownDocument.unsavedConfirmTitle')}
        description={t('markdownDocument.unsavedConfirm')}
        confirmLabel={t('markdownDocument.discard')}
      />
      <ConfirmDialog
        open={Boolean(pendingRemovePath)}
        onClose={() => setPendingRemovePath(null)}
        onConfirm={() => {
          const path = pendingRemovePath
          setPendingRemovePath(null)
          if (path) void removeHistory(path)
        }}
        ariaLabel={t('markdownDocument.removeHistoryConfirmTitle')}
        title={t('markdownDocument.removeHistoryConfirmTitle')}
        description={t('markdownDocument.removeHistoryConfirm')}
        confirmLabel={t('markdownDocument.removeHistory')}
        confirmVariant="destructive"
      />
      <ConfirmDialog
        open={clearConfirmOpen}
        onClose={() => setClearConfirmOpen(false)}
        onConfirm={() => {
          setClearConfirmOpen(false)
          void clearHistory()
        }}
        ariaLabel={t('markdownDocument.recent')}
        title={t('markdownDocument.recent')}
        description={t('markdownDocument.clearHistoryConfirm')}
        confirmLabel={t('markdownDocument.clearHistory')}
      />
    </div>
  )
}
