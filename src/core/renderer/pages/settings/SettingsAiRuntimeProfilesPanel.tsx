import { AlertTriangle, Plus, Save, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { AiExecutionMode, AiRuntimeProfile, AiRuntimeProfileKind, AiRuntimeProfileMode, Capability } from '../../../shared/types'
import {
  defaultAiRuntimeProfileIdForCli,
  defaultAiRuntimeProfiles,
} from '../../../shared/aiRuntimeProfiles'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Select, type SelectOption } from '../../components/ui/select'
import { ModalShell } from '../../components/ModalShell'
import { useI18n } from '../../i18n'

type SettingsAiRuntimeProfilesPanelProps = {
  capability: Capability | null
  profiles: AiRuntimeProfile[]
  activeProfileId?: string
  onProfilesSave: (profiles: AiRuntimeProfile[], activeProfileId: string) => Promise<void>
}

function createProfileId(): string {
  return `runtime-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function stringifyArgs(args?: string[]): string {
  return (args ?? []).join('\n')
}

function parseArgs(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function stringifyEnv(env?: Record<string, string>): string {
  return Object.entries(env ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
}

function parseEnv(value: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of value.split(/\r?\n/)) {
    const normalized = line.trim()
    if (!normalized || normalized.startsWith('#')) continue
    const eqIndex = normalized.indexOf('=')
    if (eqIndex <= 0) continue
    const key = normalized.slice(0, eqIndex).trim()
    if (!key) continue
    env[key] = normalized.slice(eqIndex + 1)
  }
  return env
}

function normalizeProfiles(profiles: AiRuntimeProfile[]): AiRuntimeProfile[] {
  return profiles.length > 0 ? profiles : defaultAiRuntimeProfiles()
}

function getAvailableModes(capability: Capability | null): AiExecutionMode[] {
  if (!capability) return []
  if (capability.hostPlatform === 'windows') {
    return capability.hasWsl || capability.hasWslInstalled
      ? ['windows-native', 'windows-wsl', 'custom-script', 'disabled']
      : ['windows-native', 'custom-script', 'disabled']
  }
  return [capability.hostPlatform === 'macos' ? 'macos-native' : 'linux-native', 'custom-script', 'disabled']
}

function SettingsAiRuntimeProfilesPanel({
  capability,
  profiles,
  activeProfileId,
  onProfilesSave,
}: SettingsAiRuntimeProfilesPanelProps) {
  const { t } = useI18n()
  const [drafts, setDrafts] = useState<AiRuntimeProfile[]>(() => normalizeProfiles(profiles))
  const [selectedId, setSelectedId] = useState(activeProfileId || defaultAiRuntimeProfileIdForCli('claude'))
  const [defaultProfileId, setDefaultProfileId] = useState(activeProfileId || defaultAiRuntimeProfileIdForCli('claude'))
  const [deleteConfirmProfileId, setDeleteConfirmProfileId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const nextDrafts = normalizeProfiles(profiles)
    const nextDefaultProfileId = activeProfileId && nextDrafts.some((profile) => profile.id === activeProfileId)
      ? activeProfileId
      : nextDrafts[0]?.id ?? defaultAiRuntimeProfileIdForCli('claude')
    setDrafts(nextDrafts)
    setDefaultProfileId(nextDefaultProfileId)
    setSelectedId((currentSelectedId) => (
      nextDrafts.some((profile) => profile.id === currentSelectedId)
        ? currentSelectedId
        : nextDefaultProfileId
    ))
    setDeleteConfirmProfileId(null)
  }, [activeProfileId, profiles])

  const selectedProfile = useMemo(
    () => drafts.find((profile) => profile.id === selectedId) ?? drafts[0] ?? defaultAiRuntimeProfiles()[0]!,
    [drafts, selectedId]
  )
  const isCustomProfile = selectedProfile.kind === 'custom'
  const deleteConfirmProfile = useMemo(
    () => drafts.find((profile) => profile.id === deleteConfirmProfileId) ?? null,
    [deleteConfirmProfileId, drafts]
  )

  const profileOptions = useMemo<SelectOption[]>(
    () => drafts.map((profile) => ({
      value: profile.id,
      label: `${profile.name} · ${profile.kind === 'custom' ? t('settingsRuntime.profileKindCustom') : t('settingsRuntime.profileKindNative')}`,
    })),
    [drafts, t]
  )

  const modeOptions = useMemo<SelectOption[]>(() => {
    const labels: Record<AiRuntimeProfileMode, string> = {
      inherit: t('settingsRuntime.profileModeInherit'),
      'windows-wsl': t('settingsRuntime.modeWindowsWsl'),
      'windows-native': t('settingsRuntime.modeWindowsNative'),
      'linux-native': t('settingsRuntime.modeLinuxNative'),
      'macos-native': t('settingsRuntime.modeMacosNative'),
      'custom-script': t('settingsRuntime.modeCustomScript'),
      disabled: t('settingsRuntime.modeDisabled'),
    }
    const availableModes = getAvailableModes(capability).filter((mode) => (
      isCustomProfile || mode !== 'custom-script'
    ))
    return [
      { value: 'inherit', label: labels.inherit },
      ...availableModes.map((mode) => ({ value: mode, label: labels[mode] })),
    ]
  }, [capability, isCustomProfile, t])

  const kindOptions: SelectOption[] = [
    { value: 'native', label: t('settingsRuntime.profileKindNative') },
    { value: 'custom', label: t('settingsRuntime.profileKindCustom') },
  ]

  const updateSelected = (patch: Partial<AiRuntimeProfile>) => {
    setDrafts((current) => current.map((profile) => (
      profile.id === selectedProfile.id ? { ...profile, ...patch } : profile
    )))
  }

  const normalizeDraftsForSave = (sourceDrafts: AiRuntimeProfile[]) => sourceDrafts.map((profile) => {
    const kind: AiRuntimeProfileKind = profile.kind === 'custom' ? 'custom' : 'native'
    const isCustom = kind === 'custom'
    return {
      ...profile,
      name: profile.name.trim() || t('settingsRuntime.unnamedRuntimeProfile'),
      kind,
      mode: isCustom || profile.mode !== 'custom-script' ? profile.mode ?? 'inherit' : 'inherit',
      command: profile.command?.trim() || (profile.cli === 'codex' ? 'codex' : profile.cli === 'claude' ? 'claude' : ''),
      args: isCustom ? parseArgs(stringifyArgs(profile.args)) : [],
      env: isCustom ? parseEnv(stringifyEnv(profile.env)) : {},
      passProjectPath: isCustom ? Boolean(profile.passProjectPath) : false,
    }
  })

  const saveDrafts = async (
    sourceDrafts: AiRuntimeProfile[],
    requestedDefaultProfileId: string,
    requestedSelectedProfileId: string
  ) => {
    const normalized = normalizeDraftsForSave(sourceDrafts)
    const active = normalized.some((profile) => profile.id === requestedDefaultProfileId)
      ? requestedDefaultProfileId
      : normalized[0]?.id ?? defaultAiRuntimeProfileIdForCli('claude')
    await onProfilesSave(normalized, active)
    setDrafts(normalized)
    setDefaultProfileId(active)
    setSelectedId(normalized.some((profile) => profile.id === requestedSelectedProfileId) ? requestedSelectedProfileId : active)
  }

  const addProfile = () => {
    const nextProfile: AiRuntimeProfile = {
      id: createProfileId(),
      name: t('settingsRuntime.newRuntimeProfileName', { value: drafts.length + 1 }),
      kind: 'custom',
      mode: 'custom-script',
      cli: 'claude',
      command: '',
      args: [],
      env: {},
      passProjectPath: true,
    }
    setDrafts((current) => [...current, nextProfile])
    setSelectedId(nextProfile.id)
    setDeleteConfirmProfileId(null)
  }

  const deleteSelected = async () => {
    if (drafts.length <= 1 || !deleteConfirmProfile || saving || deleting) return
    const deletedIndex = drafts.findIndex((profile) => profile.id === deleteConfirmProfile.id)
    const nextDrafts = drafts.filter((profile) => profile.id !== deleteConfirmProfile.id)
    const nextSelectedIndex = Math.min(Math.max(deletedIndex, 0), nextDrafts.length - 1)
    const nextSelectedId = nextDrafts[nextSelectedIndex]?.id ?? defaultAiRuntimeProfileIdForCli('claude')

    setDeleting(true)
    try {
      await saveDrafts(
        nextDrafts,
        defaultProfileId === deleteConfirmProfile.id ? nextSelectedId : defaultProfileId,
        nextSelectedId
      )
      setDeleteConfirmProfileId(null)
    } finally {
      setDeleting(false)
    }
  }

  const handleSave = async () => {
    if (deleting) return
    setSaving(true)
    setDeleteConfirmProfileId(null)
    try {
      await saveDrafts(drafts, defaultProfileId, selectedId)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-[28px] border px-6 py-6 surface-card space-y-5" style={{ borderColor: 'var(--color-border)' }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-[820px]">
          <p className="section-label mb-3">{t('settingsRuntime.profileKicker')}</p>
          <h3 className="text-base font-semibold text-[color:var(--color-foreground)]">
            {t('settingsRuntime.profileTitle')}
          </h3>
          <p className="mt-2 text-sm leading-6 text-[color:var(--color-muted-foreground)]">
            {t('settingsRuntime.profileDescription')}
          </p>
        </div>
        <Button variant="outline" className="h-9 rounded-full px-3 text-xs" onClick={addProfile} disabled={saving || deleting}>
          <Plus className="h-3.5 w-3.5" />
          {t('settingsRuntime.addRuntimeProfile')}
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
        <div
          className="rounded-[24px] border px-5 py-4"
          style={{
            borderColor: 'color-mix(in srgb, var(--color-border) 86%, transparent)',
            background: 'color-mix(in srgb, var(--color-background-sunken) 46%, transparent)',
          }}
        >
          <div className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settingsRuntime.defaultRuntimeProfile')}</p>
            <Select
              ariaLabel={t('settingsRuntime.defaultRuntimeProfile')}
              value={defaultProfileId}
              options={profileOptions}
              disabled={saving || deleting}
              onChange={(value) => {
                setDefaultProfileId(value)
                setDeleteConfirmProfileId(null)
              }}
            />
            <p className="text-[11px] leading-5 text-[color:var(--color-muted-foreground)]">
              {t('settingsRuntime.activeRuntimeProfileHint')}
            </p>
          </div>
        </div>
        <div
          className="rounded-[24px] border px-5 py-4"
          style={{
            borderColor: 'color-mix(in srgb, var(--color-border) 86%, transparent)',
            background: 'linear-gradient(135deg, color-mix(in srgb, var(--color-card) 96%, transparent), color-mix(in srgb, var(--color-background-sunken) 42%, transparent))',
          }}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settingsRuntime.editRuntimeProfile')}</p>
              <Select
                ariaLabel={t('settingsRuntime.editRuntimeProfile')}
                value={selectedProfile.id}
                options={profileOptions}
                disabled={saving || deleting}
                onChange={(value) => {
                  setSelectedId(value)
                  setDeleteConfirmProfileId(null)
                }}
              />
            </div>
            <Button
              variant="outline"
              className="mt-6 h-10 rounded-full px-4 text-xs text-[color:var(--color-destructive)]"
              disabled={drafts.length <= 1 || saving || deleting}
              onClick={() => setDeleteConfirmProfileId(selectedProfile.id)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t('settingsRuntime.deleteRuntimeProfile')}
            </Button>
          </div>
        </div>
      </div>

      <div
        className="rounded-[24px] border px-5 py-5 space-y-4"
        style={{ borderColor: 'color-mix(in srgb, var(--color-border) 82%, transparent)' }}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settingsRuntime.profileName')}</p>
            <Input
              value={selectedProfile.name}
              onChange={(event) => updateSelected({ name: event.target.value })}
              className="quiet-control w-full h-11 rounded-full border-0 px-4 text-[color:var(--color-foreground)]"
              placeholder={t('settingsRuntime.profileNamePlaceholder')}
            />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settingsRuntime.profileKind')}</p>
            <Select
              ariaLabel={t('settingsRuntime.profileKind')}
              value={selectedProfile.kind}
              options={kindOptions}
              onChange={(value) => {
                const nextKind = value === 'custom' ? 'custom' : 'native'
                const currentMode = selectedProfile.mode ?? 'inherit'
                updateSelected({
                  kind: nextKind,
                  mode: nextKind === 'custom' && currentMode === 'inherit'
                    ? 'custom-script'
                    : nextKind === 'native' && currentMode === 'custom-script'
                      ? 'inherit'
                      : currentMode,
                  passProjectPath: nextKind === 'custom' ? selectedProfile.passProjectPath ?? true : false,
                  args: nextKind === 'custom' ? selectedProfile.args : [],
                  env: nextKind === 'custom' ? selectedProfile.env : {},
                })
              }}
            />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settingsRuntime.profileMode')}</p>
            <Select
              ariaLabel={t('settingsRuntime.profileMode')}
              value={selectedProfile.mode ?? 'inherit'}
              options={modeOptions}
              onChange={(value) => updateSelected({ mode: value as AiRuntimeProfileMode })}
            />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">
              {isCustomProfile ? t('settingsRuntime.profileCustomCommand') : t('settingsRuntime.profileNativeCommand')}
            </p>
            <Input
              value={selectedProfile.command ?? ''}
              onChange={(event) => updateSelected({ command: event.target.value })}
              className="quiet-control w-full h-11 rounded-full border-0 px-4 text-[color:var(--color-foreground)]"
              placeholder={isCustomProfile ? t('settingsRuntime.profileCommandCustomPlaceholder') : t('settingsRuntime.profileCommandNativePlaceholder')}
            />
          </div>
        </div>

        {isCustomProfile && (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settingsRuntime.profileArgs')}</p>
              <textarea
                value={stringifyArgs(selectedProfile.args)}
                onChange={(event) => updateSelected({ args: parseArgs(event.target.value) })}
                className="quiet-control min-h-[104px] w-full resize-y rounded-[18px] border-0 px-4 py-3 text-sm text-[color:var(--color-foreground)] outline-none"
                placeholder={t('settingsRuntime.profileArgsPlaceholder')}
              />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settingsRuntime.profileEnv')}</p>
              <textarea
                value={stringifyEnv(selectedProfile.env)}
                onChange={(event) => updateSelected({ env: parseEnv(event.target.value) })}
                className="quiet-control min-h-[104px] w-full resize-y rounded-[18px] border-0 px-4 py-3 text-sm text-[color:var(--color-foreground)] outline-none"
                placeholder={t('settingsRuntime.profileEnvPlaceholder')}
              />
            </div>
          </div>
        )}

        {isCustomProfile && (
          <label className="inline-flex items-start gap-2 text-sm text-[color:var(--color-foreground)]">
            <input
              type="checkbox"
              checked={selectedProfile.passProjectPath ?? true}
              onChange={(event) => updateSelected({ passProjectPath: event.target.checked })}
            />
            <span>
              <span className="block">{t('settingsRuntime.profilePassProjectPath')}</span>
              <span className="mt-1 block text-xs leading-5 text-[color:var(--color-muted-foreground)]">
                {t('settingsRuntime.profilePassProjectPathHint')}
              </span>
            </span>
          </label>
        )}
      </div>

      <Button className="h-11 rounded-full px-5 text-sm" onClick={() => void handleSave()} loading={saving} disabled={deleting}>
        <Save className="h-4 w-4" />
        {t('settingsRuntime.saveRuntimeProfiles')}
      </Button>

      <ModalShell
        open={Boolean(deleteConfirmProfile)}
        onClose={() => {
          if (deleting) return
          setDeleteConfirmProfileId(null)
        }}
        widthClassName="max-w-[560px]"
        ariaLabel={t('settingsRuntime.deleteRuntimeProfileConfirmLabel')}
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div
              className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
              style={{
                background: 'var(--color-destructive-background)',
                color: 'var(--color-destructive)',
              }}
            >
              <AlertTriangle className="h-5 w-5" strokeWidth={1.8} />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-[color:var(--color-foreground)]">
                {t('settingsRuntime.deleteRuntimeProfileConfirmTitle')}
              </h3>
              <p className="mt-1 text-sm leading-6 text-[color:var(--color-muted-foreground)]">
                {t('settingsRuntime.deleteRuntimeProfileConfirmHint', {
                  value: deleteConfirmProfile?.name ?? '',
                })}
              </p>
            </div>
          </div>

          <div
            className="rounded-[18px] border px-4 py-3"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <p className="text-sm text-[color:var(--color-foreground)]">
              {deleteConfirmProfile?.name}
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-10 px-4"
              onClick={() => setDeleteConfirmProfileId(null)}
              disabled={deleting}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="h-10 px-4"
              onClick={() => void deleteSelected()}
              loading={deleting}
              disabled={saving || deleting || !deleteConfirmProfile}
            >
              {t('common.delete')}
            </Button>
          </div>
        </div>
      </ModalShell>
    </div>
  )
}

export { SettingsAiRuntimeProfilesPanel }
