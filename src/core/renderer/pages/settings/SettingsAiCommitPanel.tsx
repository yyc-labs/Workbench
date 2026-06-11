import { useEffect, useState } from 'react'
import type { AiCommitConfig } from '../../../shared/types'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { useI18n } from '../../i18n'
import { clampMaxBullets, clampSplitMaxBatches } from './settings.helpers'

type AiCommitPanelProps = {
  aiCommit: AiCommitConfig
  onSave: (value: AiCommitConfig) => Promise<void>
}

function SettingsAiCommitPanel({ aiCommit, onSave }: AiCommitPanelProps) {
  const { t } = useI18n()
  const [enabled, setEnabled] = useState(Boolean(aiCommit.enabled ?? true))
  const [apiBaseUrl, setApiBaseUrl] = useState(aiCommit.apiBaseUrl || 'https://api.openai.com/v1')
  const [apiKey, setApiKey] = useState(aiCommit.apiKey || '')
  const [model, setModel] = useState(aiCommit.model || 'gpt-4o-mini')
  const [wslPwshPath, setWslPwshPath] = useState(aiCommit.wslPwshPath || '/snap/bin/pwsh')
  const [split, setSplit] = useState(Boolean(aiCommit.split ?? false))
  const [splitMaxBatches, setSplitMaxBatches] = useState(String(clampSplitMaxBatches(aiCommit.splitMaxBatches)))
  const [maxBullets, setMaxBullets] = useState(String(clampMaxBullets(aiCommit.maxBullets)))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setEnabled(Boolean(aiCommit.enabled ?? true))
    setApiBaseUrl(aiCommit.apiBaseUrl || 'https://api.openai.com/v1')
    setApiKey(aiCommit.apiKey || '')
    setModel(aiCommit.model || 'gpt-4o-mini')
    setWslPwshPath(aiCommit.wslPwshPath || '/snap/bin/pwsh')
    setSplit(Boolean(aiCommit.split ?? false))
    setSplitMaxBatches(String(clampSplitMaxBatches(aiCommit.splitMaxBatches)))
    setMaxBullets(String(clampMaxBullets(aiCommit.maxBullets)))
  }, [
    aiCommit.enabled,
    aiCommit.apiBaseUrl,
    aiCommit.apiKey,
    aiCommit.model,
    aiCommit.wslPwshPath,
    aiCommit.split,
    aiCommit.splitMaxBatches,
    aiCommit.maxBullets,
  ])

  const handleSave = async () => {
    setSaving(true)
    try {
      const parsedSplitMaxBatches = Number.parseInt(splitMaxBatches.trim(), 10)
      const normalizedSplitMaxBatches = clampSplitMaxBatches(parsedSplitMaxBatches)
      const parsedMaxBullets = Number.parseInt(maxBullets.trim(), 10)
      const normalizedMaxBullets = clampMaxBullets(parsedMaxBullets)
      await onSave({
        enabled,
        apiBaseUrl: apiBaseUrl.trim(),
        apiKey: apiKey.trim(),
        model: model.trim(),
        wslPwshPath: wslPwshPath.trim(),
        split,
        splitMaxBatches: normalizedSplitMaxBatches,
        maxBullets: normalizedMaxBullets,
      })
      setSplitMaxBatches(String(normalizedSplitMaxBatches))
      setMaxBullets(String(normalizedMaxBullets))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="section-label mb-3">{t('settingsAiCommit.kicker')}</p>
        <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-[color:var(--color-foreground)]">{t('settingsAiCommit.title')}</h2>
        <p className="text-sm leading-6 text-[color:var(--color-muted-foreground)] mt-2 mb-6">
          {t('settingsAiCommit.description')}
        </p>
      </div>

      <div className="rounded-[28px] border px-6 py-6 surface-card space-y-5" style={{ borderColor: 'var(--color-border)' }}>
        <label className="flex items-center gap-2 text-sm text-[color:var(--color-foreground)]">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          {t('settingsAiCommit.enableAiCommit')}
        </label>

        <label className="flex items-center gap-2 text-sm text-[color:var(--color-foreground)]">
          <input
            type="checkbox"
            checked={split}
            onChange={(e) => setSplit(e.target.checked)}
          />
          {t('settingsAiCommit.enableSplitCommit')}
        </label>

        <div className="space-y-1.5">
          <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settingsAiCommit.splitMaxBatches')}</p>
          <Input
            type="number"
            min={1}
            max={12}
            step={1}
            value={splitMaxBatches}
            onChange={(e) => setSplitMaxBatches(e.target.value)}
            className="quiet-control w-full h-11 rounded-full border-0 px-4 text-[color:var(--color-foreground)]"
            placeholder="4"
            disabled={!split}
          />
        </div>

        <div className="space-y-1.5">
          <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settingsAiCommit.maxBullets')}</p>
          <Input
            type="number"
            min={1}
            max={20}
            step={1}
            value={maxBullets}
            onChange={(e) => setMaxBullets(e.target.value)}
            className="quiet-control w-full h-11 rounded-full border-0 px-4 text-[color:var(--color-foreground)]"
            placeholder="8"
          />
        </div>

        <div className="space-y-1.5">
          <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settingsAiCommit.apiBaseUrl')}</p>
          <Input
            value={apiBaseUrl}
            onChange={(e) => setApiBaseUrl(e.target.value)}
            className="quiet-control w-full h-11 rounded-full border-0 px-4 text-[color:var(--color-foreground)]"
            placeholder="https://api.openai.com/v1"
          />
        </div>

        <div className="space-y-1.5">
          <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settingsAiCommit.apiKey')}</p>
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="quiet-control w-full h-11 rounded-full border-0 px-4 text-[color:var(--color-foreground)]"
            placeholder="sk-..."
          />
        </div>

        <div className="space-y-1.5">
          <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settingsAiCommit.model')}</p>
          <Input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="quiet-control w-full h-11 rounded-full border-0 px-4 text-[color:var(--color-foreground)]"
            placeholder="gpt-4o-mini"
          />
        </div>

        <div className="space-y-1.5">
          <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settingsAiCommit.wslPwshPath')}</p>
          <Input
            value={wslPwshPath}
            onChange={(e) => setWslPwshPath(e.target.value)}
            className="quiet-control w-full h-11 rounded-full border-0 px-4 text-[color:var(--color-foreground)]"
            placeholder="/snap/bin/pwsh"
          />
          <p className="text-[11px] text-[color:var(--color-muted-foreground)]">
            {t('settingsAiCommit.wslPwshHint')}
          </p>
        </div>

        <Button
          className="h-10 rounded-full px-5 text-sm disabled:opacity-60"
          disabled={saving}
          onClick={() => void handleSave()}
        >
          {saving ? t('common.saving') : t('settingsAiCommit.save')}
        </Button>
      </div>
    </div>
  )
}

export { SettingsAiCommitPanel }
