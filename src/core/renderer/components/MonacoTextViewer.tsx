import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { IDisposable, editor as MonacoEditor } from 'monaco-editor'
import { useEffectiveTheme } from '../hooks/useEffectiveTheme'
import {
  installMonacoFindWidgetHoverGuard,
  type MonacoThemeName,
} from '../lib/monacoEnvironment'
import { loadMonacoEditorModule } from '../lib/monacoPreload'

export type MonacoTextViewerHiddenLineRange = {
  startLineNumber: number
  endLineNumber: number
}

type MonacoTextViewerProps = {
  value: string
  filePath: string
  language: string
  readOnly: boolean
  modelNamespace: string
  onChange?: (nextValue: string) => void
  prepareMonaco?: (monaco: typeof import('monaco-editor')) => void | Promise<void>
  fontFamily?: string
  fontSize?: number
  lineHeight?: number
  padding?: { top: number; bottom: number }
  stickyScroll?: boolean
  focusOnReveal?: boolean
  contentWidget?: MonacoTextViewerContentWidget | null
  hiddenLineRanges?: MonacoTextViewerHiddenLineRange[]
}

export type MonacoTextViewerContentWidgetAction = {
  key: string
  label: string
  variant?: 'default' | 'primary' | 'danger'
  onSelect: () => void
}

export type MonacoTextViewerContentWidget = {
  id: string
  lineNumber: number
  column?: number
  positionPreference?: 'above' | 'below'
  actions: MonacoTextViewerContentWidgetAction[]
}

export interface MonacoTextViewerHandle {
  revealPosition: (lineNumber: number, column?: number, topLineOffset?: number) => void
  highlightLine: (lineNumber: number) => void
  highlightRange: (startLineNumber: number, endLineNumber?: number) => void
}

type MonacoEditorWithHiddenAreas = MonacoEditor.IStandaloneCodeEditor & {
  setHiddenAreas?: (
    ranges: Array<{
      startLineNumber: number
      startColumn: number
      endLineNumber: number
      endColumn: number
    }>,
    source?: unknown,
    forceUpdate?: boolean
  ) => void
}

function createMonacoModelUri(modelNamespace: string, filePath: string): string {
  return `inmemory://${modelNamespace}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${filePath.replace(/[^\w./-]/g, '_')}`
}

export const MonacoTextViewer = forwardRef<MonacoTextViewerHandle, MonacoTextViewerProps>(function MonacoTextViewer({
  value,
  filePath,
  language,
  readOnly,
  modelNamespace,
  onChange,
  prepareMonaco,
  fontFamily = "'JetBrains Mono', 'SFMono-Regular', Menlo, Monaco, Consolas, monospace",
  fontSize = 12.5,
  lineHeight = 20,
  padding = { top: 10, bottom: 10 },
  stickyScroll = false,
  focusOnReveal = true,
  contentWidget = null,
  hiddenLineRanges = [],
}, ref) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const editorRuntimeRef = useRef({
    editor: null as MonacoEditor.IStandaloneCodeEditor | null,
    model: null as MonacoEditor.ITextModel | null,
    monaco: null as typeof import('monaco-editor') | null,
    syncGuard: false,
    subscription: null as IDisposable | null,
    highlightDecorations: [] as string[],
    pendingRevealPosition: null as { lineNumber: number; column: number; topLineOffset?: number } | null,
    pendingHighlightLine: null as number | null,
    pendingHighlightRange: null as { startLineNumber: number; endLineNumber: number } | null,
    contentWidget: null as MonacoEditor.IContentWidget | null,
  })
  const onChangeRef = useRef(onChange)
  const prepareMonacoRef = useRef(prepareMonaco)
  const contentWidgetRef = useRef(contentWidget)
  const latestPropsRef = useRef({
    value,
    filePath,
    language,
    readOnly,
    fontFamily,
    fontSize,
    lineHeight,
    padding,
    stickyScroll,
    hiddenLineRanges,
  })
  const effectiveTheme = useEffectiveTheme()
  const [theme, setTheme] = useState<MonacoThemeName>(() => (effectiveTheme === 'dark' ? 'vs-dark' : 'vs'))

  latestPropsRef.current = {
    value,
    filePath,
    language,
    readOnly,
    fontFamily,
    fontSize,
    lineHeight,
    padding,
    stickyScroll,
    hiddenLineRanges,
  }

  const syncContentWidget = (): boolean => {
    const runtime = editorRuntimeRef.current
    const editor = runtime.editor
    const model = runtime.model
    const monaco = runtime.monaco
    if (!editor || !model || !monaco) return false

    if (runtime.contentWidget) {
      editor.removeContentWidget(runtime.contentWidget)
      runtime.contentWidget = null
    }

    const spec = contentWidgetRef.current
    if (!spec || spec.actions.length <= 0) return true

    const domNode = document.createElement('div')
    domNode.className = 'monaco-inline-action-widget'
    domNode.dataset.widgetId = spec.id

    for (const action of spec.actions) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = `monaco-inline-action-widget__button${action.variant ? ` is-${action.variant}` : ''}`
      button.textContent = action.label
      button.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        action.onSelect()
      })
      domNode.appendChild(button)
    }

    const widget: MonacoEditor.IContentWidget = {
      getId: () => `monaco-inline-action-widget-${spec.id}`,
      getDomNode: () => domNode,
      getPosition: () => ({
        position: {
          lineNumber: Math.min(Math.max(1, spec.lineNumber), model.getLineCount()),
          column: Math.max(1, spec.column ?? 1),
        },
        preference: [
          spec.positionPreference === 'below'
            ? monaco.editor.ContentWidgetPositionPreference.BELOW
            : monaco.editor.ContentWidgetPositionPreference.ABOVE,
        ],
      }),
      allowEditorOverflow: true,
      suppressMouseDown: true,
    }

    editor.addContentWidget(widget)
    runtime.contentWidget = widget
    return true
  }

  const syncHiddenLineRanges = (): boolean => {
    const runtime = editorRuntimeRef.current
    const editor = runtime.editor as MonacoEditorWithHiddenAreas | null
    const monaco = runtime.monaco
    if (!editor || !monaco || typeof editor.setHiddenAreas !== 'function') return false

    editor.setHiddenAreas(
      hiddenLineRanges.map((range) => new monaco.Range(
        range.startLineNumber,
        1,
        range.endLineNumber,
        1
      )),
      undefined,
      true
    )
    return true
  }

  const revealPositionInEditor = (lineNumber: number, column = 1, topLineOffset?: number): boolean => {
    const editor = editorRuntimeRef.current.editor
    const model = editorRuntimeRef.current.model
    if (!editor || !model) return false

    const safeLine = Math.min(Math.max(1, Math.floor(lineNumber)), model.getLineCount())
    const safeColumn = Math.min(Math.max(1, Math.floor(column)), model.getLineMaxColumn(safeLine))
    editor.setPosition({ lineNumber: safeLine, column: safeColumn })
    if (typeof topLineOffset === 'number' && Number.isFinite(topLineOffset)) {
      const lineHeightPx = Math.max(1, latestPropsRef.current.lineHeight)
      const scrollTop = Math.max(
        0,
        editor.getTopForLineNumber(safeLine) - Math.max(0, Math.floor(topLineOffset)) * lineHeightPx
      )
      editor.setScrollTop(scrollTop)
    } else {
      editor.revealPositionInCenter({ lineNumber: safeLine, column: safeColumn })
    }
    if (focusOnReveal) {
      editor.focus()
    }
    return true
  }

  const highlightLineInEditor = (lineNumber: number): boolean => {
    return highlightRangeInEditor(lineNumber, lineNumber)
  }

  const highlightRangeInEditor = (startLineNumber: number, endLineNumber = startLineNumber): boolean => {
    const editor = editorRuntimeRef.current.editor
    const model = editorRuntimeRef.current.model
    const monaco = editorRuntimeRef.current.monaco
    if (!editor || !model || !monaco) return false

    const safeStartLine = Math.min(Math.max(1, Math.floor(startLineNumber)), model.getLineCount())
    const safeEndLine = Math.min(
      Math.max(safeStartLine, Math.floor(endLineNumber)),
      model.getLineCount()
    )
    editorRuntimeRef.current.highlightDecorations = editor.deltaDecorations(
      editorRuntimeRef.current.highlightDecorations,
      [{
        range: new monaco.Range(safeStartLine, 1, safeEndLine, model.getLineMaxColumn(safeEndLine)),
        options: {
          isWholeLine: true,
          className: 'monaco-text-viewer-highlight-line',
          linesDecorationsClassName: 'monaco-text-viewer-highlight-line-gutter',
          lineNumberClassName: 'monaco-text-viewer-highlight-line-number',
        },
      }]
    )
    return true
  }

  const flushPendingEditorActions = (): void => {
    const runtime = editorRuntimeRef.current

    if (runtime.pendingRevealPosition) {
      const { lineNumber, column, topLineOffset } = runtime.pendingRevealPosition
      if (revealPositionInEditor(lineNumber, column, topLineOffset)) {
        runtime.pendingRevealPosition = null
      }
    }

    if (runtime.pendingHighlightLine != null) {
      if (highlightLineInEditor(runtime.pendingHighlightLine)) {
        runtime.pendingHighlightLine = null
      }
    }

    if (runtime.pendingHighlightRange) {
      const { startLineNumber, endLineNumber } = runtime.pendingHighlightRange
      if (highlightRangeInEditor(startLineNumber, endLineNumber)) {
        runtime.pendingHighlightRange = null
      }
    }
  }

  useImperativeHandle(ref, () => ({
    revealPosition: (lineNumber: number, column = 1, topLineOffset) => {
      if (revealPositionInEditor(lineNumber, column, topLineOffset)) return
      editorRuntimeRef.current.pendingRevealPosition = { lineNumber, column, topLineOffset }
    },
    highlightLine: (lineNumber: number) => {
      if (highlightLineInEditor(lineNumber)) return
      editorRuntimeRef.current.pendingHighlightLine = lineNumber
    },
    highlightRange: (startLineNumber: number, endLineNumber = startLineNumber) => {
      if (highlightRangeInEditor(startLineNumber, endLineNumber)) return
      editorRuntimeRef.current.pendingHighlightRange = { startLineNumber, endLineNumber }
    },
  }), [])

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    prepareMonacoRef.current = prepareMonaco
  }, [prepareMonaco])

  useEffect(() => {
    contentWidgetRef.current = contentWidget
    void syncContentWidget()
  }, [contentWidget])

  useEffect(() => {
    void syncHiddenLineRanges()
  }, [hiddenLineRanges])

  useEffect(() => {
    setTheme(effectiveTheme === 'dark' ? 'vs-dark' : 'vs')
  }, [effectiveTheme])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let disposed = false
    const removeHoverGuard = installMonacoFindWidgetHoverGuard(container)

    const setup = async () => {
      const monaco = await loadMonacoEditorModule()
      if (disposed) return

      await prepareMonacoRef.current?.(monaco)
      if (disposed) return

      const initialProps = latestPropsRef.current
      const effectiveLanguage = initialProps.language || 'plaintext'
      const model = monaco.editor.createModel(
        initialProps.value,
        effectiveLanguage,
        monaco.Uri.parse(createMonacoModelUri(modelNamespace, initialProps.filePath))
      )
      const editor = monaco.editor.create(container, {
        model,
        automaticLayout: true,
        minimap: { enabled: false },
        fontFamily: initialProps.fontFamily,
        fontSize: initialProps.fontSize,
        lineHeight: initialProps.lineHeight,
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        renderWhitespace: 'selection',
        padding: initialProps.padding,
        theme,
        readOnly: initialProps.readOnly,
        stickyScroll: { enabled: initialProps.stickyScroll },
      })

      let subscription: IDisposable | null = null
      if (onChangeRef.current) {
        subscription = editor.onDidChangeModelContent(() => {
          if (editorRuntimeRef.current.syncGuard) return
          onChangeRef.current?.(model.getValue())
        })
      }

      editorRuntimeRef.current.monaco = monaco
      editorRuntimeRef.current.model = model
      editorRuntimeRef.current.editor = editor
      editorRuntimeRef.current.subscription = subscription
      flushPendingEditorActions()
      syncHiddenLineRanges()
      syncContentWidget()
    }

    void setup()

    return () => {
      disposed = true
      removeHoverGuard()
      if (editorRuntimeRef.current.editor) {
        editorRuntimeRef.current.editor.deltaDecorations(
          editorRuntimeRef.current.highlightDecorations,
          []
        )
      }
      editorRuntimeRef.current.subscription?.dispose()
      if (editorRuntimeRef.current.contentWidget) {
        editorRuntimeRef.current.editor?.removeContentWidget(editorRuntimeRef.current.contentWidget)
      }
      editorRuntimeRef.current.editor?.dispose()
      editorRuntimeRef.current.model?.dispose()
      editorRuntimeRef.current.editor = null
      editorRuntimeRef.current.model = null
      editorRuntimeRef.current.monaco = null
      editorRuntimeRef.current.subscription = null
      editorRuntimeRef.current.highlightDecorations = []
      editorRuntimeRef.current.pendingRevealPosition = null
      editorRuntimeRef.current.pendingHighlightLine = null
      editorRuntimeRef.current.pendingHighlightRange = null
      editorRuntimeRef.current.contentWidget = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const runtime = editorRuntimeRef.current
    if (!runtime.monaco) return
    runtime.monaco.editor.setTheme(theme)
  }, [theme])

  useEffect(() => {
    const runtime = editorRuntimeRef.current
    if (!runtime.editor) return
    runtime.editor.updateOptions({ readOnly })
  }, [readOnly])

  useEffect(() => {
    const runtime = editorRuntimeRef.current
    if (!runtime.editor) return
    runtime.editor.updateOptions({
      fontFamily,
      fontSize,
      lineHeight,
      padding,
      stickyScroll: { enabled: stickyScroll },
    })
    runtime.editor.layout()
    runtime.editor.render(true)
  }, [fontFamily, fontSize, lineHeight, padding, stickyScroll])

  useEffect(() => {
    const runtime = editorRuntimeRef.current
    const model = runtime.model
    const monaco = runtime.monaco
    if (!model || !monaco) return
    const nextLanguage = language || 'plaintext'
    if (model.getLanguageId() !== nextLanguage) {
      monaco.editor.setModelLanguage(model, nextLanguage)
    }
  }, [language])

  useEffect(() => {
    const runtime = editorRuntimeRef.current
    const model = runtime.model
    if (!model) return
    if (model.getValue() === value) return
    runtime.syncGuard = true
    model.pushEditOperations([], [{ range: model.getFullModelRange(), text: value }], () => null)
    runtime.syncGuard = false
  }, [value])

  return (
    <div className="h-full w-full">
      <div
        ref={containerRef}
        className="h-full w-full"
      />
    </div>
  )
})
