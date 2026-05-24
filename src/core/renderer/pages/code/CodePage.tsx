import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft, Code2, RefreshCw, Save } from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import { middleTruncatePath, projectDisplayName } from '../../lib/projectDisplay'
import { CodeFileTree } from './CodeFileTree'
import { MonacoCodeEditor } from './MonacoCodeEditor'
import {
  collectParentDirectories,
  createDefaultExpandedDirectorySet,
  formatFileSize,
  inferLanguageFromRelativePath,
  sortTreeNodes,
} from './code.helpers'
import type { FileTreeState, SaveStatus } from './code.types'
import type { ProjectFileReadResult } from '../../../shared/types'

const SAVE_STATUS_RESET_DELAY_MS = 1600

function resolveMonacoTheme(themeMode: 'system' | 'light' | 'dark'): 'vs' | 'vs-dark' {
  if (themeMode === 'dark') return 'vs-dark'
  if (themeMode === 'light') return 'vs'
  return 'vs'
}

export function CodePage() {
  const navigate = useNavigate()
  const { projectId } = useParams<{ projectId: string }>()
  const project = useAppStore((s) => s.projects.find((item) => item.id === projectId))
  const themeMode = useAppStore((s) => s.config.theme)

  const [tree, setTree] = useState<FileTreeState>({
    status: 'idle',
    nodes: [],
    error: null,
    skippedDirectories: 0,
    skippedFiles: 0,
  })
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(new Set())
  const [activeFile, setActiveFile] = useState<ProjectFileReadResult | null>(null)
  const [editorValue, setEditorValue] = useState('')
  const [lastSavedValue, setLastSavedValue] = useState('')
  const [activeRelativePath, setActiveRelativePath] = useState<string | null>(null)
  const [isReading, setIsReading] = useState(false)
  const [readError, setReadError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [effectiveTheme, setEffectiveTheme] = useState<'light' | 'dark'>(
    () => (document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light')
  )

  const monacoTheme = useMemo(
    () => (effectiveTheme === 'dark' ? 'vs-dark' : resolveMonacoTheme(themeMode)),
    [effectiveTheme, themeMode]
  )
  const isDirty = editorValue !== lastSavedValue
  const activeLanguage = activeFile?.language ?? inferLanguageFromRelativePath(activeRelativePath ?? '')
  const activeFileSize = activeFile?.size ?? 0

  const loadTree = useCallback(async () => {
    if (!project) return
    setTree((prev) => ({ ...prev, status: 'loading', error: null }))

    try {
      const result = await window.electronAPI.listProjectFiles(project.path)
      const sortedNodes = sortTreeNodes(result.nodes)
      setTree({
        status: 'ready',
        nodes: sortedNodes,
        error: null,
        skippedDirectories: result.skipped.directories,
        skippedFiles: result.skipped.files,
      })
      setExpandedDirectories(createDefaultExpandedDirectorySet(sortedNodes))
    } catch (error) {
      setTree({
        status: 'error',
        nodes: [],
        error: error instanceof Error ? error.message : String(error),
        skippedDirectories: 0,
        skippedFiles: 0,
      })
    }
  }, [project])

  useEffect(() => {
    if (!project) return
    void loadTree()
  }, [project, loadTree])

  useEffect(() => {
    const root = document.documentElement
    const sync = () => {
      const attr = root.getAttribute('data-theme')
      setEffectiveTheme(attr === 'dark' ? 'dark' : 'light')
    }

    sync()
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes' && record.attributeName === 'data-theme') {
          sync()
          break
        }
      }
    })
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  const openFile = useCallback(async (relativePath: string) => {
    if (!project) return
    if (activeRelativePath === relativePath) return
    if (isDirty && activeRelativePath && activeRelativePath !== relativePath) {
      const proceed = window.confirm('Current file has unsaved changes. Discard and continue?')
      if (!proceed) return
    }

    setIsReading(true)
    setReadError(null)
    setSaveError(null)
    setSaveStatus('idle')

    try {
      const result = await window.electronAPI.readProjectFile(project.path, relativePath)
      setActiveFile(result)
      setActiveRelativePath(result.relativePath)
      setEditorValue(result.content)
      setLastSavedValue(result.content)
      setExpandedDirectories((prev) => {
        const next = new Set(prev)
        for (const parent of collectParentDirectories(result.relativePath)) {
          next.add(parent)
        }
        return next
      })
    } catch (error) {
      setReadError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsReading(false)
    }
  }, [activeRelativePath, isDirty, project])

  const handleSave = useCallback(async () => {
    if (!project || !activeRelativePath || !activeFile) return
    if (!isDirty) return

    setSaveStatus('saving')
    setSaveError(null)

    try {
      const result = await window.electronAPI.writeProjectFile(
        project.path,
        activeRelativePath,
        editorValue,
        activeFile.mtimeMs
      )
      setActiveFile((prev) => (
        prev
          ? {
            ...prev,
            content: editorValue,
            size: result.size,
            mtimeMs: result.mtimeMs,
          }
          : prev
      ))
      setLastSavedValue(editorValue)
      setSaveStatus('saved')
      window.setTimeout(() => {
        setSaveStatus((current) => (current === 'saved' ? 'idle' : current))
      }, SAVE_STATUS_RESET_DELAY_MS)
    } catch (error) {
      setSaveStatus('error')
      setSaveError(error instanceof Error ? error.message : String(error))
    }
  }, [activeFile, activeRelativePath, editorValue, isDirty, project])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      if (event.key.toLowerCase() !== 's') return
      event.preventDefault()
      void handleSave()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleSave])

  if (!project || !projectId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <h2 className="text-lg font-semibold text-[color:var(--color-foreground)]">Project not found</h2>
        <button
          className="inline-flex items-center gap-1.5 text-sm text-primary transition-colors hover:text-primary"
          onClick={() => navigate('/')}
        >
          <ChevronLeft className="h-4 w-4" strokeWidth={1.8} />
          Back to Home
        </button>
      </div>
    )
  }

  const saveText = saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved' : 'Save'

  return (
    <div className="code-page-shell">
      <header className="app-chrome flex min-h-[84px] shrink-0 items-center justify-between px-8 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            className="rounded-full p-2 text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
            onClick={() => navigate(`/project/${projectId}`)}
            title="Back to Detail"
          >
            <ChevronLeft className="h-5 w-5" strokeWidth={1.8} />
          </button>

          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-[-0.02em] text-[color:var(--color-foreground)]">
              {projectDisplayName(project)}
            </h1>
            <p className="mt-0.5 truncate text-xs text-[color:var(--color-muted-foreground)]" title={project.path}>
              {middleTruncatePath(project.path)}
            </p>
            <p className="mt-0.5 truncate text-[11px] text-[color:var(--color-muted-foreground)]/90">
              {activeRelativePath ?? 'Select a file from the tree'}
            </p>
          </div>

          {isDirty && (
            <span className="rounded-full bg-[color:var(--color-warning-background)] px-2.5 py-0.5 text-[11px] font-medium text-[color:var(--color-warning)]">
              Unsaved
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--color-border)] px-3 py-1.5 text-xs text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]"
            onClick={() => void loadTree()}
            title="Reload file tree"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${tree.status === 'loading' ? 'animate-spin' : ''}`} />
            Refresh
          </button>

          <button
            type="button"
            className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-all ${saveStatus === 'saving'
              ? 'border text-[color:var(--color-warning)] bg-[color:var(--color-warning-background)]'
              : 'bg-primary text-white shadow-sm hover:bg-primary-hover disabled:opacity-50'
              }`}
            onClick={() => void handleSave()}
            disabled={!activeRelativePath || !isDirty || saveStatus === 'saving'}
          >
            <Save className="h-3.5 w-3.5" />
            {saveText}
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 px-6 pb-4 pt-4">
        <div className="code-layout-grid h-full">
          <aside className="code-tree-panel surface-card">
            <div className="code-panel-header">
              <Code2 className="h-4 w-4 text-[color:var(--color-muted-foreground)]" />
              <span>Files</span>
            </div>

            {tree.status === 'loading' ? (
              <div className="code-panel-empty text-xs text-[color:var(--color-muted-foreground)]">Loading files...</div>
            ) : tree.status === 'error' ? (
              <div className="code-panel-empty text-xs text-[color:var(--color-destructive)]">{tree.error ?? 'Failed to load file tree.'}</div>
            ) : (
              <CodeFileTree
                nodes={tree.nodes}
                activeRelativePath={activeRelativePath}
                expandedDirectories={expandedDirectories}
                onToggleDirectory={(relativePath) => {
                  setExpandedDirectories((prev) => {
                    const next = new Set(prev)
                    if (next.has(relativePath)) next.delete(relativePath)
                    else next.add(relativePath)
                    return next
                  })
                }}
                onSelectFile={(relativePath) => {
                  void openFile(relativePath)
                }}
              />
            )}
          </aside>

          <section className="code-editor-panel surface-card">
            {activeRelativePath ? (
              <MonacoCodeEditor
                filePath={activeRelativePath}
                value={editorValue}
                language={activeLanguage || 'plaintext'}
                theme={monacoTheme}
                onChange={setEditorValue}
                onSave={() => {
                  void handleSave()
                }}
              />
            ) : (
              <div className="code-panel-empty">
                <div className="text-sm text-[color:var(--color-muted-foreground)]">
                  Select a file from the left panel to start editing.
                </div>
              </div>
            )}
          </section>
        </div>
      </div>

      <footer className="code-statusbar">
        <div className="truncate text-[11px] text-[color:var(--color-muted-foreground)]">
          {activeRelativePath ? activeRelativePath : project.path}
        </div>
        <div className="flex shrink-0 items-center gap-4 text-[11px] text-[color:var(--color-muted-foreground)]">
          <span>{activeLanguage || 'plaintext'}</span>
          <span>{activeRelativePath ? formatFileSize(activeFileSize) : '0 B'}</span>
          <span>
            {saveStatus === 'saving'
              ? 'Saving'
              : saveStatus === 'saved'
                ? 'Saved'
                : isDirty
                  ? 'Unsaved'
                  : 'Idle'}
          </span>
        </div>
      </footer>

      {(readError || saveError || isReading || tree.skippedDirectories > 0 || tree.skippedFiles > 0) && (
        <div className="px-6 pb-3">
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-[color:var(--color-muted-foreground)]">
            {isReading && <span>Reading file...</span>}
            {readError && <span className="text-[color:var(--color-destructive)]">{readError}</span>}
            {saveError && <span className="text-[color:var(--color-destructive)]">{saveError}</span>}
            {(tree.skippedDirectories > 0 || tree.skippedFiles > 0) && (
              <span>
                Skipped {tree.skippedDirectories} directories, {tree.skippedFiles} files.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
