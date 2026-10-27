import type { editor as MonacoEditor } from 'monaco-editor'
import { type MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TranscriptFileReference } from '../../../shared/types'

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

/** 鼠标从蓝点移向卡片的宽限期：期间进入卡片则保持显示，超时仍未进入则收起。 */
const HOVER_DISMISS_DELAY_MS = 200

export function useMonacoTranscriptGutter({ editorRef, monacoRef, references, onOpenReference }: UseMonacoTranscriptGutterOptions) {
  // editor 实例版本信号：MonacoCodeEditor 异步创建编辑器，就绪后调用 syncEditorInstance 触发装饰同步。
  const [editorInstance, setEditorInstance] = useState<MonacoEditor.IStandaloneCodeEditor | null>(null)
  // 悬浮蓝点即显示卡片（无论单条还是多条引用），用户点选后打开对应转录。
  // 收起方式：离开卡片区域、点选条目、点击卡片外区域、滚动或切换文件。
  const [pinnedHover, setPinnedHover] = useState<TranscriptGutterHover | null>(null)
  const pinnedHoverRef = useRef(pinnedHover)
  pinnedHoverRef.current = pinnedHover

  const pendingDismissTimerRef = useRef<number | null>(null)

  const referencesByLine = useMemo(() => groupReferencesByLine(references), [references])
  const referencesByLineRef = useRef(referencesByLine)
  referencesByLineRef.current = referencesByLine

  const onOpenReferenceRef = useRef(onOpenReference)
  onOpenReferenceRef.current = onOpenReference

  // 装饰 id 按 model uri 记账：model 是跨文件缓存的，重同步前先移除旧装饰，避免切回旧文件时叠加。
  const decorationsByModelRef = useRef(new Map<string, string[]>())

  const clearPendingDismiss = useCallback(() => {
    if (pendingDismissTimerRef.current !== null) {
      window.clearTimeout(pendingDismissTimerRef.current)
      pendingDismissTimerRef.current = null
    }
  }, [])

  const dismissPinned = useCallback(() => {
    clearPendingDismiss()
    setPinnedHover(null)
  }, [])

  // 指针最近位置：收起定时器触发时用它判断指针是否仍在卡片上。
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null)

  const scheduleDismiss = useCallback(() => {
    if (pendingDismissTimerRef.current !== null) return
    pendingDismissTimerRef.current = window.setTimeout(() => {
      pendingDismissTimerRef.current = null
      // 兜底：指针仍在卡片上时不收起（enter/leave 时序异常也不会误关），离开卡片由卡片 mouseleave 负责关闭。
      const pointer = lastPointerRef.current
      const cardEl = document.querySelector<HTMLElement>('[data-transcript-ref-card]')
      if (pointer && cardEl) {
        const rect = cardEl.getBoundingClientRect()
        if (pointer.x >= rect.left - 2 && pointer.x <= rect.right + 2 && pointer.y >= rect.top - 2 && pointer.y <= rect.bottom + 2) return
      }
      setPinnedHover(null)
    }, HOVER_DISMISS_DELAY_MS)
  }, [])

  const openReference = useCallback(
    (item: TranscriptFileReference) => {
      dismissPinned()
      onOpenReferenceRef.current(item)
    },
    [dismissPinned],
  )

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

    const trackPointer = (e: MouseEvent) => {
      lastPointerRef.current = { x: e.clientX, y: e.clientY }
    }
    window.addEventListener('mousemove', trackPointer)
    disposables.push({
      dispose: () => window.removeEventListener('mousemove', trackPointer),
    })

    const findReferencesAtLine = (lineNumber: number | undefined): TranscriptFileReference[] => {
      if (!lineNumber) return []
      return referencesByLineRef.current.get(lineNumber) ?? []
    }

    // 圆点居中于行号数字左侧的剩余宽度区域（见 code-editor.css ::before），悬浮只在圆点附近触发。
    const DOT_SIZE_PX = 7
    const DOT_HIT_TOLERANCE_PX = 3

    const isReferenceGutterTarget = (event: MonacoEditor.IEditorMouseEvent) => {
      if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS) return false
      const element = event.target.element
      if (!element) return false
      const rect = element.getBoundingClientRect()
      // 用 Range 量出行号数字文本盒，圆心 = 元素左缘与数字左缘的中点，与 CSS 背景居中位置一致。
      const digitRange = document.createRange()
      digitRange.selectNodeContents(element)
      const digitRect = digitRange.getBoundingClientRect()
      if (digitRect.width <= 0) return false
      const centerX = (rect.left + digitRect.left) / 2
      const centerY = rect.top + rect.height / 2
      const radius = DOT_SIZE_PX / 2 + DOT_HIT_TOLERANCE_PX
      const { clientX, clientY } = event.event.browserEvent
      return Math.abs(clientX - centerX) <= radius && Math.abs(clientY - centerY) <= radius
    }

    disposables.push(
      editor.onDidChangeModel(() => {
        dismissPinned()
        syncDecorationsRef.current(referencesByLineRef.current)
      }),
    )

    disposables.push(
      editor.onMouseDown((event) => {
        if (!isReferenceGutterTarget(event)) {
          // 点击编辑器其他区域时收起选择卡片。
          if (pinnedHoverRef.current) dismissPinned()
          return
        }
        const items = findReferencesAtLine(event.target.position?.lineNumber)
        if (items.length <= 0) {
          if (pinnedHoverRef.current) setPinnedHover(null)
          return
        }
        setPinnedHover({
          x: event.event.browserEvent.clientX,
          y: event.event.browserEvent.clientY,
          items,
        })
      }),
    )

    disposables.push(
      editor.onMouseMove((event) => {
        if (isReferenceGutterTarget(event)) {
          const items = findReferencesAtLine(event.target.position?.lineNumber)
          if (items.length <= 0) return
          clearPendingDismiss()
          // 已固定在同一组引用上时不重复 setState，避免定位重算与重渲染。
          const current = pinnedHoverRef.current
          if (current && current.items.length === items.length && current.items[0]?.reference.id === items[0]?.reference.id) return
          setPinnedHover({
            x: event.event.browserEvent.clientX,
            y: event.event.browserEvent.clientY,
            items,
          })
          return
        }
        // 悬浮语义：离开蓝点后进入宽限期，期间移入卡片则保持显示，超时未进入则收起。
        if (pinnedHoverRef.current) scheduleDismiss()
      }),
    )

    disposables.push(
      editor.onDidScrollChange(() => {
        setPinnedHover(null)
      }),
    )

    // 鼠标离开编辑器时没有 mousemove 可依赖，同样进入宽限期收起。
    disposables.push(
      editor.onMouseLeave(() => {
        if (pinnedHoverRef.current) scheduleDismiss()
      }),
    )

    return () => {
      for (const disposable of disposables) {
        disposable.dispose()
      }
      clearPendingDismiss()
      setPinnedHover(null)
    }
  }, [editorInstance, monacoRef, clearPendingDismiss, dismissPinned, scheduleDismiss])

  return {
    hover: pinnedHover,
    syncEditorInstance,
    dismissPinned,
    // 卡片 onMouseEnter 时调用，取消宽限期收起，保持卡片显示。
    holdHover: clearPendingDismiss,
    openReference,
  }
}
