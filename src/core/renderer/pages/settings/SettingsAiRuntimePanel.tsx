import { ExternalLink } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { AiExecutionMode, Capability, ClaudeBashrcConfig } from '../../../shared/types'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { useI18n } from '../../i18n'

const DEEPSEEK_CLAUDE_CODE_DOC_URL = 'https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/claude_code'

type SettingsAiRuntimePanelProps = {
  capability: Capability | null
  mode?: AiExecutionMode
}

function SettingsAiRuntimePanel({ capability, mode }: SettingsAiRuntimePanelProps) {
  const { t } = useI18n()
  const [anthropicBaseUrl, setAnthropicBaseUrl] = useState('https://api.deepseek.com/anthropic')
  const [anthropicAuthToken, setAnthropicAuthToken] = useState('')
  const [anthropicModel, setAnthropicModel] = useState('deepseek-v4-pro[1m]')
  const [anthropicDefaultOpusModel, setAnthropicDefaultOpusModel] = useState('deepseek-v4-pro[1m]')
  const [anthropicDefaultSonnetModel, setAnthropicDefaultSonnetModel] = useState('deepseek-v4-pro[1m]')
  const [anthropicDefaultHaikuModel, setAnthropicDefaultHaikuModel] = useState('deepseek-v4-flash')
  const [claudeCodeSubagentModel, setClaudeCodeSubagentModel] = useState('deepseek-v4-flash')
  const [claudeCodeEffortLevel, setClaudeCodeEffortLevel] = useState('max')
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedHint, setSavedHint] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const capabilityReady = capability !== null
  const supportsShellEnvConfig = Boolean(
    capability && (
      capability.hostPlatform === 'linux'
      || capability.hostPlatform === 'macos'
      || (capability.hostPlatform === 'windows' && capability.hasWsl)
    )
  )
  const isCustomScriptMode = mode === 'custom-script'
  const inputDisabled = !capabilityReady || !loaded || saving || !supportsShellEnvConfig
  const shellConfigReadOnly = capabilityReady && !supportsShellEnvConfig
  const shellScopeLabel = capability?.hostPlatform === 'windows'
    ? t('settings.aiRuntime.shellScopeWsl')
    : t('settings.aiRuntime.shellScopePosix')

  useEffect(() => {
    let mounted = true
    setLoaded(false)
    setSavedHint(null)
    setError(null)

    if (!capabilityReady) {
      return () => {
        mounted = false
      }
    }

    if (!supportsShellEnvConfig) {
      setLoaded(true)
      return () => {
        mounted = false
      }
    }

    void window.electronAPI.getClaudeBashrcConfig()
      .then((result: ClaudeBashrcConfig) => {
        if (!mounted) return
        setAnthropicBaseUrl(result.anthropicBaseUrl)
        setAnthropicAuthToken(result.anthropicAuthToken)
        setAnthropicModel(result.anthropicModel)
        setAnthropicDefaultOpusModel(result.anthropicDefaultOpusModel)
        setAnthropicDefaultSonnetModel(result.anthropicDefaultSonnetModel)
        setAnthropicDefaultHaikuModel(result.anthropicDefaultHaikuModel)
        setClaudeCodeSubagentModel(result.claudeCodeSubagentModel)
        setClaudeCodeEffortLevel(result.claudeCodeEffortLevel)
        setLoaded(true)
      })
      .catch((loadError) => {
        if (!mounted) return
        const message = loadError instanceof Error ? loadError.message : String(loadError)
        setError(message || t('settings.aiRuntime.loadError'))
        setLoaded(true)
      })

    return () => {
      mounted = false
    }
  }, [capabilityReady, supportsShellEnvConfig, t])

  const envFields = useMemo(() => ([
    {
      label: 'ANTHROPIC_BASE_URL',
      value: anthropicBaseUrl,
      onChange: setAnthropicBaseUrl,
      placeholder: 'https://api.deepseek.com/anthropic',
    },
    {
      label: 'ANTHROPIC_AUTH_TOKEN',
      value: anthropicAuthToken,
      onChange: setAnthropicAuthToken,
      placeholder: loaded ? 'sk-...' : 'Loading ~/.bashrc...',
      type: 'password' as const,
      hint: t('settings.aiRuntime.tokenHint'),
    },
    {
      label: 'ANTHROPIC_MODEL',
      value: anthropicModel,
      onChange: setAnthropicModel,
      placeholder: 'deepseek-v4-pro[1m]',
    },
    {
      label: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
      value: anthropicDefaultOpusModel,
      onChange: setAnthropicDefaultOpusModel,
      placeholder: 'deepseek-v4-pro[1m]',
    },
    {
      label: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
      value: anthropicDefaultSonnetModel,
      onChange: setAnthropicDefaultSonnetModel,
      placeholder: 'deepseek-v4-pro[1m]',
    },
    {
      label: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
      value: anthropicDefaultHaikuModel,
      onChange: setAnthropicDefaultHaikuModel,
      placeholder: 'deepseek-v4-flash',
    },
    {
      label: 'CLAUDE_CODE_SUBAGENT_MODEL',
      value: claudeCodeSubagentModel,
      onChange: setClaudeCodeSubagentModel,
      placeholder: 'deepseek-v4-flash',
    },
    {
      label: 'CLAUDE_CODE_EFFORT_LEVEL',
      value: claudeCodeEffortLevel,
      onChange: setClaudeCodeEffortLevel,
      placeholder: 'max',
    },
  ]), [
    anthropicAuthToken,
    anthropicBaseUrl,
    anthropicDefaultHaikuModel,
    anthropicDefaultOpusModel,
    anthropicDefaultSonnetModel,
    anthropicModel,
    claudeCodeEffortLevel,
    claudeCodeSubagentModel,
    loaded,
    t,
  ])

  const shellCommand = useMemo(() => ([
    'export ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic',
    'export ANTHROPIC_AUTH_TOKEN=<YOUR_DEEPSEEK_API_KEY>',
    'export ANTHROPIC_MODEL=deepseek-v4-pro[1m]',
    'export ANTHROPIC_DEFAULT_OPUS_MODEL=deepseek-v4-pro[1m]',
    'export ANTHROPIC_DEFAULT_SONNET_MODEL=deepseek-v4-pro[1m]',
    'export ANTHROPIC_DEFAULT_HAIKU_MODEL=deepseek-v4-flash',
    'export CLAUDE_CODE_SUBAGENT_MODEL=deepseek-v4-flash',
    'export CLAUDE_CODE_EFFORT_LEVEL=max',
  ].join('\n')), [])

  const launchCommand = useMemo(() => ([
    'cd /path/to/my-project',
    'claude',
  ].join('\n')), [])

  const handleOpenDocs = async () => {
    await window.electronAPI.openExternal(DEEPSEEK_CLAUDE_CODE_DOC_URL)
  }

  const handleSave = async () => {
    setSaving(true)
    setSavedHint(null)
    setError(null)
    try {
      const saved = await window.electronAPI.setClaudeBashrcConfig({
        anthropicBaseUrl: anthropicBaseUrl.trim(),
        anthropicAuthToken: anthropicAuthToken.trim(),
        anthropicModel: anthropicModel.trim(),
        anthropicDefaultOpusModel: anthropicDefaultOpusModel.trim(),
        anthropicDefaultSonnetModel: anthropicDefaultSonnetModel.trim(),
        anthropicDefaultHaikuModel: anthropicDefaultHaikuModel.trim(),
        claudeCodeSubagentModel: claudeCodeSubagentModel.trim(),
        claudeCodeEffortLevel: claudeCodeEffortLevel.trim(),
      })
      setAnthropicBaseUrl(saved.anthropicBaseUrl)
      setAnthropicAuthToken(saved.anthropicAuthToken)
      setAnthropicModel(saved.anthropicModel)
      setAnthropicDefaultOpusModel(saved.anthropicDefaultOpusModel)
      setAnthropicDefaultSonnetModel(saved.anthropicDefaultSonnetModel)
      setAnthropicDefaultHaikuModel(saved.anthropicDefaultHaikuModel)
      setClaudeCodeSubagentModel(saved.claudeCodeSubagentModel)
      setClaudeCodeEffortLevel(saved.claudeCodeEffortLevel)
      setSavedHint(t('settings.aiRuntime.savedHint'))
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : String(saveError)
      setError(message || t('settings.aiRuntime.saveError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="section-label mb-3">{t('settings.aiRuntime.kicker')}</p>
        <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-[color:var(--color-foreground)]">
          {t('settings.aiRuntime.title')}
        </h2>
        <p className="text-sm leading-6 text-[color:var(--color-muted-foreground)] mt-2 mb-6">
          {t('settings.aiRuntime.description')}
        </p>
        <div className="mb-6 rounded-[18px] border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]/45 px-4 py-3 text-sm leading-6 text-[color:var(--color-muted-foreground)]">
          <p>{t('settings.aiRuntime.runtimeModelSummary')}</p>
          <p className="mt-2">{t('settings.aiRuntime.runtimeModelShell')}</p>
          <p className="mt-2">{t('settings.aiRuntime.runtimeModelClaude')}</p>
          {isCustomScriptMode && (
            <p className="mt-2">{t('settings.aiRuntime.customScriptHint')}</p>
          )}
          {capabilityReady && !supportsShellEnvConfig && (
            <p className="mt-2 text-[color:var(--color-destructive)]">{t('settings.aiRuntime.unsupportedHostHint')}</p>
          )}
        </div>
        <Button
          variant="outline"
          className="h-10 rounded-full px-4 text-sm"
          onClick={() => void handleOpenDocs()}
        >
          <ExternalLink className="h-4 w-4" />
          {t('settings.aiRuntime.openDocs')}
        </Button>
      </div>

      <div className="rounded-[28px] border px-6 py-6 surface-card space-y-5" style={{ borderColor: 'var(--color-border)' }}>
        <div>
          <h3 className="text-base font-semibold text-[color:var(--color-foreground)]">
            {t('settings.aiRuntime.shellTitle')}
          </h3>
          <p className="mt-2 text-sm leading-6 text-[color:var(--color-muted-foreground)]">
            {t('settings.aiRuntime.shellDescription')}
          </p>
          {capabilityReady && (
            <p className="mt-2 text-xs leading-5 text-[color:var(--color-muted-foreground)]">
              {shellScopeLabel}
            </p>
          )}
          <p className="mt-2 text-xs leading-5 text-[color:var(--color-muted-foreground)]">
            {t('settings.aiRuntime.restartHint')}
          </p>
        </div>

        {envFields.map((field) => (
          <div key={field.label} className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{field.label}</p>
            <Input
              type={field.type}
              value={field.value}
              onChange={(event) => field.onChange(event.target.value)}
              className="quiet-control w-full h-11 rounded-full border-0 px-4 text-[color:var(--color-foreground)]"
              placeholder={field.placeholder}
              disabled={inputDisabled}
            />
            {field.hint && (
              <p className="text-[11px] text-[color:var(--color-muted-foreground)]">{field.hint}</p>
            )}
          </div>
        ))}

        <Button
          className="h-10 rounded-full px-5 text-sm disabled:opacity-60"
          disabled={inputDisabled}
          onClick={() => void handleSave()}
        >
          {saving ? t('common.saving') : t('settings.aiRuntime.save')}
        </Button>
        {shellConfigReadOnly && (
          <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.aiRuntime.shellReadOnlyHint')}</p>
        )}
        {savedHint && (
          <p className="text-xs text-[color:var(--color-muted-foreground)]">{savedHint}</p>
        )}
        {error && (
          <p className="text-xs text-[color:var(--color-destructive)]">{error}</p>
        )}
      </div>

      <div className="rounded-[28px] border px-6 py-6 surface-card space-y-5" style={{ borderColor: 'var(--color-border)' }}>
        <div>
          <h3 className="text-base font-semibold text-[color:var(--color-foreground)]">
            {t('settings.aiRuntime.claudeTitle')}
          </h3>
          <p className="mt-2 text-sm leading-6 text-[color:var(--color-muted-foreground)]">
            {t('settings.aiRuntime.claudeDescription')}
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.aiRuntime.shellCommandLabel')}</p>
          <pre className="max-h-[320px] overflow-auto rounded-[16px] bg-[color:var(--color-card)] p-4 font-mono text-xs leading-5 text-[color:var(--color-foreground)] whitespace-pre-wrap">
            {shellCommand}
          </pre>
        </div>

        <div className="space-y-2">
          <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.aiRuntime.launchCommandLabel')}</p>
          <pre className="rounded-[16px] bg-[color:var(--color-card)] p-4 font-mono text-xs leading-5 text-[color:var(--color-foreground)] whitespace-pre-wrap">
            {launchCommand}
          </pre>
        </div>
      </div>
    </div>
  )
}

export { SettingsAiRuntimePanel }
