import type { editor as MonacoEditor } from 'monaco-editor'
import { type MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TranscriptFileReference } from '../../../shared/types'

const HOVER_HIDE_DELAY_MS = 160

export type TranscriptGutterHover = {
  x: number
  y: number
  items: TranscriptFileReference[]
}

type UseMonacoTranscriptGutterOptions = {
  editorRef: MutableRefObject<MonacoEditor.IStandaloneCodeEditor | null>
  monacoRef: MutableRefObject<typeof import('monaco-editor') | null>
  references: TranscriptFileReference[]
  onOpenReference: (item: TranscriptFileReference) => void
}

/** 将同一行的多个引用合并为一组，行号缺省按 1 处理。 */
function groupReferencesByLine(references: TranscriptFileReference[]): Map<number, TranscriptFileReference[]> {
  const grouped = new Map<number, TranscriptFileReference[]>()
  for (const item of references) {
    const line = Math.max(1, Math.floor(item.reference.lineNumber ?? 1))
    const bucket = grouped.get(line)
    if (bucket) {
      bucket.push(item)
    } else {
      grouped.set(line, [item])
    }
  }
  return grouped
}

export function useMonacoTranscriptGutter({ editorRef, monacoRef, references, onOpenReference }: UseMonacoTranscriptGutterOptions) {
  // editor 实例版本信号：MonacoCodeEditor 异步创建编辑器，就绪后调用 syncEditorInstance 触发装饰同步。
  const [editorInstance, setEditorInstance] = useState<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const [hover, setHover] = useState<TranscriptGutterHover | null>(null)

  const referencesByLine = useMemo(() => groupReferencesByLine(references), [references])
  const referencesByLineRef = useRef(referencesByLine)
  referencesByLineRef.current = referencesByLine

  const onOpenReferenceRef = useRef(onOpenReference)
  onOpenReferenceRef.current = onOpenReference

  // 装饰 id 按 model uri 记账：model 是跨文件缓存的，重同步前先移除旧装饰，避免切回旧文件时叠加。
  const decorationsByModelRef = useRef(new Map<string, string[]>())

  const hideHoverTimerRef = useRef<number | null>(null)

  const clearHoverHideTimer = useCallback(() => {
    if (hideHoverTimerRef.current != null) {
      window.clearTimeout(hideHoverTimerRef.current)
      hideHoverTimerRef.current = null
    }
  }, [])

  const hideHover = useCallback(() => {
    clearHoverHideTimer()
    setHover(null)
  }, [clearHoverHideTimer])

  const scheduleHoverHide = useCallback(() => {
    clearHoverHideTimer()
    hideHoverTimerRef.current = window.setTimeout(() => {
      hideHoverTimerRef.current = null
      setHover(null)
    }, HOVER_HIDE_DELAY_MS)
  }, [clearHoverHideTimer])

  const syncDecorations = useCallback(
    (grouped: Map<number, TranscriptFileReference[]>) => {
      const editor = editorRef.current
      const monaco = monacoRef.current
      if (!editor || !monaco) return

      const model = editor.getModel()
      if (!model) return

      const modelKey = model.uri.toString()
      const previousIds = decorationsByModelRef.current.get(modelKey) ?? []
      const lines = Array.from(grouped.keys())

      const nextIds =
        lines.length > 0
          ? editor.deltaDecorations(
              previousIds,
              lines.map((line) => ({
                range: new monaco.Range(line, 1, line, 1),
                options: {
                  isWholeLine: true,
                  linesDecorationsClassName: 'monaco-transcript-ref-gutter',
                },
              })),
            )
          : previousIds.length > 0
            ? editor.deltaDecorations(previousIds, [])
            : []

      if (nextIds.length > 0) {
        decorationsByModelRef.current.set(modelKey, nextIds)
      } else {
        decorationsByModelRef.current.delete(modelKey)
      }
    },
    [editorRef, monacoRef],
  )

  // onDidChangeModel 需要调用到最新的 syncDecorations。
  const syncDecorationsRef = useRef(syncDecorations)
  syncDecorationsRef.current = syncDecorations

  const syncEditorInstance = useCallback((editor: MonacoEditor.IStandaloneCodeEditor | null) => {
    setEditorInstance(editor)
  }, [])

  // 装饰同步：editor 就绪或 references 变化时执行。
  useEffect(() => {
    if (!editorInstance) return
    syncDecorations(referencesByLine)
  }, [editorInstance, referencesByLine, syncDecorations])

  // 事件监听：editor 实例变更时重建，卸载时统一 dispose。
  useEffect(() => {
    const editor = editorInstance
    const monaco = monacoRef.current
    if (!editor || !monaco) return

    const disposables: Array<{ dispose: () => void }> = []

    const findReferencesAtLine = (lineNumber: number | undefined): TranscriptFileReference[] => {
      if (!lineNumber) return []
      return referencesByLineRef.current.get(lineNumber) ?? []
    }

    disposables.push(
      editor.onDidChangeModel(() => {
        hideHover()
        syncDecorationsRef.current(referencesByLineRef.current)
      }),
    )

    disposables.push(
      editor.onMouseDown((event) => {
        if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS) return
        const items = findReferencesAtLine(event.target.position?.lineNumber)
        if (items.length <= 0) return
        hideHover()
        onOpenReferenceRef.current(items[0])
      }),
    )

    disposables.push(
      editor.onMouseMove((event) => {
        const inMarker = event.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS && findReferencesAtLine(event.target.position?.lineNumber).length > 0
        if (!inMarker) {
          if (hideHoverTimerRef.current == null) setHover((current) => (current ? null : current))
          return
        }
        clearHoverHideTimer()
        setHover({
          x: event.event.browserEvent.clientX,
          y: event.event.browserEvent.clientY,
          items: findReferencesAtLine(event.target.position?.lineNumber),
        })
      }),
    )

    disposables.push(
      editor.onMouseLeave(() => {
        scheduleHoverHide()
      }),
    )

    disposables.push(
      editor.onDidScrollChange(() => {
        hideHover()
      }),
    )

    return () => {
      for (const disposable of disposables) {
        disposable.dispose()
      }
      hideHover()
    }
  }, [clearHoverHideTimer, editorInstance, hideHover, monacoRef, scheduleHoverHide])

  return {
    hover,
    syncEditorInstance,
    cancelHoverHide: clearHoverHideTimer,
  }
}
