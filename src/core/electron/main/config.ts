import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import type { AppConfig } from '../../shared/types'
import { PROJECT_DOC_LINK_DEFAULT_TAG_OPTIONS, PROJECT_DOC_LINK_FALLBACK_TAG } from '../../renderer/lib/projectDocLinks'

const CONFIG_FILE = 'project-launcher-config.json'

function getConfigPath(): string {
  return join(app.getPath('userData'), CONFIG_FILE)
}

const DEFAULT_CONFIG: AppConfig = {
  projects: [],
  theme: 'system',
  removedProjects: [],
  folders: [],
  tags: [],
  docLinkTags: PROJECT_DOC_LINK_DEFAULT_TAG_OPTIONS.map((item) => ({ ...item })),
  startupDefaultFilter: undefined,
  runtimeLauncherScript: '$HOME/tools/claude-code-script/start-claude-with-env.sh',
  runtimeKeepAliveOnQuit: false,
  aiCommit: {
    enabled: true,
    apiBaseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
    wslPwshPath: '/snap/bin/pwsh',
    split: false,
    splitMaxBatches: 4,
    maxBullets: 8,
  },
}

let cachedConfig: AppConfig | undefined

function normalizeDocLinkTags(
  input: AppConfig['docLinkTags'] | unknown
): NonNullable<AppConfig['docLinkTags']> {
  const defaults = PROJECT_DOC_LINK_DEFAULT_TAG_OPTIONS.map((item) => ({ ...item }))
  if (!Array.isArray(input)) return defaults

  const deduped: NonNullable<AppConfig['docLinkTags']> = []
  const used = new Set<string>()
  for (let i = 0; i < input.length; i += 1) {
    const item = input[i] as Partial<{ value: unknown; label: unknown; sortOrder: unknown }>
    const value = typeof item?.value === 'string' ? item.value.trim() : ''
    const label = typeof item?.label === 'string' ? item.label.trim() : ''
    if (!value || !label || used.has(value)) continue
    used.add(value)
    deduped.push({
      value,
      label,
      sortOrder: Number.isFinite(item?.sortOrder as number) ? Number(item?.sortOrder) : deduped.length,
    })
  }

  if (!used.has(PROJECT_DOC_LINK_FALLBACK_TAG)) {
    deduped.push({
      value: PROJECT_DOC_LINK_FALLBACK_TAG,
      label: '其他资料',
      sortOrder: deduped.length,
    })
  }

  return deduped
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((item, index) => ({ ...item, sortOrder: index }))
}

export function loadConfig(): AppConfig {
  if (cachedConfig) return cachedConfig

  const configPath = getConfigPath()
  try {
    const raw = readFileSync(configPath, 'utf-8')
    const parsed = JSON.parse(raw) as AppConfig & { startupDefaultTagId?: string }
    const legacyStartupDefaultTagId = parsed.startupDefaultTagId
    const normalizedProjects = Array.isArray(parsed.projects)
      ? parsed.projects.map((project) => {
        const favorites = Array.isArray(project.codeFileDrawerState?.favorites)
          ? project.codeFileDrawerState.favorites.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
          : []
        const recents = Array.isArray(project.codeFileDrawerState?.recents)
          ? project.codeFileDrawerState.recents.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
          : []
        const hasDrawerState = favorites.length > 0 || recents.length > 0
        return {
          ...project,
          codeFileDrawerState: hasDrawerState
            ? {
              favorites: Array.from(new Set(favorites)),
              recents: Array.from(new Set(recents)).slice(0, 40),
            }
            : undefined,
        }
      })
      : []
    const normalizedRemovedProjects = Array.isArray(parsed.removedProjects)
      ? parsed.removedProjects.map((project) => {
        const favorites = Array.isArray(project.codeFileDrawerState?.favorites)
          ? project.codeFileDrawerState.favorites.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
          : []
        const recents = Array.isArray(project.codeFileDrawerState?.recents)
          ? project.codeFileDrawerState.recents.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
          : []
        const hasDrawerState = favorites.length > 0 || recents.length > 0
        return {
          ...project,
          removedAt: Number.isFinite(project.removedAt) ? Math.trunc(project.removedAt) : Date.now(),
          codeFileDrawerState: hasDrawerState
            ? {
              favorites: Array.from(new Set(favorites)),
              recents: Array.from(new Set(recents)).slice(0, 40),
            }
            : undefined,
        }
      })
      : []
    cachedConfig = {
      ...DEFAULT_CONFIG,
      ...parsed,
      projects: normalizedProjects,
      removedProjects: normalizedRemovedProjects,
      docLinkTags: normalizeDocLinkTags(parsed.docLinkTags),
    }
    if (!cachedConfig.startupDefaultFilter && legacyStartupDefaultTagId) {
      cachedConfig.startupDefaultFilter = { type: 'tag', tagId: legacyStartupDefaultTagId }
    }
  } catch {
    cachedConfig = { ...DEFAULT_CONFIG, docLinkTags: normalizeDocLinkTags(DEFAULT_CONFIG.docLinkTags) }
  }
  return cachedConfig!
}

export function saveConfig(config: AppConfig): void {
  cachedConfig = config
  const configPath = getConfigPath()
  const dir = dirname(configPath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
}

export function updateConfig(partial: Partial<AppConfig>): AppConfig {
  const current = loadConfig()
  const updated = { ...current, ...partial }
  saveConfig(updated)
  return updated
}
