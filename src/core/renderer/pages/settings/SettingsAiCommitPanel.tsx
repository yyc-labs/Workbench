import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Plus, RefreshCw, Trash2 } from 'lucide-react'
import type { AiCommitConfig, AiCommitProfile, CodexGatewayBindingMap, ClaudeRuntimeProfile, CodexSettingsSnapshotMap } from '../../../shared/types'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Select, type SelectOption } from '../../components/ui/select'
import { ModalShell } from '../../components/ModalShell'
import { useI18n } from '../../i18n'
import { getCodexDisplaySnapshot } from '../../lib/codexGatewaySummary'
import { clampMaxBullets, clampSplitMaxBatches } from './settings.helpers'

type AiCommitPanelProps = {
  aiCommit: AiCommitConfig
  onSave: (value: AiCommitConfig) => Promise<void>
  claudeRuntimeProfiles?: ClaudeRuntimeProfile[]
  codexSettingsSnapshots?: CodexSettingsSnapshotMap
  codexGatewayBindings?: CodexGatewayBindingMap
  preferredCodexScopeKey?: string
}

type AgentProfileCandidate = {
  key: string
  identityKey: string
  profile: AiCommitProfile
}

const DEFAULT_AI_COMMIT_PROFILE_ID = 'default'

function createProfileId(): string {
  return `profile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function createDefaultProfile(): AiCommitProfile {
  return {
    id: DEFAULT_AI_COMMIT_PROFILE_ID,
    name: 'Default OpenAI',
    source: 'manual',
    apiBaseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
  }
}

function normalizeProfile(profile: Partial<AiCommitProfile>, fallbackIndex: number): AiCommitProfile {
  const fallback = createDefaultProfile()
  const id = profile.id?.trim() || (fallbackIndex === 0 ? fallback.id : createProfileId())
  const name = profile.name?.trim() || `AI Commit ${fallbackIndex + 1}`

  return {
    id,
    name,
    source: profile.source === 'claude' || profile.source === 'codex' ? profile.source : 'manual',
    sourceKey: profile.sourceKey?.trim() || undefined,
    apiBaseUrl: profile.apiBaseUrl?.trim() || '',
    apiKey: profile.apiKey?.trim() || '',
    model: profile.model?.trim() || '',
  }
}

function normalizeProfiles(aiCommit: AiCommitConfig): AiCommitProfile[] {
  const sourceProfiles = Array.isArray(aiCommit.profiles) ? aiCommit.profiles : []
  const normalized = sourceProfiles.map((profile, index) => normalizeProfile(profile, index)).filter((profile) => profile.id)

  const deduped: AiCommitProfile[] = []
  const usedIds = new Set<string>()
  for (const profile of normalized) {
    if (usedIds.has(profile.id)) continue
    usedIds.add(profile.id)
    deduped.push(profile)
  }

  if (deduped.length > 0) return deduped

  return [
    {
      ...createDefaultProfile(),
      apiBaseUrl: aiCommit.apiBaseUrl?.trim() || 'https://api.openai.com/v1',
      apiKey: aiCommit.apiKey?.trim() || '',
      model: aiCommit.model?.trim() || 'gpt-4o-mini',
    },
  ]
}

function resolveActiveProfileId(aiCommit: AiCommitConfig, profiles: AiCommitProfile[]): string {
  const activeProfileId = aiCommit.activeProfileId?.trim()
  if (activeProfileId && profiles.some((profile) => profile.id === activeProfileId)) {
    return activeProfileId
  }
  return profiles[0]?.id ?? DEFAULT_AI_COMMIT_PROFILE_ID
}

function getProfileSourceLabel(source: AiCommitProfile['source'] | undefined): string {
  if (source === 'claude') return 'Claude'
  if (source === 'codex') return 'Codex'
  return 'Manual'
}

function normalizeLoadedAgentProfileKeys(keys: AiCommitConfig['loadedAgentProfileKeys']): string[] {
  return Array.from(new Set((keys ?? []).map((key) => key.trim()).filter(Boolean)))
}

function getAgentProfileIdentityKey(profile: Pick<AiCommitProfile, 'source' | 'sourceKey'>): string | null {
  const sourceKey = profile.sourceKey?.trim()
  if (!sourceKey) return null

  if (profile.source === 'claude') {
    const match = sourceKey.match(/^claude:([^:]+)/)
    return match ? `claude:${match[1]}` : sourceKey
  }

  if (profile.source === 'codex') {
    const match = sourceKey.match(/^codex:([^:]+):([^:]+):([^:]+):([^:]+)/)
    return match ? `codex:${match[1]}:${match[2]}:${match[3]}:${match[4]}` : sourceKey
  }

  return null
}

function buildClaudeAgentProfileCandidates(profiles: ClaudeRuntimeProfile[] | undefined): AgentProfileCandidate[] {
  const list = profiles ?? []
  return list.map((profile) => {
    const sourceKey = ['claude', profile.id, profile.config.anthropicBaseUrl, profile.config.anthropicModel].join(':')

    return {
      key: sourceKey,
      identityKey: `claude:${profile.id}`,
      profile: {
        id: createProfileId(),
        name: `Claude - ${profile.name}`,
        source: 'claude',
        sourceKey,
        apiBaseUrl: profile.config.anthropicBaseUrl,
        apiKey: profile.config.anthropicAuthToken,
        model: profile.config.anthropicModel,
      },
    }
  })
}

function buildCodexAgentProfileCandidates(snapshots: CodexSettingsSnapshotMap | undefined, bindings: CodexGatewayBindingMap | undefined, preferredScopeKey: string | undefined): AgentProfileCandidate[] {
  const entries = Object.entries(snapshots ?? {})
  if (entries.length === 0) return []

  const sortedEntries = entries.slice().sort(([left], [right]) => {
    if (left === preferredScopeKey) return -1
    if (right === preferredScopeKey) return 1
    return left.localeCompare(right)
  })
  const selectedEntries = preferredScopeKey ? sortedEntries.filter(([scopeKey]) => scopeKey === preferredScopeKey) : sortedEntries.slice(0, 1)

  return selectedEntries.flatMap(([scopeKey, snapshot]) => {
    const binding = bindings?.[scopeKey]
    const displaySnapshot = getCodexDisplaySnapshot(snapshot, binding) ?? snapshot

    return Object.entries(displaySnapshot.config.modelProviders).map(([providerKey, provider]) => {
      const sourceKey = ['codex', scopeKey, providerKey, provider.baseUrl, provider.model].join(':')

      return {
        key: sourceKey,
        identityKey: `codex:${scopeKey}:${providerKey}`,
        profile: {
          id: createProfileId(),
          name: `Codex - ${provider.name || providerKey}`,
          source: 'codex' as const,
          sourceKey,
          apiBaseUrl: provider.baseUrl,
          apiKey: displaySnapshot.providerApiKeys[providerKey] ?? '',
          model: provider.model,
        },
      }
    })
  })
}

function buildAgentProfileCandidates(claudeRuntimeProfiles: ClaudeRuntimeProfile[] | undefined, codexSettingsSnapshots: CodexSettingsSnapshotMap | undefined, codexGatewayBindings: CodexGatewayBindingMap | undefined, preferredCodexScopeKey: string | undefined): AgentProfileCandidate[] {
  return [...buildClaudeAgentProfileCandidates(claudeRuntimeProfiles), ...buildCodexAgentProfileCandidates(codexSettingsSnapshots, codexGatewayBindings, preferredCodexScopeKey)]
}

function SettingsAiCommitPanel({ aiCommit, onSave, claudeRuntimeProfiles, codexSettingsSnapshots, codexGatewayBindings, preferredCodexScopeKey }: AiCommitPanelProps) {
  const { t, tHtml } = useI18n()
  const autoLoadSignatureRef = useRef<string | null>(null)
  const [enabled, setEnabled] = useState(Boolean(aiCommit.enabled ?? true))
  const [profiles, setProfiles] = useState<AiCommitProfile[]>(() => normalizeProfiles(aiCommit))
  const [activeProfileId, setActiveProfileId] = useState(() => resolveActiveProfileId(aiCommit, normalizeProfiles(aiCommit)))
  const [wslPwshPath, setWslPwshPath] = useState(aiCommit.wslPwshPath || '/snap/bin/pwsh')
  const [split, setSplit] = useState(Boolean(aiCommit.split ?? false))
  const [splitMaxBatches, setSplitMaxBatches] = useState(String(clampSplitMaxBatches(aiCommit.splitMaxBatches)))
  const [maxBullets, setMaxBullets] = useState(String(clampMaxBullets(aiCommit.maxBullets)))
  const [deleteConfirmProfileId, setDeleteConfirmProfileId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [syncingAgentProfiles, setSyncingAgentProfiles] = useState(false)
  const [syncAgentMessage, setSyncAgentMessage] = useState<string | null>(null)
  const [syncAgentError, setSyncAgentError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const nextProfiles = normalizeProfiles(aiCommit)
    setEnabled(Boolean(aiCommit.enabled ?? true))
    setProfiles(nextProfiles)
    setActiveProfileId(resolveActiveProfileId(aiCommit, nextProfiles))
    setWslPwshPath(aiCommit.wslPwshPath || '/snap/bin/pwsh')
    setSplit(Boolean(aiCommit.split ?? false))
    setSplitMaxBatches(String(clampSplitMaxBatches(aiCommit.splitMaxBatches)))
    setMaxBullets(String(clampMaxBullets(aiCommit.maxBullets)))
    setDeleteConfirmProfileId(null)
    setDeleteError(null)
    setSyncAgentMessage(null)
    setSyncAgentError(null)
  }, [aiCommit.enabled, aiCommit.activeProfileId, aiCommit.profiles, aiCommit.apiBaseUrl, aiCommit.apiKey, aiCommit.model, aiCommit.wslPwshPath, aiCommit.split, aiCommit.splitMaxBatches, aiCommit.maxBullets])

  const activeProfile = useMemo(() => profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0] ?? createDefaultProfile(), [activeProfileId, profiles])
  const deleteConfirmProfile = useMemo(() => profiles.find((profile) => profile.id === deleteConfirmProfileId) ?? null, [deleteConfirmProfileId, profiles])
  const loadedAgentProfileKeys = useMemo(() => normalizeLoadedAgentProfileKeys(aiCommit.loadedAgentProfileKeys), [aiCommit.loadedAgentProfileKeys])
  const agentProfileCandidates = useMemo(() => buildAgentProfileCandidates(claudeRuntimeProfiles, codexSettingsSnapshots, codexGatewayBindings, preferredCodexScopeKey), [claudeRuntimeProfiles, codexSettingsSnapshots, codexGatewayBindings, preferredCodexScopeKey])
  const profileOptions = useMemo<SelectOption[]>(
    () =>
      profiles.map((profile) => ({
        value: profile.id,
        label: `${profile.name} · ${getProfileSourceLabel(profile.source)}`,
      })),
    [profiles],
  )

  useEffect(() => {
    const loadedKeys = new Set(loadedAgentProfileKeys)
    const existingIdentityKeys = new Set(profiles.map((profile) => getAgentProfileIdentityKey(profile)).filter((key): key is string => Boolean(key)))
    const newCandidates = agentProfileCandidates.filter((candidate) => !loadedKeys.has(candidate.key) && !existingIdentityKeys.has(candidate.identityKey))

    if (newCandidates.length === 0) return
    const loadSignature = newCandidates.map((candidate) => candidate.key).join('|')
    if (autoLoadSignatureRef.current === loadSignature) return

    autoLoadSignatureRef.current = loadSignature
    const nextProfiles = [...profiles, ...newCandidates.map((candidate) => candidate.profile)]
    const nextLoadedKeys = Array.from(new Set([...loadedAgentProfileKeys, ...newCandidates.map((candidate) => candidate.key)]))
    const activeProfileForSave = nextProfiles.find((profile) => profile.id === activeProfileId) ?? nextProfiles[0] ?? createDefaultProfile()

    setProfiles(nextProfiles)
    void onSave({
      ...aiCommit,
      activeProfileId: activeProfileForSave.id,
      profiles: nextProfiles,
      loadedAgentProfileKeys: nextLoadedKeys,
      apiBaseUrl: activeProfileForSave.apiBaseUrl?.trim(),
      apiKey: activeProfileForSave.apiKey?.trim(),
      model: activeProfileForSave.model?.trim(),
    }).catch(() => {
      autoLoadSignatureRef.current = null
    })
  }, [activeProfileId, agentProfileCandidates, aiCommit, loadedAgentProfileKeys, onSave, profiles])

  const updateActiveProfile = (patch: Partial<AiCommitProfile>) => {
    setProfiles((current) => current.map((profile) => (profile.id === activeProfile.id ? { ...profile, ...patch } : profile)))
  }

  const addProfile = () => {
    const profile: AiCommitProfile = {
      id: createProfileId(),
      name: `AI Commit ${profiles.length + 1}`,
      source: 'manual',
      apiBaseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-4o-mini',
    }

    setProfiles((current) => [...current, profile])
    setActiveProfileId(profile.id)
    setDeleteError(null)
    setSyncAgentMessage(null)
    setSyncAgentError(null)
  }

  const buildSavePayload = (sourceProfiles: AiCommitProfile[], requestedActiveProfileId: string, nextLoadedAgentProfileKeys = loadedAgentProfileKeys) => {
    const normalizedProfiles = sourceProfiles.map((profile, index) => normalizeProfile(profile, index))
    const normalizedActiveProfile = normalizedProfiles.find((profile) => profile.id === requestedActiveProfileId) ?? normalizedProfiles[0] ?? createDefaultProfile()
    const parsedSplitMaxBatches = Number.parseInt(splitMaxBatches.trim(), 10)
    const normalizedSplitMaxBatches = clampSplitMaxBatches(parsedSplitMaxBatches)
    const parsedMaxBullets = Number.parseInt(maxBullets.trim(), 10)
    const normalizedMaxBullets = clampMaxBullets(parsedMaxBullets)

    return {
      payload: {
        enabled,
        activeProfileId: normalizedActiveProfile.id,
        profiles: normalizedProfiles,
        loadedAgentProfileKeys: nextLoadedAgentProfileKeys,
        apiBaseUrl: normalizedActiveProfile.apiBaseUrl?.trim(),
        apiKey: normalizedActiveProfile.apiKey?.trim(),
        model: normalizedActiveProfile.model?.trim(),
        wslPwshPath: wslPwshPath.trim(),
        split,
        splitMaxBatches: normalizedSplitMaxBatches,
        maxBullets: normalizedMaxBullets,
      },
      normalizedProfiles,
      normalizedActiveProfile,
      normalizedSplitMaxBatches,
      normalizedMaxBullets,
    }
  }

  const deleteActiveProfile = async () => {
    if (profiles.length <= 1 || !deleteConfirmProfile || deleteConfirmProfile.source !== 'manual') return
    const deletedIndex = profiles.findIndex((profile) => profile.id === deleteConfirmProfile.id)
    const nextProfiles = profiles.filter((profile) => profile.id !== deleteConfirmProfile.id)
    const nextSelectedIndex = Math.max(deletedIndex - 1, 0)
    const nextActiveProfileId = nextProfiles[nextSelectedIndex]?.id ?? DEFAULT_AI_COMMIT_PROFILE_ID
    const { payload, normalizedProfiles, normalizedActiveProfile, normalizedSplitMaxBatches, normalizedMaxBullets } = buildSavePayload(nextProfiles, nextActiveProfileId)

    setSaving(true)
    setDeleteError(null)
    try {
      await onSave(payload)
      setProfiles(normalizedProfiles)
      setActiveProfileId(normalizedActiveProfile.id)
      setSplitMaxBatches(String(normalizedSplitMaxBatches))
      setMaxBullets(String(normalizedMaxBullets))
      setDeleteConfirmProfileId(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setDeleteError(message || t('settingsAiCommit.deleteProfileFailed'))
    } finally {
      setSaving(false)
    }
  }

  const resolveActiveProfileAfterSync = (nextProfiles: AiCommitProfile[]): string => {
    if (nextProfiles.some((profile) => profile.id === activeProfileId)) return activeProfileId

    const currentIndex = profiles.findIndex((profile) => profile.id === activeProfileId)
    const previousProfiles = currentIndex >= 0 ? profiles.slice(0, currentIndex).reverse() : []
    const previousProfile = previousProfiles.find((profile) => nextProfiles.some((nextProfile) => nextProfile.id === profile.id))

    return previousProfile?.id ?? nextProfiles[0]?.id ?? DEFAULT_AI_COMMIT_PROFILE_ID
  }

  const syncAgentProfiles = async () => {
    if (saving || syncingAgentProfiles) return

    const candidateByIdentityKey = new Map(agentProfileCandidates.map((candidate) => [candidate.identityKey, candidate]))
    const usedCandidateKeys = new Set<string>()
    const usedIdentityKeys = new Set<string>()
    const syncedProfiles = profiles.flatMap((profile) => {
      const identityKey = getAgentProfileIdentityKey(profile)
      if (!identityKey) return [profile]
      if (usedIdentityKeys.has(identityKey)) return []

      const candidate = candidateByIdentityKey.get(identityKey)
      if (!candidate) return []

      usedIdentityKeys.add(identityKey)
      usedCandidateKeys.add(candidate.key)
      return [
        {
          ...candidate.profile,
          id: profile.id,
        },
      ]
    })

    for (const candidate of agentProfileCandidates) {
      if (usedCandidateKeys.has(candidate.key)) continue
      syncedProfiles.push(candidate.profile)
      usedCandidateKeys.add(candidate.key)
    }

    const nextProfiles = syncedProfiles.length > 0 ? syncedProfiles : [createDefaultProfile()]
    const nextLoadedAgentProfileKeys = agentProfileCandidates.map((candidate) => candidate.key)
    const { payload, normalizedProfiles, normalizedActiveProfile, normalizedSplitMaxBatches, normalizedMaxBullets } = buildSavePayload(nextProfiles, resolveActiveProfileAfterSync(nextProfiles), nextLoadedAgentProfileKeys)

    setSyncingAgentProfiles(true)
    setSyncAgentMessage(null)
    setSyncAgentError(null)
    setDeleteError(null)
    try {
      await onSave(payload)
      setProfiles(normalizedProfiles)
      setActiveProfileId(normalizedActiveProfile.id)
      setSplitMaxBatches(String(normalizedSplitMaxBatches))
      setMaxBullets(String(normalizedMaxBullets))
      setDeleteConfirmProfileId(null)
      setSyncAgentMessage(t('settingsAiCommit.syncAgentProfilesDone'))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setSyncAgentError(message || t('settingsAiCommit.syncAgentProfilesFailed'))
    } finally {
      setSyncingAgentProfiles(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const { payload, normalizedProfiles, normalizedActiveProfile, normalizedSplitMaxBatches, normalizedMaxBullets } = buildSavePayload(profiles, activeProfileId)

      await onSave(payload)
      setProfiles(normalizedProfiles)
      setActiveProfileId(normalizedActiveProfile.id)
      setSplitMaxBatches(String(normalizedSplitMaxBatches))
      setMaxBullets(String(normalizedMaxBullets))
      setDeleteError(null)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="section-label mb-3">{t('settingsAiCommit.kicker')}</p>
        <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-[color:var(--color-foreground)]">{t('settingsAiCommit.title')}</h2>
        <p className="text-sm leading-6 text-[color:var(--color-muted-foreground)] mt-2 mb-6">{t('settingsAiCommit.description')}</p>
      </div>

      <div className="rounded-[28px] border px-6 py-6 surface-card space-y-6" style={{ borderColor: 'var(--color-border)' }}>
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[color:var(--color-foreground)]">{t('settingsAiCommit.profileSectionTitle')}</p>
              <p className="mt-1 text-xs leading-5 text-[color:var(--color-muted-foreground)]">{t('settingsAiCommit.profileSectionDescription')}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="h-9 rounded-full px-3 text-xs" onClick={() => addProfile()} disabled={saving || syncingAgentProfiles}>
                <Plus className="h-3.5 w-3.5" />
                {t('settingsAiCommit.addProfile')}
              </Button>
              <Button variant="outline" className="h-9 rounded-full px-3 text-xs" onClick={() => void syncAgentProfiles()} loading={syncingAgentProfiles} disabled={saving}>
                <RefreshCw className="h-3.5 w-3.5" />
                {t('settingsAiCommit.syncAgentProfiles')}
              </Button>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="space-y-1.5">
              <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settingsAiCommit.activeProfile')}</p>
              <Select ariaLabel={t('settingsAiCommit.activeProfile')} value={activeProfile.id} options={profileOptions} onChange={setActiveProfileId} />
            </div>
            <div className="flex items-end">
              <Button
                variant="outline"
                className="h-10 rounded-full px-4 text-xs text-[color:var(--color-destructive)]"
                disabled={profiles.length <= 1 || activeProfile.source !== 'manual'}
                title={activeProfile.source !== 'manual' ? t('settingsAiCommit.deleteExternalProfileDisabled') : undefined}
                onClick={() => {
                  setDeleteError(null)
                  setDeleteConfirmProfileId(activeProfile.id)
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t('settingsAiCommit.deleteProfile')}
              </Button>
            </div>
          </div>

          {(syncAgentMessage || syncAgentError) && <p className={`text-xs ${syncAgentError ? 'text-[color:var(--color-destructive)]' : 'text-[color:var(--color-muted-foreground)]'}`}>{syncAgentError || syncAgentMessage}</p>}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settingsAiCommit.profileName')}</p>
              <Input value={activeProfile.name} onChange={(e) => updateActiveProfile({ name: e.target.value })} className="quiet-control w-full h-11 rounded-full border-0 px-4 text-[color:var(--color-foreground)]" placeholder={t('settingsAiCommit.profileNamePlaceholder')} />
            </div>

            <div className="space-y-1.5">
              <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settingsAiCommit.model')}</p>
              <Input value={activeProfile.model ?? ''} onChange={(e) => updateActiveProfile({ model: e.target.value })} className="quiet-control w-full h-11 rounded-full border-0 px-4 text-[color:var(--color-foreground)]" placeholder="gpt-4o-mini" />
            </div>

            <div className="space-y-1.5">
              <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settingsAiCommit.apiBaseUrl')}</p>
              <Input value={activeProfile.apiBaseUrl ?? ''} onChange={(e) => updateActiveProfile({ apiBaseUrl: e.target.value })} className="quiet-control w-full h-11 rounded-full border-0 px-4 text-[color:var(--color-foreground)]" placeholder="https://api.openai.com/v1" />
            </div>

            <div className="space-y-1.5">
              <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settingsAiCommit.apiKey')}</p>
              <Input type="password" value={activeProfile.apiKey ?? ''} onChange={(e) => updateActiveProfile({ apiKey: e.target.value })} className="quiet-control w-full h-11 rounded-full border-0 px-4 text-[color:var(--color-foreground)]" placeholder="sk-..." />
            </div>
          </div>
        </div>

        <div className="h-px bg-[color:var(--color-border)]" />

        <label className="flex items-center gap-2 text-sm text-[color:var(--color-foreground)]">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          {t('settingsAiCommit.enableAiCommit')}
        </label>

        <label className="flex items-center gap-2 text-sm text-[color:var(--color-foreground)]">
          <input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} />
          {t('settingsAiCommit.enableSplitCommit')}
        </label>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settingsAiCommit.splitMaxBatches')}</p>
            <Input type="number" min={1} max={12} step={1} value={splitMaxBatches} onChange={(e) => setSplitMaxBatches(e.target.value)} className="quiet-control w-full h-11 rounded-full border-0 px-4 text-[color:var(--color-foreground)]" placeholder="4" disabled={!split} />
          </div>

          <div className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settingsAiCommit.maxBullets')}</p>
            <Input type="number" min={1} max={20} step={1} value={maxBullets} onChange={(e) => setMaxBullets(e.target.value)} className="quiet-control w-full h-11 rounded-full border-0 px-4 text-[color:var(--color-foreground)]" placeholder="8" />
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settingsAiCommit.wslPwshPath')}</p>
          <Input value={wslPwshPath} onChange={(e) => setWslPwshPath(e.target.value)} className="quiet-control w-full h-11 rounded-full border-0 px-4 text-[color:var(--color-foreground)]" placeholder="/snap/bin/pwsh" />
          <p className="text-[11px] text-[color:var(--color-muted-foreground)]" dangerouslySetInnerHTML={tHtml('settingsAiCommit.wslPwshHint')} />
        </div>

        <Button className="h-10 rounded-full px-5 text-sm disabled:opacity-60" loading={saving} onClick={() => void handleSave()}>
          {saving ? t('common.saving') : t('settingsAiCommit.save')}
        </Button>

        <ModalShell
          open={Boolean(deleteConfirmProfile)}
          onClose={() => {
            if (saving) return
            setDeleteConfirmProfileId(null)
          }}
          widthClassName="max-w-[560px]"
          ariaLabel={t('settingsAiCommit.deleteProfileConfirmLabel')}
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
                <h3 className="text-base font-semibold text-[color:var(--color-foreground)]">{t('settingsAiCommit.deleteProfileConfirmTitle')}</h3>
                <p className="mt-1 text-sm leading-6 text-[color:var(--color-muted-foreground)]">
                  {t('settingsAiCommit.deleteProfileConfirmHint', {
                    value: deleteConfirmProfile?.name ?? '',
                  })}
                </p>
              </div>
            </div>

            <div className="rounded-[18px] border px-4 py-3" style={{ borderColor: 'var(--color-border)' }}>
              <p className="text-sm text-[color:var(--color-foreground)]">{deleteConfirmProfile?.name}</p>
            </div>

            {deleteError && <p className="text-xs text-[color:var(--color-destructive)]">{deleteError}</p>}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" className="h-10 px-4" onClick={() => setDeleteConfirmProfileId(null)} disabled={saving}>
                {t('common.cancel')}
              </Button>
              <Button type="button" variant="destructive" className="h-10 px-4" onClick={() => void deleteActiveProfile()} loading={saving} disabled={saving || !deleteConfirmProfile}>
                {t('common.delete')}
              </Button>
            </div>
          </div>
        </ModalShell>
      </div>
    </div>
  )
}

export { SettingsAiCommitPanel }
