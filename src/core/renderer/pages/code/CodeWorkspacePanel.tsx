import { useCallback, useEffect, useMemo, useState } from 'react'
import { Code2, RefreshCw, Save } from 'lucide-react'
import type { ProjectFileReadResult } from '../../../shared/types'
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

const SAVE_STATUS_RESET_DELAY_MS = 1600
const FILE_EXTERNAL_CHANGE_POLL_MS = 1200

function resolveMonacoTheme(themeMode: 'system' | 'light' | 'dark'): 'vs' | 'vs-dark' {
  if (themeMode === 'dark') return 'vs-dark'
  if (themeMode === 'light') return 'vs'
  return 'vs'
}

type CodeWorkspacePanelProps = {
  projectPath: string
  themeMode: 'system' | 'light' | 'dark'
}

export function CodeWorkspacePanel({ projectPath, themeMode }: CodeWorkspacePanelProps) {
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
  const [hasExternalChange, setHasExternalChange] = useState(false)
  const [isReloadingFromDisk, setIsReloadingFromDisk] = useState(false)
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
    setTree((prev) => ({ ...prev, status: 'loading', error: null }))

    try {
      const result = await window.electronAPI.listProjectFiles(projectPath)
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
  }, [projectPath])

  useEffect(() => {
    void loadTree()
  }, [loadTree])

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

  const openFile = useCallback(async (relativePath: string, forceReload = false) => {
    if (activeRelativePath === relativePath && !forceReload) return
    if (isDirty && activeRelativePath && activeRelativePath !== relativePath) {
      const proceed = window.confirm('Current file has unsaved changes. Discard and continue?')
      if (!proceed) return
    }

    setIsReading(true)
    setReadError(null)
    setSaveError(null)
    setSaveStatus('idle')

    try {
      const result = await window.electronAPI.readProjectFile(projectPath, relativePath)
      setActiveFile(result)
      setActiveRelativePath(result.relativePath)
      setEditorValue(result.content)
      setLastSavedValue(result.content)
      setHasExternalChange(false)
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
  }, [activeRelativePath, isDirty, projectPath])

  const handleSave = useCallback(async () => {
    if (!activeRelativePath || !activeFile) return
    if (!isDirty) return

    setSaveStatus('saving')
    setSaveError(null)

    try {
      const result = await window.electronAPI.writeProjectFile(
        projectPath,
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
      setHasExternalChange(false)
      window.setTimeout(() => {
        setSaveStatus((current) => (current === 'saved' ? 'idle' : current))
      }, SAVE_STATUS_RESET_DELAY_MS)
    } catch (error) {
      setSaveStatus('error')
      setSaveError(error instanceof Error ? error.message : String(error))
    }
  }, [activeFile, activeRelativePath, editorValue, isDirty, projectPath])

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

  useEffect(() => {
    if (!activeRelativePath || !activeFile) {
      setHasExternalChange(false)
      return
    }

    let cancelled = false
    let inFlight = false

    const checkOnce = async () => {
      if (cancelled || inFlight) return
      inFlight = true
      try {
        const stat = await window.electronAPI.statProjectFile(projectPath, activeRelativePath)
        if (cancelled) return
        if (Math.abs(stat.mtimeMs - activeFile.mtimeMs) <= 0.001) return

        if (isDirty) {
          setHasExternalChange(true)
          return
        }

        setIsReloadingFromDisk(true)
        await openFile(activeRelativePath, true)
      } catch {
        // ignore transient stat/read errors during polling
      } finally {
        inFlight = false
        if (!cancelled) {
          setIsReloadingFromDisk(false)
        }
      }
    }

    const timer = window.setInterval(() => {
      void checkOnce()
    }, FILE_EXTERNAL_CHANGE_POLL_MS)
    void checkOnce()

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [activeFile, activeRelativePath, isDirty, openFile, projectPath])

  const saveText = saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved' : 'Save'

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="mb-3 flex min-h-[52px] items-center justify-between gap-3 rounded-[16px] border px-4 py-2"
        style={{ borderColor: 'var(--color-border)', background: 'color-mix(in srgb, var(--color-card) 95%, transparent)' }}
      >
        <div className="min-w-0">
          <p className="truncate text-xs text-[color:var(--color-muted-foreground)]">
            {activeRelativePath ?? 'Select a file from the tree'}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {isDirty && (
            <span className="rounded-full bg-[color:var(--color-warning-background)] px-2.5 py-0.5 text-[11px] font-medium text-[color:var(--color-warning)]">
              Unsaved
            </span>
          )}
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
      </div>

      {activeRelativePath && hasExternalChange && (
        <div
          className="mb-3 flex items-center justify-between gap-3 rounded-[14px] border px-3 py-2 text-xs"
          style={{
            borderColor: 'color-mix(in srgb, var(--color-warning) 40%, transparent)',
            background: 'var(--color-warning-background)',
            color: 'var(--color-foreground)',
          }}
        >
          <span>
            File changed on disk. Reload to view latest content, or keep your unsaved edits.
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center rounded-full border border-[color:var(--color-border)] px-3 py-1 text-[11px] text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]"
              onClick={() => {
                setHasExternalChange(false)
              }}
            >
              Keep My Changes
            </button>
            <button
              type="button"
              className="inline-flex items-center rounded-full bg-primary px-3 py-1 text-[11px] font-medium text-white transition-colors hover:bg-primary-hover"
              onClick={() => {
                void openFile(activeRelativePath, true)
              }}
            >
              Reload from Disk
            </button>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1">
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

      <footer className="code-statusbar mt-3">
        <div className="truncate text-[11px] text-[color:var(--color-muted-foreground)]">
          {activeRelativePath ? activeRelativePath : projectPath}
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
        <div className="px-1 pb-1 pt-2">
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-[color:var(--color-muted-foreground)]">
            {isReading && <span>Reading file...</span>}
            {isReloadingFromDisk && <span>Reloading changed file from disk...</span>}
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
