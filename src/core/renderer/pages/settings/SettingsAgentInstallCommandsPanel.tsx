import { Bot, Check, Copy, KeyRound, Terminal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/ui/button'
import { useI18n } from '../../i18n'
import { copyTextToClipboard } from '../code/code.clipboard'

const INSTALL_COMMANDS = [
  {
    key: 'claudeCode',
    titleKey: 'settings.agents.install.claudeCodeTitle',
    descriptionKey: 'settings.agents.install.claudeCodeDescription',
    packageName: '@anthropic-ai/claude-code',
    command: 'npm install -g @anthropic-ai/claude-code',
    Icon: Bot,
  },
  {
    key: 'codex',
    titleKey: 'settings.agents.install.codexTitle',
    descriptionKey: 'settings.agents.install.codexDescription',
    packageName: '@openai/codex',
    command: 'npm install -g @openai/codex',
    Icon: KeyRound,
  },
] as const

function SettingsAgentInstallCommandsPanel() {
  const { t } = useI18n()
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const copiedTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current)
      }
    }
  }, [])

  const handleCopy = async (key: string, command: string) => {
    const copied = await copyTextToClipboard(command)
    if (!copied) return

    if (copiedTimerRef.current !== null) {
      window.clearTimeout(copiedTimerRef.current)
    }

    setCopiedKey(key)
    copiedTimerRef.current = window.setTimeout(() => {
      setCopiedKey(null)
      copiedTimerRef.current = null
    }, 1600)
  }

  return (
    <section
      className="rounded-[28px] border px-6 py-6 surface-card space-y-5"
      style={{ borderColor: 'var(--color-border)' }}
    >
      <div className="flex items-start gap-4">
        <div className="quiet-control flex h-12 w-12 shrink-0 items-center justify-center rounded-[20px] text-primary">
          <Terminal className="h-5 w-5" strokeWidth={1.8} />
        </div>
        <div>
          <p className="section-label mb-2">{t('settings.agents.install.kicker')}</p>
          <h3 className="text-base font-semibold text-[color:var(--color-foreground)]">
            {t('settings.agents.install.title')}
          </h3>
          <p className="mt-2 text-sm leading-6 text-[color:var(--color-muted-foreground)]">
            {t('settings.agents.install.description')}
          </p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {INSTALL_COMMANDS.map(({ key, titleKey, descriptionKey, packageName, command, Icon }) => {
          const isCopied = copiedKey === key
          return (
            <div
              key={key}
              className="rounded-[22px] bg-[color:var(--color-card)] px-5 py-5"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.8} />
                    <p className="text-sm font-medium text-[color:var(--color-foreground)]">
                      {t(titleKey)}
                    </p>
                  </div>
                  <p className="mt-2 font-mono text-xs text-[color:var(--color-muted-foreground)] break-all">
                    {packageName}
                  </p>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => void handleCopy(key, command)}
                >
                  {isCopied ? <Check className="h-4 w-4" strokeWidth={1.8} /> : <Copy className="h-4 w-4" strokeWidth={1.8} />}
                  {isCopied ? t('common.copied') : t('common.copy')}
                </Button>
              </div>

              <p className="mt-4 text-sm leading-6 text-[color:var(--color-muted-foreground)]">
                {t(descriptionKey)}
              </p>

              <div className="quiet-control mt-4 rounded-[16px] px-4 py-3 font-mono text-sm text-[color:var(--color-foreground)] break-all">
                {command}
              </div>
            </div>
          )
        })}
      </div>

      <p className="text-xs leading-5 text-[color:var(--color-muted-foreground)]">
        {t('settings.agents.install.note')}
      </p>
    </section>
  )
}

export { SettingsAgentInstallCommandsPanel }
