import { AlertTriangle, Loader2, Play } from 'lucide-react'
import { ModalShell } from '../ModalShell'
import { useI18n } from '../../i18n'
import { useAppStore } from '../../stores/appStore'

/**
 * Global prompt shown when a run-task start needs Docker but the daemon is not
 * running. Confirming launches Docker Desktop and waits (up to ~90s) for the
 * daemon; the awaiting start action resumes only after it becomes ready.
 */
export function DockerLaunchPromptDialog() {
  const { t } = useI18n()
  const prompt = useAppStore((s) => s.dockerPrompt)
  const cancelDockerLaunch = useAppStore((s) => s.cancelDockerLaunch)
  const confirmDockerLaunch = useAppStore((s) => s.confirmDockerLaunch)

  if (!prompt) return null

  return (
    <ModalShell open onClose={cancelDockerLaunch} widthClassName="max-w-[460px]" baseZIndex={20100} ariaLabel={t('runTasks.dockerPrompt.title')} panelClassName="max-h-[calc(100vh-140px)] overflow-hidden">
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-warning-background)] text-[color:var(--color-warning)]">
            <AlertTriangle className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-[color:var(--color-foreground)]">{t('runTasks.dockerPrompt.title')}</h2>
            <p className="mt-1 text-xs leading-relaxed text-[color:var(--color-muted-foreground)]">{t('runTasks.dockerPrompt.description')}</p>
          </div>
        </div>

        {prompt.error && <p className="rounded-xl border border-[color:var(--color-destructive)]/25 bg-[color:var(--color-destructive-background)] px-3 py-2 text-xs text-[color:var(--color-destructive)]">{prompt.error}</p>}

        <div className="flex items-center justify-end gap-2">
          <button type="button" className="quiet-control rounded-full px-3 py-1.5 text-xs text-[color:var(--color-foreground)]" onClick={cancelDockerLaunch} disabled={prompt.launching}>
            {t('common.cancel')}
          </button>
          <button type="button" className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-primary-hover disabled:opacity-60" onClick={() => void confirmDockerLaunch()} disabled={prompt.launching}>
            {prompt.launching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            {prompt.launching ? t('runTasks.dockerPrompt.launching') : t('runTasks.dockerPrompt.confirm')}
          </button>
        </div>
      </div>
    </ModalShell>
  )
}
