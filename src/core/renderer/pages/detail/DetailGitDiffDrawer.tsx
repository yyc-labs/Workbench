import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { IDisposable, editor as MonacoEditor } from 'monaco-editor'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import { AlertTriangle, CheckCheck, ChevronLeft, ChevronRight, RefreshCw, Save, X } from 'lucide-react'
import { inferLanguageFromRelativePath } from '../code/code.helpers'
import type { DetailGitSnapshot, GitConflictFileResult, GitDiffViewMode } from './detail.types'

type GitChangedFile = DetailGitSnapshot['changedFiles'][number]
type GitConflictStage = GitConflictFileResult['stageContents'][number]

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
  conflictLoading: boolean
  conflictData: GitConflictFileResult | null
  conflictError: string | null
  conflictSaving: boolean
  onClose: () => void
  onSelectFile: (filePath: string) => void
  onChangeDiffViewMode: (mode: GitDiffViewMode) => void
  onLoadConflict: (filePath: string) => void
  onSaveConflict: (payload: { filePath: string; content: string; markResolved: boolean }) => void
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
const FIND_WIDGET_HOVER_GUARD_CLASS = 'monaco-find-widget-control-hover'
const FIND_WIDGET_CONTROL_SELECTOR = '.find-widget .button, .find-widget .monaco-custom-toggle, .findOptionsWidget .button, .findOptionsWidget .monaco-custom-toggle'

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

function getConflictStageTitle(stage: GitConflictStage): string {
  if (stage.stage === 1) return 'BASE（共同祖先）'
  if (stage.stage === 2) return 'OURS（当前分支）'
  return 'THEIRS（合并分支）'
}

type ConflictBlock = {
  id: string
  startLine: number
  endLine: number
  oursLabel: string
  theirsLabel: string
  ancestorLabel?: string
  oursContent: string
  theirsContent: string
  ancestorContent: string
}

type ParsedConflictDocument = {
  blocks: ConflictBlock[]
}

function splitLinesKeepingEol(text: string): string[] {
  if (!text) return []
  const matches = text.match(/[^\n]*\n|[^\n]+$/g)
  return matches ?? []
}

function joinLines(lines: string[]): string {
  if (lines.length <= 0) return ''
  return lines.join('')
}

function parseConflictMarkers(text: string): ParsedConflictDocument {
  const lines = splitLinesKeepingEol(text)
  const blocks: ConflictBlock[] = []
  let lineIndex = 0

  while (lineIndex < lines.length) {
    const line = lines[lineIndex]
    if (!line.startsWith('<<<<<<< ')) {
      lineIndex += 1
      continue
    }

    const startLine = lineIndex + 1
    const oursLabel = line.replace(/\r?\n$/, '').slice('<<<<<<< '.length).trim() || 'OURS'
    let scanIndex = lineIndex + 1
    let ancestorSplit = -1
    let midSplit = -1
    let endSplit = -1

    while (scanIndex < lines.length) {
      const scanLine = lines[scanIndex]
      if (scanLine.startsWith('||||||| ')) {
        ancestorSplit = scanIndex
        scanIndex += 1
        continue
      }
      if (scanLine.startsWith('=======')) {
        midSplit = scanIndex
        scanIndex += 1
        continue
      }
      if (scanLine.startsWith('>>>>>>> ')) {
        endSplit = scanIndex
        break
      }
      scanIndex += 1
    }

    if (midSplit < 0 || endSplit < 0) {
      lineIndex += 1
      continue
    }

    const ancestorLabel = ancestorSplit >= 0
      ? lines[ancestorSplit].replace(/\r?\n$/, '').slice('||||||| '.length).trim() || 'BASE'
      : undefined
    const theirsLabel = lines[endSplit].replace(/\r?\n$/, '').slice('>>>>>>> '.length).trim() || 'THEIRS'
    const oursStart = lineIndex + 1
    const oursEndExclusive = ancestorSplit >= 0 ? ancestorSplit : midSplit
    const ancestorStart = ancestorSplit >= 0 ? ancestorSplit + 1 : midSplit
    const ancestorEndExclusive = ancestorSplit >= 0 ? midSplit : midSplit
    const theirsStart = midSplit + 1
    const theirsEndExclusive = endSplit
    const oursContent = joinLines(lines.slice(oursStart, oursEndExclusive))
    const ancestorContent = joinLines(lines.slice(ancestorStart, ancestorEndExclusive))
    const theirsContent = joinLines(lines.slice(theirsStart, theirsEndExclusive))

    blocks.push({
      id: `conflict-${blocks.length + 1}-${startLine}`,
      startLine,
      endLine: endSplit + 1,
      oursLabel,
      theirsLabel,
      ancestorLabel,
      oursContent,
      theirsContent,
      ancestorContent,
    })

    lineIndex = endSplit + 1
  }

  return { blocks }
}

function lineStartOffset(text: string, lineNumber: number): number {
  if (lineNumber <= 1) return 0
  let currentLine = 1
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') {
      currentLine += 1
      if (currentLine === lineNumber) {
        return i + 1
      }
    }
  }
  return text.length
}

function replaceConflictBlock(
  source: string,
  block: ConflictBlock,
  replacement: string
): string {
  const start = lineStartOffset(source, block.startLine)
  const end = lineStartOffset(source, block.endLine + 1)
  return `${source.slice(0, start)}${replacement}${source.slice(end)}`
}

const MonacoTextViewer = memo(function MonacoTextViewer({
  value,
  filePath,
  language,
  readOnly,
  modelNamespace,
  onChange,
}: {
  value: string
  filePath: string
  language: string
  readOnly: boolean
  modelNamespace: string
  onChange?: (nextValue: string) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [theme, setTheme] = useState<'vs' | 'vs-dark'>(() => resolveMonacoTheme())
  const [editorRuntime] = useState(() => ({
    editor: null as MonacoEditor.IStandaloneCodeEditor | null,
    model: null as MonacoEditor.ITextModel | null,
    monaco: null as typeof import('monaco-editor') | null,
    syncGuard: false,
    subscription: null as IDisposable | null,
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

    const handleCaptureMouseOver = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      const findWidgetControl = target.closest(FIND_WIDGET_CONTROL_SELECTOR)
      if (!findWidgetControl) return
      // Prevent Monaco's delayed hover from stealing hover state on find-widget controls.
      document.body.classList.add(FIND_WIDGET_HOVER_GUARD_CLASS)
      event.stopPropagation()
    }
    const handleCaptureMouseOut = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      const fromControl = target.closest(FIND_WIDGET_CONTROL_SELECTOR)
      if (!fromControl) return
      const related = event.relatedTarget
      if (related instanceof Element && related.closest(FIND_WIDGET_CONTROL_SELECTOR)) return
      document.body.classList.remove(FIND_WIDGET_HOVER_GUARD_CLASS)
    }
    container.addEventListener('mouseover', handleCaptureMouseOver, true)
    container.addEventListener('mouseout', handleCaptureMouseOut, true)

    const setup = async () => {
      ensureMonacoEnvironmentConfigured()
      const monaco = await import('monaco-editor')
      if (disposed) return
      ensureDiffLanguage(monaco)

      const effectiveLanguage = language || 'plaintext'
      const model = monaco.editor.createModel(
        value,
        effectiveLanguage,
        monaco.Uri.parse(`inmemory://${modelNamespace}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${filePath.replace(/[^\w./-]/g, '_')}`)
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
        readOnly,
        stickyScroll: { enabled: false },
      })

      let subscription: IDisposable | null = null
      if (onChange) {
        subscription = editor.onDidChangeModelContent(() => {
          if (editorRuntime.syncGuard) return
          onChange(model.getValue())
        })
      }

      editorRuntime.monaco = monaco
      editorRuntime.model = model
      editorRuntime.editor = editor
      editorRuntime.subscription = subscription
    }

    void setup()

    return () => {
      disposed = true
      container.removeEventListener('mouseover', handleCaptureMouseOver, true)
      container.removeEventListener('mouseout', handleCaptureMouseOut, true)
      document.body.classList.remove(FIND_WIDGET_HOVER_GUARD_CLASS)
      editorRuntime.subscription?.dispose()
      editorRuntime.editor?.dispose()
      editorRuntime.model?.dispose()
      editorRuntime.editor = null
      editorRuntime.model = null
      editorRuntime.monaco = null
      editorRuntime.subscription = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!editorRuntime.monaco) return
    editorRuntime.monaco.editor.setTheme(theme)
  }, [theme, editorRuntime])

  useEffect(() => {
    if (!editorRuntime.editor) return
    editorRuntime.editor.updateOptions({ readOnly })
  }, [readOnly, editorRuntime])

  useEffect(() => {
    const model = editorRuntime.model
    const monaco = editorRuntime.monaco
    if (!model || !monaco) return
    const nextLanguage = language || 'plaintext'
    if (model.getLanguageId() !== nextLanguage) {
      monaco.editor.setModelLanguage(model, nextLanguage)
    }
  }, [language, editorRuntime])

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
        ref={containerRef}
        className="h-full w-full"
      />
    </div>
  )
})

const DetailGitDiffDrawer = memo(function DetailGitDiffDrawer({
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
  conflictLoading,
  conflictData,
  conflictError,
  conflictSaving,
  onClose,
  onSelectFile,
  onChangeDiffViewMode,
  onLoadConflict,
  onSaveConflict,
}: DetailGitDiffDrawerProps) {
  const [shouldRender, setShouldRender] = useState(open)
  const [visible, setVisible] = useState(open)
  const [contentVisible, setContentVisible] = useState(open)
  const [activeConflictBlockIndex, setActiveConflictBlockIndex] = useState(0)
  const [conflictDraft, setConflictDraft] = useState('')
  const conflictDraftDirtyRef = useRef(false)
  const languageHint = useMemo(
    () => inferLanguageFromRelativePath(activeFile?.path ?? ''),
    [activeFile?.path]
  )
  const shouldShowDiffViewer = open && visible && contentVisible
  const isConflictFile = activeFile?.scope === 'conflicted'
  const conflictDataForActiveFile = isConflictFile && conflictData?.filePath === activeFile?.path
    ? conflictData
    : null
  const baseStage = conflictDataForActiveFile?.stageContents.find((item) => item.stage === 1) ?? null
  const oursStage = conflictDataForActiveFile?.stageContents.find((item) => item.stage === 2) ?? null
  const theirsStage = conflictDataForActiveFile?.stageContents.find((item) => item.stage === 3) ?? null
  const parsedConflicts = useMemo(() => parseConflictMarkers(conflictDraft), [conflictDraft])
  const conflictBlocks = parsedConflicts.blocks
  const activeConflictBlock = conflictBlocks[activeConflictBlockIndex] ?? null
  const hasConflictBlocks = conflictBlocks.length > 0
  const hasUnresolvedConflictMarkers = hasConflictBlocks
  const currentConflictPreviewContent = activeConflictBlock ? activeConflictBlock.oursContent : (oursStage?.output ?? '')
  const incomingConflictPreviewContent = activeConflictBlock ? activeConflictBlock.theirsContent : (theirsStage?.output ?? '')

  useEffect(() => {
    if (!isConflictFile) {
      if (conflictDraft !== '') setConflictDraft('')
      conflictDraftDirtyRef.current = false
      return
    }
    if (!conflictDataForActiveFile) return
    if (conflictDraftDirtyRef.current) return
    const nextDraft = conflictDataForActiveFile.workingTreeContent
    setConflictDraft((prev) => (prev === nextDraft ? prev : nextDraft))
  }, [
    isConflictFile,
    activeFile?.path,
    conflictDataForActiveFile?.checkedAt,
    conflictDataForActiveFile?.workingTreeContent,
  ])

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

  useEffect(() => {
    if (conflictBlocks.length <= 0) {
      if (activeConflictBlockIndex !== 0) setActiveConflictBlockIndex(0)
      return
    }
    if (activeConflictBlockIndex >= conflictBlocks.length) {
      setActiveConflictBlockIndex(conflictBlocks.length - 1)
    }
  }, [conflictBlocks, activeConflictBlockIndex])

  const applyConflictBlockResolution = (
    mode: 'ours' | 'theirs' | 'both-ours-first' | 'both-theirs-first'
  ) => {
    if (!activeConflictBlock) return
    const replacement = mode === 'ours'
      ? activeConflictBlock.oursContent
      : mode === 'theirs'
        ? activeConflictBlock.theirsContent
        : mode === 'both-ours-first'
          ? `${activeConflictBlock.oursContent}${activeConflictBlock.theirsContent}`
          : `${activeConflictBlock.theirsContent}${activeConflictBlock.oursContent}`
    const nextDraft = replaceConflictBlock(conflictDraft, activeConflictBlock, replacement)
    conflictDraftDirtyRef.current = true
    setConflictDraft(nextDraft)
  }

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
                支持普通 diff 查看与冲突文件三方合并解决
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
                        {isConflictFile
                          ? `冲突解决模式 · ${languageHint}`
                          : `${diffViewMode === 'staged' ? '暂存区变更' : '工作区变更'} · ${languageHint}`
                        }
                      </p>
                    </div>
                    {!isConflictFile ? (
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
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          className="inline-flex h-8 items-center gap-1 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-3 text-[10.5px] text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-60"
                          onClick={() => {
                            conflictDraftDirtyRef.current = false
                            onLoadConflict(activeFile.path)
                          }}
                          disabled={conflictLoading || conflictSaving}
                        >
                          <RefreshCw className={`h-3.5 w-3.5 ${conflictLoading ? 'animate-spin' : ''}`} />
                          重新加载
                        </button>
                        <button
                          type="button"
                          className="inline-flex h-8 items-center gap-1 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-3 text-[10.5px] text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-60"
                          onClick={() => {
                            conflictDraftDirtyRef.current = false
                            onSaveConflict({ filePath: activeFile.path, content: conflictDraft, markResolved: false })
                          }}
                          disabled={conflictLoading || conflictSaving || hasUnresolvedConflictMarkers}
                          title={hasUnresolvedConflictMarkers ? '仍有冲突标记，请先处理所有冲突块' : undefined}
                        >
                          <Save className="h-3.5 w-3.5" />
                          仅保存
                        </button>
                        <button
                          type="button"
                          className="inline-flex h-8 items-center gap-1 rounded-full bg-primary px-3 text-[10.5px] font-medium text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
                          onClick={() => {
                            conflictDraftDirtyRef.current = false
                            onSaveConflict({ filePath: activeFile.path, content: conflictDraft, markResolved: true })
                          }}
                          disabled={conflictLoading || conflictSaving || hasUnresolvedConflictMarkers}
                          title={hasUnresolvedConflictMarkers ? '仍有冲突标记，请先处理所有冲突块' : undefined}
                        >
                          <CheckCheck className="h-3.5 w-3.5" />
                          保存并标记解决
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="min-h-0 flex-1">
                    {!isConflictFile ? (
                      diffLoading ? (
                        <div className="flex h-full items-center justify-center text-[11px] text-[color:var(--color-muted-foreground)]">
                          正在加载 diff...
                        </div>
                      ) : diffError ? (
                        <div className="flex h-full items-center justify-center px-4 text-[11px] text-[color:var(--color-destructive)]">
                          {diffError}
                        </div>
                      ) : shouldShowDiffViewer ? (
                        <MonacoTextViewer
                          value={diffContent || ''}
                          filePath={activeFile.path}
                          language={DIFF_MONACO_LANGUAGE_ID}
                          readOnly
                          modelNamespace="git-diff"
                        />
                      ) : (
                        <div className="h-full w-full" aria-hidden="true" />
                      )
                    ) : (
                      <div className="flex h-full min-h-0 flex-col gap-3 p-3">
                        <div className={`rounded-[12px] border px-3 py-2 text-[11px] ${
                          hasConflictBlocks
                            ? 'border-[color:var(--color-destructive)]/35 bg-[color:var(--color-destructive-background)] text-[color:var(--color-destructive)]'
                            : 'border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)] text-[color:var(--color-muted-foreground)]'
                        }`}>
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <AlertTriangle className="h-3.5 w-3.5" />
                              <span>
                                {hasConflictBlocks
                                  ? `检测到 ${conflictBlocks.length} 处冲突，可对当前块执行“接受当前/接受传入/接受组合”。`
                                  : '未检测到冲突标记，可直接对左右来源进行对比后编辑结果。'
                                }
                              </span>
                            </div>
                            {hasConflictBlocks && (
                              <span className="shrink-0 rounded-full border border-[color:var(--color-warning)]/35 bg-[color:var(--color-warning-background)] px-2 py-0.5 text-[10px]">
                                冲突 {Math.min(activeConflictBlockIndex + 1, conflictBlocks.length)} / {conflictBlocks.length}
                              </span>
                            )}
                          </div>
                        </div>

                        {conflictLoading ? (
                          <div className="flex min-h-0 flex-1 items-center justify-center text-[11px] text-[color:var(--color-muted-foreground)]">
                            正在加载冲突三方内容...
                          </div>
                        ) : conflictError ? (
                          <div className="flex min-h-0 flex-1 items-center justify-center rounded-[12px] border border-[color:var(--color-destructive)]/25 bg-[color:var(--color-destructive-background)] px-4 text-[11px] text-[color:var(--color-destructive)]">
                            {conflictError}
                          </div>
                        ) : !conflictDataForActiveFile ? (
                          <div className="flex min-h-0 flex-1 items-center justify-center rounded-[12px] border border-dashed border-[color:var(--color-border)] px-4 text-[11px] text-[color:var(--color-muted-foreground)]">
                            冲突详情未加载，点击“重新加载”读取 base/ours/theirs。
                          </div>
                        ) : (
                          <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)_minmax(0,1fr)] gap-3">
                            {hasConflictBlocks && (
                              <div className="rounded-[12px] border border-[color:var(--color-border)] bg-[color:var(--color-card)]/75 px-3 py-2.5">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-[11px] font-medium text-[color:var(--color-foreground)]">
                                    冲突块导航
                                  </p>
                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[color:var(--color-border)] text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)] disabled:cursor-not-allowed disabled:opacity-45"
                                      onClick={() => setActiveConflictBlockIndex((prev) => Math.max(0, prev - 1))}
                                      disabled={activeConflictBlockIndex <= 0}
                                      title="上一个冲突块"
                                    >
                                      <ChevronLeft className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[color:var(--color-border)] text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)] disabled:cursor-not-allowed disabled:opacity-45"
                                      onClick={() => setActiveConflictBlockIndex((prev) => Math.min(conflictBlocks.length - 1, prev + 1))}
                                      disabled={activeConflictBlockIndex >= conflictBlocks.length - 1}
                                      title="下一个冲突块"
                                    >
                                      <ChevronRight className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                </div>
                                {activeConflictBlock && (
                                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10.5px]">
                                    <span className="rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)] px-2 py-0.5 text-[color:var(--color-foreground)]">
                                      行 {activeConflictBlock.startLine}-{activeConflictBlock.endLine}
                                    </span>
                                    <span className="rounded-full border border-[color:var(--color-primary)]/25 bg-[color:var(--color-primary)]/10 px-2 py-0.5 text-[color:var(--color-primary)]">
                                      当前: {activeConflictBlock.oursLabel || 'OURS'}
                                    </span>
                                    <span className="rounded-full border border-[color:var(--color-warning)]/35 bg-[color:var(--color-warning-background)] px-2 py-0.5 text-[color:var(--color-warning)]">
                                      传入: {activeConflictBlock.theirsLabel || 'THEIRS'}
                                    </span>
                                  </div>
                                )}
                              </div>
                            )}

                            <div className="grid min-h-0 grid-cols-2 gap-3 max-[1280px]:grid-cols-1">
                              <div className="grid min-h-0 grid-rows-[56px_minmax(160px,1fr)] rounded-[12px] border border-[color:var(--color-border)] bg-[color:var(--color-card)]/75">
                                <div className="flex items-center justify-between gap-2 border-b border-[color:var(--color-border)]/85 px-3 py-2">
                                  <div className="min-w-0">
                                    <p className="text-[11px] font-medium text-[color:var(--color-foreground)]">当前（OURS）</p>
                                    <p className="text-[10px] text-[color:var(--color-muted-foreground)]">只读来源</p>
                                  </div>
                                  <button
                                    type="button"
                                    className="inline-flex h-7 items-center rounded-full border border-[color:var(--color-border)] px-2.5 text-[10px] font-medium text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-45"
                                    disabled={conflictLoading || conflictSaving || (!hasConflictBlocks && !oursStage?.exists)}
                                    onClick={() => {
                                      if (hasConflictBlocks) {
                                        applyConflictBlockResolution('ours')
                                        return
                                      }
                                      if (!oursStage?.exists) return
                                      conflictDraftDirtyRef.current = true
                                      setConflictDraft(oursStage.output)
                                    }}
                                    title={hasConflictBlocks ? '接受当前（仅作用于当前冲突块）' : '接受当前（覆盖整份结果）'}
                                  >
                                    接受当前
                                  </button>
                                </div>
                                <div className="min-h-0">
                                  {currentConflictPreviewContent ? (
                                    <MonacoTextViewer
                                      value={currentConflictPreviewContent}
                                      filePath={`${activeFile.path}:current-preview`}
                                      language={languageHint}
                                      readOnly
                                      modelNamespace="git-conflict-current-preview"
                                    />
                                  ) : (
                                    <div className="flex h-full items-center justify-center text-[11px] text-[color:var(--color-muted-foreground)]">
                                      当前来源不存在（新增/删除冲突场景可能出现）。
                                    </div>
                                  )}
                                </div>
                              </div>

                              <div className="grid min-h-0 grid-rows-[56px_minmax(160px,1fr)] rounded-[12px] border border-[color:var(--color-border)] bg-[color:var(--color-card)]/75">
                                <div className="flex items-center justify-between gap-2 border-b border-[color:var(--color-border)]/85 px-3 py-2">
                                  <div className="min-w-0">
                                    <p className="text-[11px] font-medium text-[color:var(--color-foreground)]">传入（THEIRS）</p>
                                    <p className="text-[10px] text-[color:var(--color-muted-foreground)]">只读来源</p>
                                  </div>
                                  <button
                                    type="button"
                                    className="inline-flex h-7 items-center rounded-full border border-[color:var(--color-border)] px-2.5 text-[10px] font-medium text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-45"
                                    disabled={conflictLoading || conflictSaving || (!hasConflictBlocks && !theirsStage?.exists)}
                                    onClick={() => {
                                      if (hasConflictBlocks) {
                                        applyConflictBlockResolution('theirs')
                                        return
                                      }
                                      if (!theirsStage?.exists) return
                                      conflictDraftDirtyRef.current = true
                                      setConflictDraft(theirsStage.output)
                                    }}
                                    title={hasConflictBlocks ? '接受传入（仅作用于当前冲突块）' : '接受传入（覆盖整份结果）'}
                                  >
                                    接受传入
                                  </button>
                                </div>
                                <div className="min-h-0">
                                  {incomingConflictPreviewContent ? (
                                    <MonacoTextViewer
                                      value={incomingConflictPreviewContent}
                                      filePath={`${activeFile.path}:incoming-preview`}
                                      language={languageHint}
                                      readOnly
                                      modelNamespace="git-conflict-incoming-preview"
                                    />
                                  ) : (
                                    <div className="flex h-full items-center justify-center text-[11px] text-[color:var(--color-muted-foreground)]">
                                      传入来源不存在（新增/删除冲突场景可能出现）。
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="grid min-h-0 grid-rows-[58px_minmax(260px,1fr)] rounded-[12px] border border-[color:var(--color-border)] bg-[color:var(--color-card)]/75">
                              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[color:var(--color-border)]/85 px-3 py-2">
                                <div className="min-w-0">
                                  <p className="text-[11px] font-medium text-[color:var(--color-foreground)]">结果（工作区，可编辑）</p>
                                  <p className="text-[10px] text-[color:var(--color-muted-foreground)]">
                                    保存后写回工作区，标记解决会自动执行 `git add`
                                  </p>
                                </div>
                                <div className="quiet-control flex flex-wrap items-center gap-1 rounded-full border border-[color:var(--color-border)]/75 p-1">
                                  {hasConflictBlocks ? (
                                    <>
                                      <button
                                        type="button"
                                        className="rounded-full px-2.5 py-1 text-[10px] font-medium text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)] disabled:cursor-not-allowed disabled:opacity-45"
                                        disabled={conflictLoading || conflictSaving || !activeConflictBlock}
                                        onClick={() => applyConflictBlockResolution('both-ours-first')}
                                        title="接受组合：当前在前，传入在后（仅作用于当前冲突块）"
                                      >
                                        接受组合（当前优先）
                                      </button>
                                      <button
                                        type="button"
                                        className="rounded-full px-2.5 py-1 text-[10px] font-medium text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)] disabled:cursor-not-allowed disabled:opacity-45"
                                        disabled={conflictLoading || conflictSaving || !activeConflictBlock}
                                        onClick={() => applyConflictBlockResolution('both-theirs-first')}
                                        title="接受组合：传入在前，当前在后（仅作用于当前冲突块）"
                                      >
                                        接受组合（传入优先）
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      <button
                                        type="button"
                                        className="rounded-full px-2.5 py-1 text-[10px] font-medium text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)] disabled:cursor-not-allowed disabled:opacity-45"
                                        disabled={conflictLoading || conflictSaving || !oursStage?.exists || !theirsStage?.exists}
                                        onClick={() => {
                                          conflictDraftDirtyRef.current = true
                                          setConflictDraft(`${oursStage?.output ?? ''}${theirsStage?.output ?? ''}`)
                                        }}
                                        title="接受组合：当前在前，传入在后（覆盖整份结果）"
                                      >
                                        组合整份（当前优先）
                                      </button>
                                      <button
                                        type="button"
                                        className="rounded-full px-2.5 py-1 text-[10px] font-medium text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)] disabled:cursor-not-allowed disabled:opacity-45"
                                        disabled={conflictLoading || conflictSaving || !oursStage?.exists || !theirsStage?.exists}
                                        onClick={() => {
                                          conflictDraftDirtyRef.current = true
                                          setConflictDraft(`${theirsStage?.output ?? ''}${oursStage?.output ?? ''}`)
                                        }}
                                        title="接受组合：传入在前，当前在后（覆盖整份结果）"
                                      >
                                        组合整份（传入优先）
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>
                              <div className="min-h-0">
                                <MonacoTextViewer
                                  value={conflictDraft}
                                  filePath={`${activeFile.path}:resolved`}
                                  language={languageHint}
                                  readOnly={conflictSaving}
                                  modelNamespace="git-conflict-resolved"
                                  onChange={(nextValue) => {
                                    conflictDraftDirtyRef.current = true
                                    setConflictDraft(nextValue)
                                  }}
                                />
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
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
})

export { DetailGitDiffDrawer }
