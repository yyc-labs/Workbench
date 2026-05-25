import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { editor as MonacoEditor } from 'monaco-editor'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import { X } from 'lucide-react'
import { inferLanguageFromRelativePath } from '../code/code.helpers'
import type { DetailGitSnapshot, GitDiffViewMode } from './detail.types'

type GitChangedFile = DetailGitSnapshot['changedFiles'][number]

type DetailGitDiffDrawerProps = {
  open: boolean
  changedFiles: GitChangedFile[]
  activeFilePath: string | null
  activeFile: GitChangedFile | null
  diffViewMode: GitDiffViewMode
  diffLoading: boolean
  diffContent: string
  diffError: string | null
  canViewUnstaged: boolean
  canViewStaged: boolean
  onClose: () => void
  onSelectFile: (filePath: string) => void
  onChangeDiffViewMode: (mode: GitDiffViewMode) => void
}

const CHANGE_META: Record<GitChangedFile['kind'], { label: string; className: string }> = {
  added: { label: '新增', className: 'text-[color:var(--color-success)] bg-[color:var(--color-success-background)]' },
  modified: { label: '修改', className: 'text-[color:var(--color-primary)] bg-[color:var(--color-primary)]/10' },
  deleted: { label: '删除', className: 'text-[color:var(--color-destructive)] bg-[color:var(--color-destructive-background)]' },
  renamed: { label: '重命名', className: 'text-[color:var(--color-warning)] bg-[color:var(--color-warning-background)]' },
  copied: { label: '复制', className: 'text-[color:var(--color-primary)] bg-[color:var(--color-primary)]/10' },
  untracked: { label: '未跟踪', className: 'text-[color:var(--color-muted-foreground)] bg-[color:var(--color-background-sunken)]' },
  conflicted: { label: '冲突', className: 'text-[color:var(--color-destructive)] bg-[color:var(--color-destructive-background)]' },
  typechanged: { label: '类型变更', className: 'text-[color:var(--color-warning)] bg-[color:var(--color-warning-background)]' },
  unknown: { label: '变更', className: 'text-[color:var(--color-muted-foreground)] bg-[color:var(--color-background-sunken)]' },
}

const DRAWER_TRANSITION_MS = 240
const DRAWER_CONTENT_REVEAL_MS = 90
const DIFF_MONACO_LANGUAGE_ID = 'git-patch-diff'

interface MonacoEnvironmentShape {
  getWorker: (_workerId: string, label: string) => Worker
}

declare global {
  interface Window {
    MonacoEnvironment?: MonacoEnvironmentShape
  }
}

let monacoEnvironmentReady = false
let diffLanguageReady = false

function ensureMonacoEnvironmentConfigured(): void {
  if (monacoEnvironmentReady) return
  if (typeof window === 'undefined') return

  window.MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      if (label === 'json') return new JsonWorker()
      if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker()
      if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker()
      if (label === 'typescript' || label === 'javascript') return new TsWorker()
      return new EditorWorker()
    },
  }
  monacoEnvironmentReady = true
}

function ensureDiffLanguage(monaco: typeof import('monaco-editor')): void {
  if (diffLanguageReady) return
  const exists = monaco.languages.getLanguages().some((lang) => lang.id === DIFF_MONACO_LANGUAGE_ID)
  if (!exists) {
    monaco.languages.register({ id: DIFF_MONACO_LANGUAGE_ID })
    monaco.languages.setMonarchTokensProvider(DIFF_MONACO_LANGUAGE_ID, {
      tokenizer: {
        root: [
          [/^diff --git .*$/, 'keyword'],
          [/^index .*$/, 'comment'],
          [/^@@ .* @@.*$/, 'regexp'],
          [/^\+\+\+ .*$/, 'meta'],
          [/^--- .*$/, 'meta'],
          [/^\+.*$/, 'string'],
          [/^-.*$/, 'keyword'],
          [/^\\ No newline at end of file$/, 'comment'],
        ],
      },
    })
  }
  diffLanguageReady = true
}

function getScopeLabel(file: GitChangedFile): string {
  if (file.scope === 'conflicted') return '冲突'
  if (file.scope === 'untracked') return '未跟踪'
  if (file.staged && file.unstaged) return '已暂存 + 未暂存'
  if (file.staged) return '已暂存'
  return '未暂存'
}

function resolveMonacoTheme(): 'vs' | 'vs-dark' {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'vs-dark' : 'vs'
}

function DiffMonacoViewer({
  value,
  filePath,
}: {
  value: string
  filePath: string
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null)
  const [theme, setTheme] = useState<'vs' | 'vs-dark'>(() => resolveMonacoTheme())
  const [editorRuntime] = useState(() => ({
    editor: null as MonacoEditor.IStandaloneCodeEditor | null,
    model: null as MonacoEditor.ITextModel | null,
    monaco: null as typeof import('monaco-editor') | null,
    syncGuard: false,
  }))

  useEffect(() => {
    const root = document.documentElement
    const syncTheme = () => setTheme(resolveMonacoTheme())
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes' && record.attributeName === 'data-theme') {
          syncTheme()
          break
        }
      }
    })
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let disposed = false

    const setup = async () => {
      ensureMonacoEnvironmentConfigured()
      const monaco = await import('monaco-editor')
      if (disposed) return
      ensureDiffLanguage(monaco)

      const model = monaco.editor.createModel(
        value,
        DIFF_MONACO_LANGUAGE_ID,
        monaco.Uri.parse(`inmemory://git-diff/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.diff`)
      )
      const editor = monaco.editor.create(container, {
        model,
        automaticLayout: true,
        minimap: { enabled: false },
        fontFamily: "'JetBrains Mono', 'SFMono-Regular', Menlo, Monaco, Consolas, monospace",
        fontSize: 12.5,
        lineHeight: 20,
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        renderWhitespace: 'selection',
        padding: { top: 10, bottom: 10 },
        theme,
        readOnly: true,
        stickyScroll: { enabled: false },
      })

      editorRuntime.monaco = monaco
      editorRuntime.model = model
      editorRuntime.editor = editor
    }

    void setup()

    return () => {
      disposed = true
      editorRuntime.editor?.dispose()
      editorRuntime.model?.dispose()
      editorRuntime.editor = null
      editorRuntime.model = null
      editorRuntime.monaco = null
    }
  }, [containerEl]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!editorRuntime.monaco) return
    editorRuntime.monaco.editor.setTheme(theme)
  }, [theme, editorRuntime])

  useEffect(() => {
    const model = editorRuntime.model
    if (!model) return
    if (model.getValue() === value) return
    editorRuntime.syncGuard = true
    model.pushEditOperations([], [{ range: model.getFullModelRange(), text: value }], () => null)
    editorRuntime.syncGuard = false
  }, [value, editorRuntime])

  return (
    <div className="h-full w-full">
      <div
        ref={(node) => {
          containerRef.current = node
          if (containerEl === node) return
          setContainerEl(node)
        }}
        className="h-full w-full"
        data-file-path={filePath}
      />
    </div>
  )
}

function DetailGitDiffDrawer({
  open,
  changedFiles,
  activeFilePath,
  activeFile,
  diffViewMode,
  diffLoading,
  diffContent,
  diffError,
  canViewUnstaged,
  canViewStaged,
  onClose,
  onSelectFile,
  onChangeDiffViewMode,
}: DetailGitDiffDrawerProps) {
  const [shouldRender, setShouldRender] = useState(open)
  const [visible, setVisible] = useState(open)
  const [contentVisible, setContentVisible] = useState(open)
  const languageHint = useMemo(
    () => inferLanguageFromRelativePath(activeFile?.path ?? ''),
    [activeFile?.path]
  )
  const shouldShowDiffViewer = open && visible && contentVisible

  useEffect(() => {
    if (open) {
      setShouldRender(true)
      setContentVisible(false)
      const enterTimer = window.setTimeout(() => setVisible(true), 16)
      const revealTimer = window.setTimeout(() => setContentVisible(true), DRAWER_CONTENT_REVEAL_MS)
      return () => {
        window.clearTimeout(enterTimer)
        window.clearTimeout(revealTimer)
      }
    }
    setContentVisible(false)
    setVisible(false)
    const timer = window.setTimeout(() => setShouldRender(false), DRAWER_TRANSITION_MS)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!shouldRender) return
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onEscape)
    return () => document.removeEventListener('keydown', onEscape)
  }, [shouldRender, onClose])

  if (!shouldRender) return null

  return createPortal(
    <div className="fixed inset-0 z-[1200] overflow-hidden">
      <button
        type="button"
        className={`absolute inset-0 bg-[color:var(--color-background-sunken)]/72 backdrop-blur-[7px] transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
        aria-label="关闭改动详情"
      />
      <aside
        className={`absolute inset-y-3 right-3 w-[min(1480px,calc(100%-1.5rem))] overflow-hidden rounded-[26px] border border-[color:var(--color-border)] bg-[color:var(--color-popover)]/96 shadow-[0_28px_84px_rgba(15,15,20,0.34)] backdrop-blur-[26px] transition-[transform,opacity] duration-240 ease-out will-change-transform ${visible ? 'translate-x-0 opacity-100' : 'translate-x-[36px] opacity-0'}`}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="文件改动详情"
      >
        <div className={`flex h-full min-h-0 flex-col transition-opacity duration-120 ${contentVisible ? 'opacity-100' : 'opacity-0'}`}>
          <div className="flex shrink-0 items-center justify-between border-b border-[color:var(--color-border)]/85 bg-[color:var(--color-card)]/62 px-5 py-4 backdrop-blur-[14px]">
            <div className="min-w-0">
              <p className="section-label">Changed Files</p>
              <p className="truncate text-[11px] text-[color:var(--color-muted-foreground)]">
                左侧选文件，右侧查看改动内容（Monaco 只读高亮）
              </p>
            </div>
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-background)]/80 text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
              onClick={onClose}
              title="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)] max-[980px]:grid-cols-1 max-[980px]:grid-rows-[minmax(220px,35%)_minmax(0,1fr)]">
            <div className="min-h-0 overflow-auto border-r border-[color:var(--color-border)]/85 bg-[color:var(--color-background-sunken)]/46 p-3 max-[980px]:border-r-0 max-[980px]:border-b">
              <div className="space-y-2">
                {changedFiles.map((file) => {
                  const itemActive = activeFilePath === file.path
                  const meta = CHANGE_META[file.kind]
                  return (
                    <button
                      key={`drawer-${file.path}-${file.indexStatus}-${file.worktreeStatus}`}
                      type="button"
                      className={`w-full rounded-[14px] border px-2.5 py-2.5 text-left backdrop-blur-[8px] transition-colors ${
                        itemActive
                          ? 'border-[color:var(--color-primary)]/40 bg-[color:var(--color-primary)]/10 shadow-[0_8px_18px_rgba(10,132,255,0.12)]'
                          : 'border-[color:var(--color-border)]/90 bg-[color:var(--color-card)]/86 hover:border-[color:var(--color-border-hover)] hover:bg-[color:var(--color-background)]/90'
                      }`}
                      onClick={() => onSelectFile(file.path)}
                    >
                      <div className="flex items-start gap-2">
                        <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${meta.className}`}>
                          {meta.label}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-mono text-[11.5px] text-[color:var(--color-foreground)]">{file.path}</p>
                          {file.originalPath && (
                            <p className="mt-0.5 truncate font-mono text-[10px] text-[color:var(--color-muted-foreground)]">
                              from {file.originalPath}
                            </p>
                          )}
                          <p className="mt-1 text-[10px] text-[color:var(--color-muted-foreground)]">
                            {getScopeLabel(file)} · {file.indexStatus}{file.worktreeStatus}
                          </p>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="min-h-0 p-3 sm:p-4">
              {activeFile ? (
                <div className="flex h-full min-h-0 flex-col rounded-[18px] border border-[color:var(--color-border)]/90 bg-[color:var(--color-background)]/72 shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[color:var(--color-border)]/85 bg-[color:var(--color-card)]/54 px-3.5 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-[12px] text-[color:var(--color-foreground)]">{activeFile.path}</p>
                      <p className="text-[10.5px] text-[color:var(--color-muted-foreground)]">
                        {diffViewMode === 'staged' ? '暂存区变更' : '工作区变更'} · {languageHint}
                      </p>
                    </div>
                    <div className="quiet-control flex items-center gap-1 rounded-full border border-[color:var(--color-border)]/75 p-1">
                      <button
                        type="button"
                        className={`rounded-full px-2.5 py-1 text-[10.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                          diffViewMode === 'unstaged'
                            ? 'bg-primary text-white shadow-[0_6px_14px_rgba(10,132,255,0.3)]'
                            : 'text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]'
                        }`}
                        disabled={!canViewUnstaged || diffLoading}
                        onClick={() => onChangeDiffViewMode('unstaged')}
                      >
                        未暂存
                      </button>
                      <button
                        type="button"
                        className={`rounded-full px-2.5 py-1 text-[10.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                          diffViewMode === 'staged'
                            ? 'bg-primary text-white shadow-[0_6px_14px_rgba(10,132,255,0.3)]'
                            : 'text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]'
                        }`}
                        disabled={!canViewStaged || diffLoading}
                        onClick={() => onChangeDiffViewMode('staged')}
                      >
                        已暂存
                      </button>
                    </div>
                  </div>

                  <div className="min-h-0 flex-1">
                    {diffLoading ? (
                      <div className="flex h-full items-center justify-center text-[11px] text-[color:var(--color-muted-foreground)]">
                        正在加载 diff...
                      </div>
                    ) : diffError ? (
                      <div className="flex h-full items-center justify-center px-4 text-[11px] text-[color:var(--color-destructive)]">
                        {diffError}
                      </div>
                    ) : shouldShowDiffViewer ? (
                      <DiffMonacoViewer value={diffContent || ''} filePath={activeFile.path} />
                    ) : (
                      <div className="h-full w-full" aria-hidden="true" />
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex h-full items-center justify-center rounded-[18px] border border-dashed border-[color:var(--color-border)] bg-[color:var(--color-background)]/55 text-xs text-[color:var(--color-muted-foreground)]">
                  请选择文件查看改动
                </div>
              )}
            </div>
          </div>
        </div>
      </aside>
    </div>,
    document.body
  )
}

export { DetailGitDiffDrawer }
