import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MonacoTextViewer } from '../../components/MonacoTextViewer'
import { useI18n } from '../../i18n'
import { middleTruncatePath } from '../../lib/projectDisplay'
import { inferLanguageFromRelativePath } from '../code/code.helpers'

type DrawerState = 'idle' | 'loading' | 'ready' | 'not-found' | 'error'

const DRAWER_TRANSITION_MS = 220

export type SessionFileDrawerTarget = { relativePath: string }

export function SessionFileDrawer({ projectPath, target, onClose }: { projectPath: string; target: SessionFileDrawerTarget | null; onClose: () => void }) {
  const { t } = useI18n()
  const [shouldRender, setShouldRender] = useState(false)
  const [visible, setVisible] = useState(false)
  const [status, setStatus] = useState<DrawerState>('idle')
  const [fileContent, setFileContent] = useState('')
  const [fileLanguage, setFileLanguage] = useState('plaintext')
  const [readError, setReadError] = useState('')
  const viewerRef = useRef<React.ComponentRef<typeof MonacoTextViewer>>(null)

  const relativePath = target?.relativePath ?? ''

  useEffect(() => {
    if (!target) {
      setVisible(false)
      const timer = setTimeout(() => setShouldRender(false), DRAWER_TRANSITION_MS)
      return () => clearTimeout(timer)
    }
    setShouldRender(true)
    const raf = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(raf)
  }, [target])

  useEffect(() => {
    if (!shouldRender || !relativePath) return
    let cancelled = false
    setStatus('loading')
    setReadError('')
    void window.electronAPI
      .readProjectFile(projectPath, relativePath)
      .then((result) => {
        if (cancelled) return
        setFileContent(result.content)
        setFileLanguage(result.language || inferLanguageFromRelativePath(result.relativePath))
        setStatus('ready')
      })
      .catch((error) => {
        if (cancelled) return
        const message = error instanceof Error ? error.message : String(error)
        setReadError(message)
        setStatus(/enoent|no such file|cannot find/i.test(message) ? 'not-found' : 'error')
      })
    return () => {
      cancelled = true
    }
  }, [shouldRender, relativePath, projectPath])

  useEffect(() => {
    if (!target) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [target, onClose])

  if (!shouldRender) return null

  return createPortal(
    <div className="fixed inset-0 overflow-hidden" style={{ zIndex: 1150 }}>
      <button type="button" aria-label={t('common.close')} className={`absolute inset-0 bg-[color:var(--color-background-sunken)]/54 backdrop-blur-[5px] transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`} onClick={onClose} />
      <aside
        className={`absolute inset-y-3 right-3 flex w-[min(980px,calc(100%-1.5rem))] flex-col overflow-hidden rounded-[26px] border border-[color:var(--color-border)] bg-[color:var(--color-popover)]/96 shadow-[0_28px_84px_rgba(15,15,20,0.34)] backdrop-blur-[26px] transition-[transform,opacity] duration-220 ease-out will-change-transform max-[920px]:left-3 max-[920px]:right-3 max-[920px]:w-auto ${
          visible ? 'translate-x-0 opacity-100' : 'translate-x-[32px] opacity-0'
        }`}
      >
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-[color:var(--color-border)]/70 px-5 py-3.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[color:var(--color-foreground)]" title={relativePath}>
              {middleTruncatePath(relativePath)}
            </p>
            <p className="mt-0.5 text-[11px] text-[color:var(--color-muted-foreground)]">{t('agentHistory.fileDrawerSubtitle')}</p>
          </div>
          <button type="button" className="quiet-control flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-0 text-[color:var(--color-muted-foreground)]" onClick={onClose} title={t('common.close')}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 p-3">
          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[18px] border border-[color:var(--color-border)]/70 bg-[color:var(--color-background)]/76">
            {status === 'loading' && <p className="flex flex-1 items-center justify-center text-xs text-[color:var(--color-muted-foreground)]">{t('agentHistory.fileDrawerLoading')}</p>}
            {status === 'not-found' && <p className="flex flex-1 items-center justify-center text-xs text-[color:var(--color-muted-foreground)]">{t('agentHistory.fileDrawerNotFound')}</p>}
            {status === 'error' && <p className="flex flex-1 items-center justify-center px-6 text-center text-xs text-[color:var(--color-muted-foreground)]">{readError || t('agentHistory.fileDrawerError')}</p>}
            {status === 'ready' && <MonacoTextViewer ref={viewerRef} value={fileContent} filePath={relativePath} language={fileLanguage} readOnly focusOnReveal={false} modelNamespace="session-file-drawer" stickyScroll />}
          </div>
        </div>
      </aside>
    </div>,
    document.body,
  )
}
