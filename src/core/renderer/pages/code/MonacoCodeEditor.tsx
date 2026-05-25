import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import type { editor as MonacoEditor } from 'monaco-editor'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

export interface MonacoEditorScrollState {
  scrollTop: number
  scrollHeight: number
  viewportHeight: number
}

export interface MonacoCodeEditorHandle {
  getScrollState: () => MonacoEditorScrollState | null
  setScrollTop: (scrollTop: number) => void
  revealPosition: (lineNumber: number, column?: number) => void
}

interface MonacoCodeEditorProps {
  value: string
  language: string
  theme: 'vs' | 'vs-dark'
  filePath: string | null
  isReadOnly?: boolean
  onChange: (value: string) => void
  onSave: () => void
  onScrollStateChange?: (state: MonacoEditorScrollState) => void
}

interface MonacoEnvironmentShape {
  getWorker: (_workerId: string, label: string) => Worker
}

declare global {
  interface Window {
    MonacoEnvironment?: MonacoEnvironmentShape
  }
}

let monacoEnvironmentReady = false

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

function createMonacoModelUri(filePath: string | null): string {
  if (filePath && filePath.trim()) {
    const normalized = filePath.replace(/\\/g, '/')
    return `file:///${normalized.replace(/^\/+/, '')}`
  }
  return `inmemory://model/${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export const MonacoCodeEditor = forwardRef<MonacoCodeEditorHandle, MonacoCodeEditorProps>(function MonacoCodeEditor({
  value,
  language,
  theme,
  filePath,
  isReadOnly = false,
  onChange,
  onSave,
  onScrollStateChange,
}, ref) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null)
  const modelRef = useRef<MonacoEditor.ITextModel | null>(null)
  const syncGuardRef = useRef(false)
  const onScrollStateChangeRef = useRef(onScrollStateChange)

  useEffect(() => {
    onScrollStateChangeRef.current = onScrollStateChange
  }, [onScrollStateChange])

  useImperativeHandle(ref, () => ({
    getScrollState: () => {
      const editor = editorRef.current
      if (!editor) return null
      const layout = editor.getLayoutInfo()
      return {
        scrollTop: editor.getScrollTop(),
        scrollHeight: editor.getScrollHeight(),
        viewportHeight: Math.max(1, layout.height - layout.horizontalScrollbarHeight),
      }
    },
    setScrollTop: (scrollTop: number) => {
      const editor = editorRef.current
      if (!editor) return
      editor.setScrollTop(Math.max(0, scrollTop))
    },
    revealPosition: (lineNumber: number, column = 1) => {
      const editor = editorRef.current
      if (!editor) return
      const safeLine = Math.max(1, Math.floor(lineNumber))
      const safeColumn = Math.max(1, Math.floor(column))
      editor.setPosition({ lineNumber: safeLine, column: safeColumn })
      editor.revealPositionInCenter({ lineNumber: safeLine, column: safeColumn })
      editor.focus()
    },
  }), [])

  useEffect(() => {
    let disposed = false

    const setup = async () => {
      const container = containerRef.current
      if (!container) return

      ensureMonacoEnvironmentConfigured()
      const monaco = await import('monaco-editor')
      if (disposed) return

      monacoRef.current = monaco
      const uri = monaco.Uri.parse(createMonacoModelUri(filePath))
      const model = monaco.editor.createModel(value, language, uri)
      modelRef.current = model

      const editor = monaco.editor.create(container, {
        model,
        automaticLayout: true,
        minimap: { enabled: false },
        // Prefer CJK-capable monospace fonts to keep width metrics stable for mixed Chinese + numbers.
        fontFamily: "'Sarasa Mono SC', 'Noto Sans Mono CJK SC', 'JetBrains Mono', 'Cascadia Mono', 'SFMono-Regular', Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
        fontSize: 13,
        lineHeight: 20,
        tabSize: 2,
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        disableMonospaceOptimizations: true,
        allowVariableFonts: false,
        fontLigatures: false,
        fontWeight: '400',
        renderWhitespace: 'selection',
        bracketPairColorization: { enabled: true },
        cursorStyle: 'line',
        cursorWidth: 2,
        overtypeCursorStyle: 'line',
        overtypeOnPaste: false,
        matchBrackets: 'near',
        roundedSelection: false,
        padding: { top: 14, bottom: 14 },
        readOnly: isReadOnly,
        theme,
      })
      editorRef.current = editor

      editor.onDidChangeModelContent(() => {
        if (syncGuardRef.current) return
        onChange(editor.getValue())
      })

      editor.onDidScrollChange(() => {
        const cb = onScrollStateChangeRef.current
        if (!cb) return
        const layout = editor.getLayoutInfo()
        cb({
          scrollTop: editor.getScrollTop(),
          scrollHeight: editor.getScrollHeight(),
          viewportHeight: Math.max(1, layout.height - layout.horizontalScrollbarHeight),
        })
      })

      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        onSave()
      })

      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyD, () => {
        editor.trigger('keyboard', 'editor.action.copyLinesDownAction', null)
      })

      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyY, () => {
        editor.trigger('keyboard', 'editor.action.deleteLines', null)
      })

      const refreshFontMetrics = () => {
        monaco.editor.remeasureFonts()
        editor.layout()
        editor.render(true)
      }

      void (async () => {
        if (typeof document === 'undefined' || !document.fonts) return
        await document.fonts.ready
        if (disposed) return
        refreshFontMetrics()
      })()

      let removeFontListener: (() => void) | undefined
      if (typeof document !== 'undefined' && document.fonts && typeof document.fonts.addEventListener === 'function') {
        const onFontsLoaded = () => {
          if (disposed) return
          refreshFontMetrics()
        }
        document.fonts.addEventListener('loadingdone', onFontsLoaded)
        removeFontListener = () => {
          document.fonts.removeEventListener('loadingdone', onFontsLoaded)
        }
      }

      const initialCb = onScrollStateChangeRef.current
      if (initialCb) {
        const layout = editor.getLayoutInfo()
        initialCb({
          scrollTop: editor.getScrollTop(),
          scrollHeight: editor.getScrollHeight(),
          viewportHeight: Math.max(1, layout.height - layout.horizontalScrollbarHeight),
        })
      }

      return removeFontListener
    }

    let cleanupFontListener: (() => void) | undefined
    void (async () => {
      cleanupFontListener = await setup()
    })()

    return () => {
      disposed = true
      if (cleanupFontListener) {
        cleanupFontListener()
      }
      const editor = editorRef.current
      if (editor) {
        editor.dispose()
        editorRef.current = null
      }
      const model = modelRef.current
      if (model) {
        model.dispose()
        modelRef.current = null
      }
      monacoRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const monaco = monacoRef.current
    if (!monaco) return
    monaco.editor.setTheme(theme)
  }, [theme])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    editor.updateOptions({ readOnly: isReadOnly })
  }, [isReadOnly])

  useEffect(() => {
    const monaco = monacoRef.current
    const model = modelRef.current
    if (!monaco || !model) return

    const nextUri = monaco.Uri.parse(createMonacoModelUri(filePath))
    const sameModelPath = model.uri.toString() === nextUri.toString()
    if (!sameModelPath) {
      model.dispose()
      const nextModel = monaco.editor.createModel(value, language, nextUri)
      modelRef.current = nextModel
      editorRef.current?.setModel(nextModel)
      return
    }

    if (model.getLanguageId() !== language) {
      monaco.editor.setModelLanguage(model, language)
    }

    if (model.getValue() !== value) {
      syncGuardRef.current = true
      model.pushEditOperations(
        [],
        [{ range: model.getFullModelRange(), text: value }],
        () => null
      )
      syncGuardRef.current = false
    }
  }, [filePath, language, value])

  return (
    <div className="h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  )
})
