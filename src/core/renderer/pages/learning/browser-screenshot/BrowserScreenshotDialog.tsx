import { Camera, Check, Clipboard, Download, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { BrowserScreenshotCaptureMode, BrowserScreenshotFixedElementPolicy, BrowserScreenshotProgress, BrowserScreenshotResult, BrowserScreenshotTarget } from '../../../../shared/types'
import { Button } from '../../../components/ui/button'
import { ModalShell } from '../../../components/ModalShell'
import { Select } from '../../../components/ui/select'
import { useI18n } from '../../../i18n'

type Props = { open: boolean; onClose: () => void }

export function BrowserScreenshotDialog({ open, onClose }: Props) {
  const { t } = useI18n()
  const [targets, setTargets] = useState<BrowserScreenshotTarget[]>([])
  const [targetId, setTargetId] = useState('')
  const [policy, setPolicy] = useState<BrowserScreenshotFixedElementPolicy>('keep')
  const [captureMode, setCaptureMode] = useState<BrowserScreenshotCaptureMode>('standard')
  const [progress, setProgress] = useState<BrowserScreenshotProgress | null>(null)
  const [result, setResult] = useState<BrowserScreenshotResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copying, setCopying] = useState(false)
  const [saving, setSaving] = useState(false)
  const [actionFeedback, setActionFeedback] = useState<'copied' | 'saved' | null>(null)
  const feedbackTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (!open) return
    setResult(null)
    setProgress(null)
    setError(null)
    setActionFeedback(null)
    void window.electronAPI
      .listBrowserScreenshotTargets()
      .then((nextTargets) => {
        setTargets(nextTargets)
        setTargetId(nextTargets.find((target) => target.isActiveCandidate)?.id ?? nextTargets[0]?.id ?? '')
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : t('learning.browserScreenshot.loadFailed')))
    const unsubscribeTargets = window.electronAPI.onBrowserScreenshotTargetsChanged((nextTargets) => {
      setTargets(nextTargets)
      setTargetId((currentTargetId) => {
        if (nextTargets.some((target) => target.id === currentTargetId)) return currentTargetId
        return nextTargets.find((target) => target.isActiveCandidate)?.id ?? nextTargets[0]?.id ?? ''
      })
    })
    const unsubscribeProgress = window.electronAPI.onBrowserScreenshotProgress((nextProgress) => setProgress(nextProgress))
    return () => {
      unsubscribeTargets()
      unsubscribeProgress()
    }
  }, [open, t])

  useEffect(
    () => () => {
      if (feedbackTimerRef.current !== null) window.clearTimeout(feedbackTimerRef.current)
    },
    [],
  )

  const isRunning = progress?.taskId && !['completed', 'failed', 'cancelled'].includes(progress.stage)
  const targetOptions = useMemo(() => targets.map((target) => ({ value: target.id, label: target.title === target.url ? target.url : `${target.title} · ${target.url}` })), [targets])
  const previewUrl = result?.pngBase64 ? `data:image/png;base64,${result.pngBase64}` : ''

  const handleStart = async () => {
    if (!targetId) return
    setLoading(true)
    setError(null)
    setResult(null)
    setActionFeedback(null)
    try {
      const nextResult = await window.electronAPI.startBrowserScreenshot({ targetId, captureMode, fixedElementPolicy: policy })
      setResult(nextResult)
      if (nextResult.status !== 'completed') setError(nextResult.errorMessage ?? t('learning.browserScreenshot.failed'))
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : t('learning.browserScreenshot.failed'))
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = async () => {
    if (!result?.pngBase64) return
    setCopying(true)
    setError(null)
    try {
      const copied = await window.electronAPI.writeClipboardImagePngBase64(result.pngBase64)
      if (!copied) {
        setError(t('learning.browserScreenshot.copyFailed'))
        return
      }
      setActionFeedback('copied')
      if (feedbackTimerRef.current !== null) window.clearTimeout(feedbackTimerRef.current)
      feedbackTimerRef.current = window.setTimeout(() => setActionFeedback(null), 2200)
    } finally {
      setCopying(false)
    }
  }

  const handleSave = async () => {
    if (!result?.pngBase64) return
    setSaving(true)
    setError(null)
    try {
      const saved = await window.electronAPI.saveBrowserScreenshot(result.pngBase64, `${(result.title || 'browser-page').replace(/[\\/:*?"<>|]+/g, '_')}-screenshot.png`)
      if (!saved) return
      setActionFeedback('saved')
      if (feedbackTimerRef.current !== null) window.clearTimeout(feedbackTimerRef.current)
      feedbackTimerRef.current = window.setTimeout(() => setActionFeedback(null), 2200)
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell open={open} onClose={onClose} widthClassName="max-w-4xl" panelClassName="!p-0 flex max-h-[calc(100vh-3rem)] flex-col overflow-hidden" ariaLabel={t('learning.browserScreenshot.title')}>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-start justify-between gap-4 border-b p-5" style={{ borderColor: 'var(--color-border)' }}>
          <div>
            <p className="section-label mb-2">{t('learning.browserScreenshot.kicker')}</p>
            <h2 className="text-lg font-semibold text-[color:var(--color-foreground)]">{t('learning.browserScreenshot.title')}</h2>
            <p className="mt-1 text-xs leading-5 text-[color:var(--color-muted-foreground)]">{t('learning.browserScreenshot.description')}</p>
          </div>
          <Button variant="ghost" size="icon" title={t('common.close')} onClick={onClose}>
            <X />
          </Button>
        </div>
        <div className="min-h-0 space-y-4 overflow-y-auto p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Select ariaLabel={t('learning.browserScreenshot.target')} value={targetId} options={targetOptions} onChange={setTargetId} emptyText={t('learning.browserScreenshot.noTargets')} />
            <Select
              ariaLabel={t('learning.browserScreenshot.fixedPolicy')}
              value={policy}
              options={[
                { value: 'keep', label: t('learning.browserScreenshot.keepFixed') },
                { value: 'hide', label: t('learning.browserScreenshot.hideFixed') },
              ]}
              onChange={(value) => setPolicy(value as BrowserScreenshotFixedElementPolicy)}
            />
            <Select
              ariaLabel={t('learning.browserScreenshot.captureMode')}
              value={captureMode}
              options={[
                { value: 'standard', label: t('learning.browserScreenshot.standardMode') },
                { value: 'precise', label: t('learning.browserScreenshot.preciseMode') },
              ]}
              onChange={(value) => setCaptureMode(value as BrowserScreenshotCaptureMode)}
            />
          </div>
          {progress ? (
            <div className={`rounded-[12px] bg-[color:var(--color-accent)] px-3 py-2 text-xs text-[color:var(--color-foreground)] ${isRunning ? 'animate-pulse' : ''}`}>
              {progress.message ?? t('learning.browserScreenshot.running')}
              {typeof progress.percent === 'number' ? ` · ${progress.percent}%` : ''}
            </div>
          ) : null}
          {actionFeedback ? (
            <div className="flex items-center gap-2 rounded-[12px] border border-[color:var(--color-primary)]/25 bg-[color:var(--color-primary)]/10 px-3 py-2 text-sm text-[color:var(--color-foreground)] animate-pulse" role="status">
              <Check className="text-[color:var(--color-primary)]" />
              {actionFeedback === 'copied' ? t('learning.browserScreenshot.copySuccess') : t('learning.browserScreenshot.saveSuccess')}
            </div>
          ) : null}
          {error ? <p className="text-sm text-[color:var(--color-destructive)]">{error}</p> : null}
          {previewUrl ? (
            <div className="overflow-auto rounded-[12px] border p-2" style={{ borderColor: 'var(--color-border)' }}>
              <img src={previewUrl} alt={t('learning.browserScreenshot.preview')} className="mx-auto h-auto max-w-full" />
            </div>
          ) : null}
          {result?.status === 'completed' ? <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('learning.browserScreenshot.completed', { value: `${result.width ?? 0} × ${result.height ?? 0}` })}</p> : null}
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t p-4" style={{ borderColor: 'var(--color-border)' }}>
          <Button variant="ghost" onClick={onClose}>
            {t('common.close')}
          </Button>
          {result?.status === 'completed' ? (
            <Button variant={actionFeedback === 'copied' ? 'default' : 'outline'} onClick={() => void handleCopy()} loading={copying} disabled={saving}>
              {actionFeedback === 'copied' ? <Check /> : <Clipboard />}
              {actionFeedback === 'copied' ? t('learning.browserScreenshot.copySuccess') : t('learning.browserScreenshot.copy')}
            </Button>
          ) : null}
          {result?.status === 'completed' ? (
            <Button variant={actionFeedback === 'saved' ? 'default' : 'outline'} onClick={() => void handleSave()} loading={saving} disabled={copying}>
              <Download />
              {actionFeedback === 'saved' ? t('learning.browserScreenshot.saveSuccess') : t('learning.browserScreenshot.save')}
            </Button>
          ) : null}
          {isRunning ? (
            <Button variant="outline" onClick={() => void window.electronAPI.cancelBrowserScreenshot(progress!.taskId)}>
              {t('learning.browserScreenshot.cancel')}
            </Button>
          ) : null}
          <Button onClick={() => void handleStart()} loading={loading} disabled={!targetId || Boolean(isRunning)}>
            <Camera />
            {t('learning.browserScreenshot.start')}
          </Button>
        </div>
      </div>
    </ModalShell>
  )
}
