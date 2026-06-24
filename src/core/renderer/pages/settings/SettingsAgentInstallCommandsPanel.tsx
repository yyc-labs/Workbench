import { Bot, Check, Copy, KeyRound, Terminal, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ModalShell } from '../../components/ModalShell'
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

function renderInlineCode(text: string) {
  return text
    .split(/(`[^`]+`)/g)
    .filter(Boolean)
    .map((segment, index) => {
      if (segment.startsWith('`') && segment.endsWith('`')) {
        return (
          <code
            key={`${segment}-${index}`}
            className="font-mono font-semibold text-[color:var(--color-foreground)]"
          >
            {segment.slice(1, -1)}
          </code>
        )
      }

      return <span key={`${segment}-${index}`}>{segment}</span>
    })
}

function SettingsAgentInstallCommandsPanel() {
  const { t } = useI18n()
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
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
    <>
      <section
        className="rounded-[28px] border px-6 py-6 surface-card"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
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

          <Button type="button" variant="outline" className="self-start md:self-center" onClick={() => setDialogOpen(true)}>
            <Terminal className="h-4 w-4" strokeWidth={1.8} />
            {t('settings.agents.install.openButton')}
          </Button>
        </div>
      </section>

      <ModalShell
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        widthClassName="max-w-[920px]"
        ariaLabel={t('settings.agents.install.dialogTitle')}
        panelClassName="max-h-[calc(100vh-96px)] overflow-hidden p-0"
      >
        <div className="flex max-h-[calc(100vh-96px)] min-h-0 flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-[color:var(--color-border)] px-5 py-4">
            <div className="min-w-0">
              <p className="section-label mb-2">{t('settings.agents.install.kicker')}</p>
              <h3 className="text-base font-semibold text-[color:var(--color-foreground)]">
                {t('settings.agents.install.dialogTitle')}
              </h3>
              <p className="mt-2 text-sm leading-6 text-[color:var(--color-muted-foreground)]">
                {t('settings.agents.install.dialogDescription')}
              </p>
            </div>

            <button
              type="button"
              className="quiet-control inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:text-[color:var(--color-foreground)]"
              onClick={() => setDialogOpen(false)}
              aria-label={t('common.close')}
            >
              <X className="h-4 w-4" strokeWidth={1.8} />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
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
                      {renderInlineCode(t(descriptionKey))}
                    </p>

                    <div className="quiet-control mt-4 rounded-[16px] px-4 py-3 font-mono text-sm text-[color:var(--color-foreground)] break-all">
                      {command}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="border-t border-[color:var(--color-border)] px-5 py-4">
            <p className="text-xs leading-5 text-[color:var(--color-muted-foreground)]">
              {t('settings.agents.install.note')}
            </p>
          </div>
        </div>
      </ModalShell>
    </>
  )
}

export { SettingsAgentInstallCommandsPanel }
