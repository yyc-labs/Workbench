import { AlertTriangle, Play } from 'lucide-react'
import { ModalShell } from '../ModalShell'
import { useI18n } from '../../i18n'
import { useAppStore } from '../../stores/appStore'

/**
 * Global prompt shown when a run-task start needs Docker but the daemon is not
 * running. Confirming closes the prompt immediately and launches Docker
 * Desktop in the background; the awaiting start action resumes once the
 * daemon becomes ready.
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

        <div className="flex items-center justify-end gap-2">
          <button type="button" className="quiet-control rounded-full px-3 py-1.5 text-xs text-[color:var(--color-foreground)]" onClick={cancelDockerLaunch}>
            {t('common.cancel')}
          </button>
          <button type="button" className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-primary-hover" onClick={() => void confirmDockerLaunch()}>
            <Play className="h-3.5 w-3.5" />
            {t('runTasks.dockerPrompt.confirm')}
          </button>
        </div>
      </div>
    </ModalShell>
  )
}
