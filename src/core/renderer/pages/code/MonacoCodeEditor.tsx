import { useEffect, useRef } from 'react'
import type { editor as MonacoEditor } from 'monaco-editor'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

interface MonacoCodeEditorProps {
  value: string
  language: string
  theme: 'vs' | 'vs-dark'
  filePath: string | null
  isReadOnly?: boolean
  onChange: (value: string) => void
  onSave: () => void
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

export function MonacoCodeEditor({
  value,
  language,
  theme,
  filePath,
  isReadOnly = false,
  onChange,
  onSave,
}: MonacoCodeEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null)
  const modelRef = useRef<MonacoEditor.ITextModel | null>(null)
  const syncGuardRef = useRef(false)

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
        fontFamily: "'JetBrains Mono', 'SFMono-Regular', Menlo, Monaco, Consolas, monospace",
        fontSize: 13,
        lineHeight: 20,
        tabSize: 2,
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        renderWhitespace: 'selection',
        bracketPairColorization: { enabled: true },
        padding: { top: 14, bottom: 14 },
        readOnly: isReadOnly,
        theme,
      })
      editorRef.current = editor

      editor.onDidChangeModelContent(() => {
        if (syncGuardRef.current) return
        onChange(editor.getValue())
      })

      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        onSave()
      })
    }

    void setup()

    return () => {
      disposed = true
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
}
