import { useCallback, useEffect, useRef, useState } from 'react'
import { FolderPlus } from 'lucide-react'
import { useI18n } from '../i18n'
import { useAppStore } from '../stores/appStore'

function GlobalProjectDropListener() {
  const { t } = useI18n()
  const addProject = useAppStore((state) => state.addProject)
  const [isDragOver, setIsDragOver] = useState(false)
  const isDragOverRef = useRef(false)
  const dragHeartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastDragOverAtRef = useRef(0)

  const setDragOverlay = useCallback((next: boolean) => {
    if (isDragOverRef.current === next) return
    isDragOverRef.current = next
    setIsDragOver(next)
  }, [])

  const stopDragTracking = useCallback(() => {
    if (dragHeartbeatRef.current) {
      clearInterval(dragHeartbeatRef.current)
      dragHeartbeatRef.current = null
    }
    setDragOverlay(false)
  }, [setDragOverlay])

  useEffect(() => {
    const onDragOver = (event: DragEvent) => {
      let hasFiles = isDragOverRef.current
      if (!hasFiles) {
        const types = event.dataTransfer?.types
        hasFiles = Boolean(types && (types.includes('Files') || (types as unknown as { contains?: (value: string) => boolean }).contains?.('Files')))
      }
      if (!hasFiles) return

      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
      setDragOverlay(true)
      lastDragOverAtRef.current = performance.now()

      if (!dragHeartbeatRef.current) {
        dragHeartbeatRef.current = setInterval(() => {
          if (performance.now() - lastDragOverAtRef.current > 180) {
            stopDragTracking()
          }
        }, 120)
      }
    }

    const onDrop = async (event: DragEvent) => {
      event.preventDefault()
      stopDragTracking()
      const files = event.dataTransfer?.files
      if (!files || files.length === 0) return

      const api = window.electronAPI
      const getPathForFile = typeof api.getPathForFile === 'function' ? api.getPathForFile : undefined
      const paths = new Set<string>()

      for (const file of files) {
        const fileWithPath = file as File & { path?: string }
        const path = (getPathForFile?.(fileWithPath) || fileWithPath.path || '').trim()
        if (path) paths.add(path)
      }

      for (const path of paths) {
        try {
          await addProject(path)
        } catch (error) {
          console.error('[GlobalProjectDropListener] drop addProject failed:', path, error)
        }
      }
    }

    document.addEventListener('dragover', onDragOver)
    document.addEventListener('drop', onDrop)
    window.addEventListener('blur', stopDragTracking)
    return () => {
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('drop', onDrop)
      window.removeEventListener('blur', stopDragTracking)
      stopDragTracking()
    }
  }, [addProject, setDragOverlay, stopDragTracking])

  if (!isDragOver) return null

  return (
    <div
      className="fixed inset-0 z-[10001] flex items-center justify-center drag-overlay-border border-4 border-dashed rounded-none"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--color-primary) 10%, transparent)',
        borderColor: 'color-mix(in srgb, var(--color-primary) 28%, transparent)',
      }}
    >
      <div className="text-center">
        <div className="quiet-control w-20 h-20 mx-auto mb-6 rounded-[28px] flex items-center justify-center" style={{ color: 'var(--color-primary)' }}>
          <FolderPlus className="w-9 h-9" strokeWidth={1.5} />
        </div>
        <p className="text-xl font-medium text-[color:var(--color-foreground)]">{t('home.dragTitle')}</p>
        <p className="mt-2 text-sm text-[color:var(--color-muted-foreground)]">{t('home.dragDescription')}</p>
      </div>
    </div>
  )
}

export { GlobalProjectDropListener }
