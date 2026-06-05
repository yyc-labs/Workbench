import { memo, useEffect, useRef, useState } from 'react'
import type { IDisposable, editor as MonacoEditor } from 'monaco-editor'
import {
  ensureMonacoEnvironmentConfigured,
  installMonacoFindWidgetHoverGuard,
  resolveMonacoTheme,
  type MonacoThemeName,
} from '../lib/monacoEnvironment'

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
}

function createMonacoModelUri(modelNamespace: string, filePath: string): string {
  return `inmemory://${modelNamespace}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${filePath.replace(/[^\w./-]/g, '_')}`
}

export const MonacoTextViewer = memo(function MonacoTextViewer({
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
}: MonacoTextViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const editorRuntimeRef = useRef({
    editor: null as MonacoEditor.IStandaloneCodeEditor | null,
    model: null as MonacoEditor.ITextModel | null,
    monaco: null as typeof import('monaco-editor') | null,
    syncGuard: false,
    subscription: null as IDisposable | null,
  })
  const onChangeRef = useRef(onChange)
  const prepareMonacoRef = useRef(prepareMonaco)
  const [theme, setTheme] = useState<MonacoThemeName>(() => resolveMonacoTheme())

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    prepareMonacoRef.current = prepareMonaco
  }, [prepareMonaco])

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
    const removeHoverGuard = installMonacoFindWidgetHoverGuard(container)

    const setup = async () => {
      ensureMonacoEnvironmentConfigured()
      const monaco = await import('monaco-editor')
      if (disposed) return

      await prepareMonacoRef.current?.(monaco)
      if (disposed) return

      const effectiveLanguage = language || 'plaintext'
      const model = monaco.editor.createModel(
        value,
        effectiveLanguage,
        monaco.Uri.parse(createMonacoModelUri(modelNamespace, filePath))
      )
      const editor = monaco.editor.create(container, {
        model,
        automaticLayout: true,
        minimap: { enabled: false },
        fontFamily,
        fontSize,
        lineHeight,
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        renderWhitespace: 'selection',
        padding,
        theme,
        readOnly,
        stickyScroll: { enabled: stickyScroll },
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
    }

    void setup()

    return () => {
      disposed = true
      removeHoverGuard()
      editorRuntimeRef.current.subscription?.dispose()
      editorRuntimeRef.current.editor?.dispose()
      editorRuntimeRef.current.model?.dispose()
      editorRuntimeRef.current.editor = null
      editorRuntimeRef.current.model = null
      editorRuntimeRef.current.monaco = null
      editorRuntimeRef.current.subscription = null
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
