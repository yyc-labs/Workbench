import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type MouseEvent, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Editor, EditorStatus, commandsCtx, defaultValueCtx, editorStateCtx, editorViewCtx, editorViewOptionsCtx, rootCtx, serializerCtx } from '@milkdown/core'
import { history } from '@milkdown/plugin-history'
import { listener, listenerCtx } from '@milkdown/plugin-listener'
import { $view } from '@milkdown/utils'
import { commonmark, imageSchema } from '@milkdown/preset-commonmark'
import { addColAfterCommand, addColBeforeCommand, addRowAfterCommand, addRowBeforeCommand, gfm, selectColCommand, selectRowCommand } from '@milkdown/preset-gfm'
import { Plus } from 'lucide-react'
import { ModalShell } from '../../components/ModalShell'
import { Button } from '../../components/ui/button'
import { useI18n } from '../../i18n'
import type { MarkdownDocumentCompatibility, MarkdownDocumentComplexity } from './markdownDocumentTypes'
import { classifyMarkdownDocumentCompatibility, classifyMarkdownDocumentComplexity } from './markdownDocumentCapabilities'
import { getMarkdownDocumentSelectionContext, runMarkdownDocumentCommand } from './markdownDocumentCommands'

type TableInsertHandle = {
  axis: 'row' | 'column'
  index: number
  table: HTMLTableElement
  cell: HTMLTableCellElement
  left: number
  top: number
  width: number
  height: number
  buttonLeft: number
  buttonTop: number
}

type PasteImageChoice = 'reference-original' | 'save-as' | 'cancel'

type PasteImageChoiceRequest = {
  hasLocalPath: boolean
  resolve: (choice: PasteImageChoice) => void
}

type ClipboardImagePayload = {
  file: File | null
  localPath: string | null
  dataBase64: string | null
  extension: string
  suggestedName: string
}

type MarkdownDocumentRichEditorProps = {
  initialMarkdown: string
  documentPath: string
  onEditorChange: (editor: Editor | null) => void
  onMarkdownChange: (markdown: string) => void
  onContextMenu: (event: MouseEvent<HTMLDivElement>, editor: Editor, selectionContext: ReturnType<typeof getMarkdownDocumentSelectionContext>) => void
  onDocumentProfileChange: (profile: { compatibility: MarkdownDocumentCompatibility; complexity: MarkdownDocumentComplexity }) => void
  onFlushReady: (flush: (() => string | null) | null) => void
}

const markdownDocumentImageView = $view(imageSchema.node, () => (node) => {
  const image = document.createElement('img')
  image.alt = String(node.attrs.alt ?? '')
  image.title = String(node.attrs.title ?? '')
  image.draggable = true

  let currentSrc = ''
  let generation = 0

  const render = (source: string) => {
    currentSrc = source
    generation += 1
    const currentGeneration = generation

    if (isLocalImageSource(source)) {
      image.removeAttribute('src')
      void window.electronAPI
        .readLocalImageAsDataUrl(source)
        .then((dataUrl) => {
          if (generation !== currentGeneration) return
          image.src = dataUrl
        })
        .catch(() => {
          if (generation !== currentGeneration) return
          image.removeAttribute('src')
        })
      return
    }

    image.src = source
  }

  render(String(node.attrs.src ?? ''))

  return {
    dom: image,
    update: (nextNode) => {
      if (nextNode.type !== node.type) return false
      image.alt = String(nextNode.attrs.alt ?? '')
      image.title = String(nextNode.attrs.title ?? '')
      const nextSrc = String(nextNode.attrs.src ?? '')
      if (nextSrc !== currentSrc) render(nextSrc)
      return true
    },
    ignoreMutation: () => true,
  }
})

export function MarkdownDocumentRichEditor({ initialMarkdown, documentPath, onEditorChange, onMarkdownChange, onContextMenu, onDocumentProfileChange, onFlushReady }: MarkdownDocumentRichEditorProps) {
  const { t } = useI18n()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<Editor | null>(null)
  const markdownChangeRef = useRef(onMarkdownChange)
  const profileChangeRef = useRef(onDocumentProfileChange)
  const contextMenuRef = useRef(onContextMenu)
  const editorChangeRef = useRef(onEditorChange)
  const flushReadyRef = useRef(onFlushReady)
  const tableInsertHideTimerRef = useRef<number | null>(null)
  const [tableInsertHandle, setTableInsertHandle] = useState<TableInsertHandle | null>(null)
  const [pasteImageChoiceRequest, setPasteImageChoiceRequest] = useState<PasteImageChoiceRequest | null>(null)

  markdownChangeRef.current = onMarkdownChange
  profileChangeRef.current = onDocumentProfileChange
  contextMenuRef.current = onContextMenu
  editorChangeRef.current = onEditorChange
  flushReadyRef.current = onFlushReady

  const initialProfile = useMemo(() => {
    return {
      compatibility: classifyMarkdownDocumentCompatibility(initialMarkdown),
      complexity: classifyMarkdownDocumentComplexity(initialMarkdown),
    }
  }, [initialMarkdown])

  useEffect(() => {
    profileChangeRef.current(initialProfile)
  }, [initialProfile])

  useEffect(() => {
    return () => {
      if (tableInsertHideTimerRef.current !== null) window.clearTimeout(tableInsertHideTimerRef.current)
    }
  }, [])

  const requestPasteImageChoice = useCallback((hasLocalPath: boolean) => {
    return new Promise<PasteImageChoice>((resolve) => {
      setPasteImageChoiceRequest({
        hasLocalPath,
        resolve: (choice) => {
          setPasteImageChoiceRequest(null)
          resolve(choice)
        },
      })
    })
  }, [])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    let disposed = false
    const editor = Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root)
        ctx.set(defaultValueCtx, initialMarkdown)
        ctx.update(editorViewOptionsCtx, (options) => {
          const previousAttributes = options.attributes
          return {
            ...options,
            attributes: (state) => {
              const attributes = typeof previousAttributes === 'function' ? previousAttributes(state) : previousAttributes
              return {
                ...attributes,
                class: [attributes?.class, 'code-markdown-content', 'markdown-document-rich-editor'].filter(Boolean).join(' '),
              }
            },
          }
        })
      })
      .use(commonmark)
      .use(markdownDocumentImageView)
      .use(gfm)
      .use(history)
      .use(listener)

    editorRef.current = editor

    const mountEditor = async () => {
      const instance = await editor.create()
      if (disposed) {
        await instance.destroy()
        return
      }

      instance.action((ctx) => {
        const listeners = ctx.get(listenerCtx)
        listeners.markdownUpdated((_ctx, nextMarkdown) => {
          markdownChangeRef.current(nextMarkdown)
        })
      })

      flushReadyRef.current(() => {
        return instance.action((ctx) => {
          const serializer = ctx.get(serializerCtx)
          const state = ctx.get(editorStateCtx)
          return serializer(state.doc)
        })
      })
      editorChangeRef.current(instance)
    }

    void mountEditor().catch(() => {
      if (!disposed) editorChangeRef.current(null)
    })

    return () => {
      disposed = true
      editorChangeRef.current(null)
      flushReadyRef.current(null)
      void editor.destroy()
      editorRef.current = null
    }
  }, [documentPath, initialMarkdown])

  const cancelTableInsertHide = () => {
    if (tableInsertHideTimerRef.current === null) return
    window.clearTimeout(tableInsertHideTimerRef.current)
    tableInsertHideTimerRef.current = null
  }

  const scheduleTableInsertHide = () => {
    cancelTableInsertHide()
    tableInsertHideTimerRef.current = window.setTimeout(() => {
      tableInsertHideTimerRef.current = null
      setTableInsertHandle(null)
    }, 120)
  }

  const updateTableInsertHandle = (event: PointerEvent<HTMLDivElement>) => {
    cancelTableInsertHide()
    const cell = event.target instanceof Element ? event.target.closest('td, th') : null
    if (!(cell instanceof HTMLTableCellElement)) {
      setTableInsertHandle(null)
      return
    }

    const table = cell.closest('table')
    const row = cell.parentElement
    if (!(table instanceof HTMLTableElement) || !(row instanceof HTMLTableRowElement)) {
      setTableInsertHandle(null)
      return
    }

    const cellRect = cell.getBoundingClientRect()
    const tableRect = table.getBoundingClientRect()
    const rowIndex = Array.from(table.rows).indexOf(row)
    const columnIndex = Array.from(row.cells).indexOf(cell)
    const nearestVerticalDistance = Math.min(Math.abs(event.clientY - cellRect.top), Math.abs(cellRect.bottom - event.clientY))
    const nearestHorizontalDistance = Math.min(Math.abs(event.clientX - cellRect.left), Math.abs(cellRect.right - event.clientX))
    const boundaryDistance = 10

    if (Math.min(nearestVerticalDistance, nearestHorizontalDistance) > boundaryDistance || rowIndex < 0 || columnIndex < 0) {
      setTableInsertHandle(null)
      return
    }

    if (nearestVerticalDistance <= nearestHorizontalDistance) {
      if (rowIndex === 0) {
        setTableInsertHandle(null)
        return
      }
      const insertAfter = cellRect.bottom - event.clientY < event.clientY - cellRect.top
      const nextHandle: TableInsertHandle = {
        axis: 'row',
        index: rowIndex + (insertAfter ? 1 : 0),
        table,
        cell,
        left: tableRect.left,
        top: insertAfter ? cellRect.bottom : cellRect.top,
        width: tableRect.width,
        height: 1,
        buttonLeft: Math.min(Math.max(tableRect.left + 14, event.clientX + 14), tableRect.right - 14),
        buttonTop: insertAfter ? cellRect.bottom : cellRect.top,
      }
      setTableInsertHandle((current) => (current?.axis === nextHandle.axis && current.index === nextHandle.index && current.table === nextHandle.table ? current : nextHandle))
      return
    }

    const insertAfter = cellRect.right - event.clientX < event.clientX - cellRect.left
    const nextHandle: TableInsertHandle = {
      axis: 'column',
      index: columnIndex + (insertAfter ? 1 : 0),
      table,
      cell,
      left: insertAfter ? cellRect.right : cellRect.left,
      top: tableRect.top,
      width: 1,
      height: tableRect.height,
      buttonLeft: insertAfter ? cellRect.right : cellRect.left,
      buttonTop: Math.min(Math.max(tableRect.top + 14, event.clientY + 14), tableRect.bottom - 14),
    }
    setTableInsertHandle((current) => (current?.axis === nextHandle.axis && current.index === nextHandle.index && current.table === nextHandle.table ? current : nextHandle))
  }

  const insertTableLine = (handle: TableInsertHandle) => {
    const editor = editorRef.current
    if (!editor || editor.status !== EditorStatus.Created) return

    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const commands = ctx.get(commandsCtx)
      const position = view.posAtDOM(handle.cell, 0)
      if (handle.axis === 'row') {
        if (handle.index === 0) {
          commands.call(selectRowCommand.key, { index: 0, pos: position })
          return commands.call(addRowBeforeCommand.key)
        }
        commands.call(selectRowCommand.key, { index: handle.index - 1, pos: position })
        return commands.call(addRowAfterCommand.key)
      }

      if (handle.index === 0) {
        commands.call(selectColCommand.key, { index: 0, pos: position })
        return commands.call(addColBeforeCommand.key)
      }
      commands.call(selectColCommand.key, { index: handle.index - 1, pos: position })
      return commands.call(addColAfterCommand.key)
    })
    setTableInsertHandle(null)
  }

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const editor = editorRef.current
    if (!editor || editor.status !== EditorStatus.Created) return

    const payload = readClipboardImagePayload(event.clipboardData)
    if (!payload) return

    event.preventDefault()
    event.stopPropagation()

    void (async () => {
      let imagePath = payload.localPath
      if (!imagePath) {
        const choice = await requestPasteImageChoice(false)
        if (choice === 'cancel') return
        const dataBase64 = payload.dataBase64 ?? (payload.file ? await readFileAsBase64(payload.file) : null)
        if (!dataBase64) return
        const saved = await window.electronAPI.saveMarkdownDocumentPastedImageAs(dataBase64, payload.extension, payload.suggestedName)
        if (!saved) return
        imagePath = saved.path
      }

      if (!imagePath) return
      const source = toMarkdownLocalImagePath(imagePath)
      runMarkdownDocumentCommand(editor, {
        id: 'insert-image',
        payload: {
          src: source,
          alt: getImageAltFromPath(imagePath),
        },
      })
    })()
  }

  return (
    <>
      <div
        ref={rootRef}
        className="markdown-document-rich-root h-full min-h-0 w-full overflow-auto"
        onPointerMove={updateTableInsertHandle}
        onPointerLeave={scheduleTableInsertHide}
        onScroll={() => setTableInsertHandle(null)}
        onPaste={handlePaste}
        onContextMenu={(event) => {
          const editor = editorRef.current
          if (!editor || editor.status !== EditorStatus.Created) return
          const selectionContext = editor.action((ctx) => getMarkdownDocumentSelectionContext(ctx.get(editorViewCtx).state))
          contextMenuRef.current(event, editor, selectionContext)
        }}
      />
      {tableInsertHandle
        ? createPortal(
            <div
              className={`markdown-document-table-insert markdown-document-table-insert--${tableInsertHandle.axis}`}
              style={{ left: tableInsertHandle.left, top: tableInsertHandle.top, width: tableInsertHandle.width, height: tableInsertHandle.height }}
              onPointerEnter={cancelTableInsertHide}
              onPointerLeave={scheduleTableInsertHide}
            >
              <button
                type="button"
                aria-label={t(tableInsertHandle.axis === 'row' ? 'markdownDocument.insertRow' : 'markdownDocument.insertColumn')}
                style={{ left: tableInsertHandle.buttonLeft - tableInsertHandle.left, top: tableInsertHandle.buttonTop - tableInsertHandle.top }}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insertTableLine(tableInsertHandle)}
              >
                <Plus aria-hidden="true" />
              </button>
            </div>,
            document.body,
          )
        : null}
      <MarkdownPasteImageChoiceDialog request={pasteImageChoiceRequest} onClose={() => pasteImageChoiceRequest?.resolve('cancel')} onReferenceOriginal={() => pasteImageChoiceRequest?.resolve('reference-original')} onSaveAs={() => pasteImageChoiceRequest?.resolve('save-as')} />
    </>
  )
}

function readClipboardImagePayload(clipboardData: DataTransfer): ClipboardImagePayload | null {
  const file = findClipboardImageFile(clipboardData)
  if (file) {
    const localPath = window.electronAPI.getPathForFile(file) || null
    return {
      file,
      localPath,
      dataBase64: null,
      extension: normalizeImageExtensionFromFile(file, localPath),
      suggestedName: getSuggestedImageName(file.name, file.type),
    }
  }

  const pngBase64 = window.electronAPI.readClipboardImagePngBase64()
  if (!pngBase64) return null
  return {
    file: null,
    localPath: null,
    dataBase64: pngBase64,
    extension: 'png',
    suggestedName: `pasted-image-${Date.now()}.png`,
  }
}

function findClipboardImageFile(clipboardData: DataTransfer): File | null {
  for (const file of Array.from(clipboardData.files)) {
    if (isImageFileCandidate(file)) return file
  }

  for (const item of Array.from(clipboardData.items)) {
    if (!item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (file) return file
  }

  return null
}

function isImageFileCandidate(file: File): boolean {
  if (file.type.startsWith('image/')) return true
  return /\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name)
}

function normalizeImageExtensionFromPath(filePath: string): string | null {
  const match = /\.([A-Za-z0-9]+)$/.exec(filePath)
  if (!match) return null
  const extension = match[1]?.toLowerCase()
  if (extension === 'jpeg') return 'jpg'
  if (extension === 'png' || extension === 'jpg' || extension === 'gif' || extension === 'webp' || extension === 'bmp') return extension
  return null
}

function normalizeImageExtensionFromMime(mimeType: string): string {
  const normalized = mimeType.trim().toLowerCase()
  if (normalized === 'image/jpeg') return 'jpg'
  if (normalized === 'image/png') return 'png'
  if (normalized === 'image/gif') return 'gif'
  if (normalized === 'image/webp') return 'webp'
  if (normalized === 'image/bmp') return 'bmp'
  return 'png'
}

function normalizeImageExtensionFromFile(file: File, localPath: string | null): string {
  return normalizeImageExtensionFromPath(localPath ?? '') ?? normalizeImageExtensionFromPath(file.name) ?? normalizeImageExtensionFromMime(file.type)
}

function getSuggestedImageName(fileName: string, mimeType: string): string {
  const extension = normalizeImageExtensionFromPath(fileName) ?? normalizeImageExtensionFromMime(mimeType)
  const trimmed = fileName.trim()
  if (!trimmed) return `pasted-image-${Date.now()}.${extension}`
  return /\.[A-Za-z0-9]+$/.test(trimmed) ? trimmed : `${trimmed}.${extension}`
}

async function readFileAsBase64(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer()
  const bytes = new Uint8Array(arrayBuffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

function toMarkdownLocalImagePath(filePath: string): string {
  return encodeURI(filePath.replace(/\\/g, '/')).replace(/#/g, '%23').replace(/\?/g, '%3F').replace(/\(/g, '%28').replace(/\)/g, '%29')
}

function isLocalImageSource(source: string): boolean {
  const value = source.trim().toLowerCase()
  return value.startsWith('ide-local-image:') || value.startsWith('file://') || /^[a-z]:[\\/]/.test(value)
}

function getImageAltFromPath(filePath: string): string {
  const fileName = filePath.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? 'image'
  const withoutExtension = fileName.replace(/\.[A-Za-z0-9]+$/, '')
  const safe = withoutExtension.replace(/[\[\]\r\n]+/g, ' ').trim()
  return safe || 'image'
}

function MarkdownPasteImageChoiceDialog({ request, onClose, onReferenceOriginal, onSaveAs }: { request: PasteImageChoiceRequest | null; onClose: () => void; onReferenceOriginal: () => void; onSaveAs: () => void }) {
  const { t } = useI18n()

  return (
    <ModalShell open={Boolean(request)} onClose={onClose} widthClassName="max-w-[520px]" ariaLabel={t('markdownDocument.pasteImageTitle')}>
      <div className="space-y-4">
        <div>
          <h3 className="text-base font-semibold text-[color:var(--color-foreground)]">{t('markdownDocument.pasteImageTitle')}</h3>
          <p className="mt-1 text-sm leading-6 text-[color:var(--color-muted-foreground)]">{t(request?.hasLocalPath ? 'markdownDocument.pasteImageLocalDescription' : 'markdownDocument.pasteImageClipboardDescription')}</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" className="h-10 px-4" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          {request?.hasLocalPath ? (
            <Button type="button" variant="outline" className="h-10 px-4" onClick={onSaveAs}>
              {t('markdownDocument.pasteImageSaveAs')}
            </Button>
          ) : null}
          <Button type="button" className="h-10 px-4" onClick={request?.hasLocalPath ? onReferenceOriginal : onSaveAs}>
            {request?.hasLocalPath ? t('markdownDocument.pasteImageReferenceOriginal') : t('markdownDocument.pasteImageSaveAs')}
          </Button>
        </div>
      </div>
    </ModalShell>
  )
}
