import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { FileText, FolderOpen, Menu, Save, Search, Trash2 } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Input } from '../../components/ui/input'
import { useI18n } from '../../i18n'
import { useEffectiveTheme } from '../../hooks/useEffectiveTheme'
import { useAppStore } from '../../stores/appStore'
import { MarkdownPreviewSurface } from '../code/MarkdownPreviewSurface'
import { createMarkdownComponents } from '../code/code.markdown'
import { continueMarkdownList, indentMarkdownLines, outdentMarkdownLines } from '../learning/notes/learningMarkdownEditor'
import { resolveMarkdownDocumentLink } from './markdownDocumentLinks'
import { useMarkdownDocumentScrollSync } from './useMarkdownDocumentScrollSync'

export function MarkdownDocumentPage() {
  const { t, formatDateTime } = useI18n()
  const effectiveTheme = useEffectiveTheme()
  const history = useAppStore((state) => state.markdownDocumentHistory)
  const active = useAppStore((state) => state.markdownDocumentActive)
  const value = useAppStore((state) => state.markdownDocumentValue)
  const mode = useAppStore((state) => state.markdownDocumentMode)
  const loading = useAppStore((state) => state.markdownDocumentLoading)
  const saving = useAppStore((state) => state.markdownDocumentSaving)
  const error = useAppStore((state) => state.markdownDocumentError)
  const conflict = useAppStore((state) => state.markdownDocumentConflict)
  const isDirty = Boolean(active && value !== active.content)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const [query, setQuery] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)
  const [pendingRemovePath, setPendingRemovePath] = useState<string | null>(null)
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  const { previewRef, handleEditorScroll } = useMarkdownDocumentScrollSync(mode, editorRef, active?.path ?? null)
  const loadHistory = useAppStore((state) => state.loadMarkdownDocumentHistory)
  const openDocument = useAppStore((state) => state.openMarkdownDocument)
  const setValue = useAppStore((state) => state.setMarkdownDocumentValue)
  const setMode = useAppStore((state) => state.setMarkdownDocumentMode)
  const save = useAppStore((state) => state.saveMarkdownDocument)
  const reload = useAppStore((state) => state.reloadMarkdownDocument)
  const removeHistory = useAppStore((state) => state.removeMarkdownDocumentHistory)
  const clearHistory = useAppStore((state) => state.clearMarkdownDocumentHistory)

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirty) return
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

  const requestOpen = useCallback((filePath: string) => runWithDirtyConfirmation(() => void openDocument(filePath)), [openDocument, runWithDirtyConfirmation])

  useEffect(() => {
    void window.electronAPI.consumePendingMarkdownDocumentOpen().then((request) => {
      if (request) requestOpen(request.path)
    })
    return window.electronAPI.onMarkdownDocumentOpenRequested((request) => requestOpen(request.path))
  }, [requestOpen])

  useEffect(() => {
    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return
      event.preventDefault()
      if (active && isDirty && !saving) void save()
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [active, isDirty, saving, save])

  const handleOpen = async () => {
    const selected = await window.electronAPI.selectMarkdownDocument()
    if (selected) requestOpen(selected)
  }

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const editor = event.currentTarget
    const start = editor.selectionStart
    const end = editor.selectionEnd
    if (event.key === 'Tab') {
      event.preventDefault()
      const result = event.shiftKey ? outdentMarkdownLines(value, start, end) : indentMarkdownLines(value, start, end)
      setValue(result.value)
      requestAnimationFrame(() => editor.setSelectionRange(result.selectionStart, result.selectionEnd))
      return
    }
    if (event.key === 'Enter') {
      const result = continueMarkdownList(value, start, end)
      if (result) {
        event.preventDefault()
        setValue(result.value)
        requestAnimationFrame(() => editor.setSelectionRange(result.selectionStart, result.selectionEnd))
      }
      return
    }
  }

  const filteredHistory = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return normalized ? history.filter((item) => `${item.displayName} ${item.path}`.toLowerCase().includes(normalized)) : history
  }, [history, query])

  const components = useMemo(
    () =>
      createMarkdownComponents({
        projectPath: active?.path ?? '',
        activeRelativePath: '',
        themeMode: effectiveTheme,
        enableMarkdownSyntaxHighlight: true,
        onProjectFileLinkClick: (relativePath) => {
          const resolved = active ? resolveMarkdownDocumentLink(relativePath, active.path) : null
          if (resolved) requestOpen(resolved)
        },
      }),
    [active, effectiveTheme, requestOpen],
  )

  return (
    <div className="markdown-document-workspace">
      <header className="app-chrome markdown-document-header">
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
          {(['edit', 'split', 'preview'] as const).map((item) => (
            <button key={item} type="button" className={`markdown-document-mode ${mode === item ? 'is-active' : ''}`} onClick={() => setMode(item)}>
              {t(`markdownDocument.${item}`)}
            </button>
          ))}
        </div>
        <Button size="sm" disabled={!active || !isDirty || saving} onClick={() => void save()}>
          <Save className="mr-1.5 h-4 w-4" />
          {saving ? t('common.saving') : t('common.save')}
        </Button>
      </header>
      <div className="markdown-document-body">
        <aside className={`markdown-document-sidebar surface-card ${drawerOpen ? 'is-open' : ''}`}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{t('markdownDocument.recent')}</span>
            <button type="button" className="text-xs text-[color:var(--color-muted-foreground)]" onClick={() => setClearConfirmOpen(true)}>
              {t('markdownDocument.clearHistory')}
            </button>
          </div>
          <div className="relative mt-3">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--color-muted-foreground)]" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('markdownDocument.search')} className="pl-9" />
          </div>
          <div className="mt-3 min-h-0 flex-1 overflow-auto">
            {filteredHistory.map((item) => (
              <div key={item.normalizedPath} className={`group mb-1 flex items-start gap-2 rounded-xl p-2 ${active?.path === item.path ? 'bg-[color:var(--color-accent)]' : ''}`}>
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => requestOpen(item.path)}>
                  <div className="truncate text-sm">{item.displayName}</div>
                  <div className="truncate text-xs text-[color:var(--color-muted-foreground)]" title={item.path}>
                    {item.path}
                  </div>
                  <div className={`text-[10px] text-[color:var(--color-muted-foreground)] ${item.missing ? 'text-[color:var(--color-destructive)]' : ''}`}>{item.missing ? t('markdownDocument.missing') : formatDateTime(item.lastOpenedAt)}</div>
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
        </aside>
        <main className="markdown-document-main surface-card">
          {active && (
            <div className="markdown-document-meta">
              <span className="truncate">{active.path}</span>
              <span className={isDirty ? 'text-[color:var(--color-primary)]' : ''}>{isDirty ? t('markdownDocument.unsaved') : t('markdownDocument.saved')}</span>
            </div>
          )}
          {error && (
            <div className="markdown-document-error">
              {conflict ? t('markdownDocument.conflict') : error}
              {conflict && (
                <Button size="sm" variant="outline" className="ml-3" onClick={() => runWithDirtyConfirmation(() => void reload())}>
                  {t('markdownDocument.reload')}
                </Button>
              )}
            </div>
          )}
          {!active && !loading && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <FileText className="h-10 w-10 text-[color:var(--color-muted-foreground)]" />
              <p className="text-sm text-[color:var(--color-muted-foreground)]">{t('markdownDocument.empty')}</p>
              <Button onClick={() => void handleOpen()}>{t('markdownDocument.open')}</Button>
            </div>
          )}
          {loading && <div className="flex h-full items-center justify-center text-sm text-[color:var(--color-muted-foreground)]">{t('common.loading')}</div>}
          {active && !loading && (
            <div className="markdown-document-content">
              {(mode === 'edit' || mode === 'split') && (
                <textarea ref={editorRef} value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={handleEditorKeyDown} onScroll={handleEditorScroll} className={`markdown-document-editor ${mode === 'split' ? 'is-split' : ''}`} spellCheck={false} aria-label={t('markdownDocument.edit')} />
              )}
              {(mode === 'preview' || mode === 'split') && (
                <div ref={previewRef} className={`markdown-document-preview code-markdown-preview-scroll-root ${mode === 'split' ? 'is-split' : ''}`}>
                  <article className="code-markdown-content code-markdown-content--viewport-scroll markdown-document-preview-content">
                    <MarkdownPreviewSurface content={value} components={components} previewRootRef={previewRef} />
                  </article>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
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
