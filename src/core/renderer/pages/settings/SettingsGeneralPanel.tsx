import type { AppLocale, CloseWindowBehavior, ConfigRecoveryInfo, LaunchOnLoginDisplayMode, ProjectFileExclusionsConfig } from '../../../shared/types'
import { useEffect, useState } from 'react'
import { useI18n } from '../../i18n'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Textarea } from '../../components/ui/textarea'
import type { ThemeMode } from './settings.types'
import { ThemeSegmentedControl } from './ThemeSegmentedControl'

type GeneralPanelProps = {
  theme: ThemeMode
  locale: AppLocale
  launchOnLogin: boolean
  launchOnLoginDisplayMode: LaunchOnLoginDisplayMode
  closeWindowBehavior: CloseWindowBehavior
  codeFileExclusions: ProjectFileExclusionsConfig
  imagePreviewLimitMb: number
  pdfPreviewLimitMb: number
  audioPreviewLimitMb: number
  videoPreviewLimitMb: number
  supportsLaunchOnLogin: boolean
  supportsCloseWindowBehavior: boolean
  configRecovery?: ConfigRecoveryInfo
  onThemeChange: (next: ThemeMode) => void
  onLocaleChange: (next: NonNullable<AppLocale>) => void
  onLaunchOnLoginChange: (enabled: boolean) => void | Promise<void>
  onLaunchOnLoginDisplayModeChange: (mode: LaunchOnLoginDisplayMode) => void | Promise<void>
  onCloseWindowBehaviorChange: (behavior: CloseWindowBehavior) => void | Promise<void>
  onCodeFileExclusionsChange: (exclusions: ProjectFileExclusionsConfig) => void | Promise<void>
  onFilePreviewLimitsChange: (limits: { imagePreviewLimitMb?: number; pdfPreviewLimitMb?: number; audioPreviewLimitMb?: number; videoPreviewLimitMb?: number }) => void | Promise<void>
}

type PreviewLimitInputProps = {
  label: string
  value: number
  placeholder: string
  onCommit: (limitMb: number) => void
}

function PreviewLimitInput({ label, value, placeholder, onCommit }: PreviewLimitInputProps) {
  const [draft, setDraft] = useState(String(value))

  useEffect(() => {
    setDraft(String(value))
  }, [value])

  const commitPreviewLimit = () => {
    const parsed = Number(draft)
    if (!Number.isFinite(parsed) || Math.round(parsed) === value) {
      setDraft(String(value))
      return
    }
    onCommit(Math.round(parsed))
  }

  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-[color:var(--color-foreground)]">{label}</span>
      <Input
        type="number"
        min={1}
        max={1024}
        step={1}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitPreviewLimit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur()
          }
        }}
        className="quiet-control w-full h-11 rounded-full border-0 px-4 text-[color:var(--color-foreground)]"
        placeholder={placeholder}
      />
    </label>
  )
}

function SettingsGeneralPanel({
  theme,
  locale,
  launchOnLogin,
  launchOnLoginDisplayMode,
  closeWindowBehavior,
  codeFileExclusions,
  imagePreviewLimitMb,
  pdfPreviewLimitMb,
  audioPreviewLimitMb,
  videoPreviewLimitMb,
  supportsLaunchOnLogin,
  supportsCloseWindowBehavior,
  configRecovery,
  onThemeChange,
  onLocaleChange,
  onLaunchOnLoginChange,
  onLaunchOnLoginDisplayModeChange,
  onCloseWindowBehaviorChange,
  onCodeFileExclusionsChange,
  onFilePreviewLimitsChange,
}: GeneralPanelProps) {
  const { t } = useI18n()
  const [codeExclusionsDraft, setCodeExclusionsDraft] = useState(codeFileExclusions)

  useEffect(() => {
    setCodeExclusionsDraft(codeFileExclusions)
  }, [codeFileExclusions])

  return (
    <div className="space-y-8">
      <div>
        <p className="section-label mb-3">{t('settings.general.appearance')}</p>
        <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-[color:var(--color-foreground)]">{t('settings.general.interface')}</h2>
        <p className="text-sm leading-6 text-[color:var(--color-muted-foreground)] mt-2 mb-6">{t('settings.general.description')}</p>
        {configRecovery?.recovered && (
          <div className="surface-card mb-6 rounded-2xl border border-[color:var(--color-warning)]/40 p-4">
            <p className="text-sm font-medium text-[color:var(--color-foreground)]">{t('settings.general.configRecoveryTitle')}</p>
            <p className="mt-1 text-xs leading-5 text-[color:var(--color-muted-foreground)]">{t('settings.general.configRecoveryDescription')}</p>
            {configRecovery.backupPath && <p className="mt-2 break-all text-xs text-[color:var(--color-muted-foreground)]">{t('settings.general.configRecoveryBackup', { value: configRecovery.backupPath })}</p>}
          </div>
        )}
        <ThemeSegmentedControl value={theme} onChange={onThemeChange} />
      </div>

      <div>
        <p className="section-label mb-3">{t('settings.general.codeWorkspace')}</p>
        <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-[color:var(--color-foreground)]">{t('settings.general.codeExclusionsTitle')}</h2>
        <p className="text-sm leading-6 text-[color:var(--color-muted-foreground)] mt-2 mb-6">{t('settings.general.codeExclusionsDescription')}</p>
        <div className="grid gap-5 md:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-[color:var(--color-foreground)]">{t('settings.general.codeExcludedDirectories')}</span>
            <Textarea
              value={codeExclusionsDraft.directories.join('\n')}
              onChange={(event) =>
                setCodeExclusionsDraft({
                  ...codeExclusionsDraft,
                  directories: event.target.value.split(/\r?\n/),
                })
              }
              rows={8}
              spellCheck={false}
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-[color:var(--color-foreground)]">{t('settings.general.codeExcludedFiles')}</span>
            <Textarea
              value={codeExclusionsDraft.files.join('\n')}
              onChange={(event) =>
                setCodeExclusionsDraft({
                  ...codeExclusionsDraft,
                  files: event.target.value.split(/\r?\n/),
                })
              }
              rows={8}
              spellCheck={false}
            />
          </label>
        </div>
        <p className="mt-3 text-xs leading-5 text-[color:var(--color-muted-foreground)]">{t('settings.general.codeExclusionsHint')}</p>
        <Button className="mt-4" onClick={() => void onCodeFileExclusionsChange(codeExclusionsDraft)}>
          {t('settings.general.saveCodeExclusions')}
        </Button>

        <div className="mt-6 max-w-xl">
          <div className="grid gap-5 md:grid-cols-2">
            <PreviewLimitInput label={t('settings.general.imagePreviewLimitLabel')} value={imagePreviewLimitMb} placeholder="10" onCommit={(limitMb) => void onFilePreviewLimitsChange({ imagePreviewLimitMb: limitMb })} />
            <PreviewLimitInput label={t('settings.general.pdfPreviewLimitLabel')} value={pdfPreviewLimitMb} placeholder="3" onCommit={(limitMb) => void onFilePreviewLimitsChange({ pdfPreviewLimitMb: limitMb })} />
            <PreviewLimitInput label={t('settings.general.audioPreviewLimitLabel')} value={audioPreviewLimitMb} placeholder="5" onCommit={(limitMb) => void onFilePreviewLimitsChange({ audioPreviewLimitMb: limitMb })} />
            <PreviewLimitInput label={t('settings.general.videoPreviewLimitLabel')} value={videoPreviewLimitMb} placeholder="10" onCommit={(limitMb) => void onFilePreviewLimitsChange({ videoPreviewLimitMb: limitMb })} />
          </div>
          <p className="mt-3 text-[11px] leading-5 text-[color:var(--color-muted-foreground)]">{t('settings.general.filePreviewLimitsHint')}</p>
        </div>
      </div>

      <div>
        <p className="section-label mb-3">{t('settings.general.language')}</p>
        <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-[color:var(--color-foreground)]">{t('settings.general.language')}</h2>
        <p className="text-sm leading-6 text-[color:var(--color-muted-foreground)] mt-2 mb-6">{t('settings.general.languageDescription')}</p>
        <div className="quiet-control inline-flex rounded-full p-1 gap-0.5">
          {[
            { value: 'system', label: t('settings.general.followSystem') },
            { value: 'en-US', label: t('settings.general.english') },
            { value: 'zh-CN', label: t('settings.general.simplifiedChinese') },
          ].map((opt) => (
            <button
              key={opt.value}
              onClick={() => onLocaleChange(opt.value as NonNullable<AppLocale>)}
              className={`button-interactive flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all ${
                locale === opt.value ? 'bg-[color:var(--color-card)] text-[color:var(--color-foreground)] shadow-sm' : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {supportsLaunchOnLogin && (
        <div>
          <p className="section-label mb-3">{t('settings.general.startup')}</p>
          <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-[color:var(--color-foreground)]">{t('settings.general.launchOnLogin')}</h2>
          <p className="text-sm leading-6 text-[color:var(--color-muted-foreground)] mt-2 mb-6">{t('settings.general.launchOnLoginDescription')}</p>
          <label className="inline-flex items-start gap-2 text-sm text-[color:var(--color-foreground)]">
            <input type="checkbox" checked={launchOnLogin} onChange={(e) => void onLaunchOnLoginChange(e.target.checked)} />
            <span>
              <span className="block">{t('settings.general.launchOnLoginLabel')}</span>
              <span className="mt-1 block text-xs leading-5 text-[color:var(--color-muted-foreground)]">{t('settings.general.launchOnLoginHint')}</span>
            </span>
          </label>
          <div className="mt-5">
            <p className="mb-2 text-xs font-medium text-[color:var(--color-foreground)]">{t('settings.general.launchOnLoginDisplayMode')}</p>
            <div className="quiet-control inline-flex rounded-full p-1 gap-0.5">
              {[
                { value: 'tray', label: t('settings.general.launchOnLoginDisplayTray') },
                { value: 'window', label: t('settings.general.launchOnLoginDisplayWindow') },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => {
                    void onLaunchOnLoginDisplayModeChange(opt.value as LaunchOnLoginDisplayMode)
                  }}
                  className={`button-interactive flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all ${
                    launchOnLoginDisplayMode === opt.value ? 'bg-[color:var(--color-card)] text-[color:var(--color-foreground)] shadow-sm' : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs leading-5 text-[color:var(--color-muted-foreground)]">{t('settings.general.launchOnLoginDisplayHint')}</p>
          </div>
        </div>
      )}

      {supportsCloseWindowBehavior && (
        <div>
          <p className="section-label mb-3">{t('settings.general.window')}</p>
          <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-[color:var(--color-foreground)]">{t('settings.general.closeBehavior')}</h2>
          <p className="text-sm leading-6 text-[color:var(--color-muted-foreground)] mt-2 mb-6">{t('settings.general.closeBehaviorDescription')}</p>
          <div className="quiet-control inline-flex rounded-full p-1 gap-0.5">
            {[
              { value: 'quit', label: t('settings.general.closeBehaviorQuit') },
              { value: 'tray', label: t('settings.general.closeBehaviorTray') },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => void onCloseWindowBehaviorChange(opt.value as CloseWindowBehavior)}
                className={`button-interactive flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all ${
                  closeWindowBehavior === opt.value ? 'bg-[color:var(--color-card)] text-[color:var(--color-foreground)] shadow-sm' : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs leading-5 text-[color:var(--color-muted-foreground)]">{t('settings.general.closeBehaviorHint')}</p>
        </div>
      )}
    </div>
  )
}

export { SettingsGeneralPanel }
