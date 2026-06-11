import { app } from 'electron'
import { readFileSync, existsSync, mkdirSync } from 'fs'
import { writeFile } from 'fs/promises'
import { join, dirname } from 'path'
import type { AppConfig } from '../../shared/types'
import { PROJECT_DOC_LINK_DEFAULT_TAG_OPTIONS } from '../../renderer/lib/projectDocLinks'
import { capabilityManager } from './capability-manager'
import { migrateLegacyEnvironment } from './ai-environment/platform-detector'

const CONFIG_FILE = 'project-launcher-config.json'
const MAX_CODE_SESSION_TABS = 5
const MAX_CODE_SESSION_CURSOR_ENTRIES = 60
const DEFAULT_AGENT_HOOK_CONFIG: NonNullable<AppConfig['agentHooks']> = {
  enabled: true,
  host: '0.0.0.0',
  port: 17373,
  token: '',
  maxBodyBytes: 256 * 1024,
  recentEventLimit: 200,
  transcriptImport: {
    enabled: true,
    token: '',
    openViewerByDefault: false,
  },
  feishu: {
    enabled: false,
    appId: '',
    appSecret: '',
    receiveId: '',
    receiveIdType: 'open_id',
    notifyOn: ['stop', 'permission-request'],
  },
}

function getConfigPath(): string {
  return join(app.getPath('userData'), CONFIG_FILE)
}

const DEFAULT_CONFIG: AppConfig = {
  projects: [],
  theme: 'system',
  locale: 'system',
  removedProjects: [],
  folders: [],
  tags: [],
  docLinkTags: PROJECT_DOC_LINK_DEFAULT_TAG_OPTIONS.map((item) => ({ ...item })),
  startupDefaultFilter: undefined,
  aiEnvironment: undefined,
  runtimeLauncherScript: undefined,
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
  agentHooks: DEFAULT_AGENT_HOOK_CONFIG,
}

let cachedConfig: AppConfig | undefined
let saveQueue: Promise<void> = Promise.resolve()

function normalizeDocLinkTags(
  input: AppConfig['docLinkTags'] | unknown
): NonNullable<AppConfig['docLinkTags']> {
  if (!Array.isArray(input)) return []

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

  return deduped
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((item, index) => ({ ...item, sortOrder: index }))
}

function normalizeCodeSession(value: unknown): {
  tabs: string[]
  activePath?: string
  cursorPositions?: Record<string, { lineNumber: number; column: number }>
} | undefined {
  if (!value || typeof value !== 'object') return undefined

  const raw = value as {
    tabs?: unknown
    activePath?: unknown
    cursorPositions?: unknown
  }
  const tabs = Array.isArray(raw.tabs)
    ? Array.from(new Set(raw.tabs
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean))).slice(0, MAX_CODE_SESSION_TABS)
    : []

  const activePath = typeof raw.activePath === 'string' ? raw.activePath.trim() : ''

  const cursorEntries: Array<[string, { lineNumber: number; column: number }]> = []
  if (raw.cursorPositions && typeof raw.cursorPositions === 'object') {
    for (const [rawPath, rawPosition] of Object.entries(raw.cursorPositions as Record<string, unknown>)) {
      const path = rawPath.trim()
      if (!path) continue
      if (!rawPosition || typeof rawPosition !== 'object') continue
      const lineNumber = Math.max(1, Math.floor(Number((rawPosition as { lineNumber?: unknown }).lineNumber)))
      const column = Math.max(1, Math.floor(Number((rawPosition as { column?: unknown }).column)))
      if (!Number.isFinite(lineNumber) || !Number.isFinite(column)) continue
      cursorEntries.push([path, { lineNumber, column }])
      if (cursorEntries.length >= MAX_CODE_SESSION_CURSOR_ENTRIES) break
    }
  }

  const cursorPositions = cursorEntries.length > 0
    ? Object.fromEntries(cursorEntries)
    : undefined

  const normalizedActivePath = activePath && tabs.includes(activePath) ? activePath : tabs[0]

  if (tabs.length <= 0 && !cursorPositions) return undefined

  return {
    tabs,
    activePath: normalizedActivePath,
    cursorPositions,
  }
}

function normalizeAgentHookConfig(
  value: AppConfig['agentHooks'] | unknown
): NonNullable<AppConfig['agentHooks']> {
  const raw = value && typeof value === 'object'
    ? value as NonNullable<AppConfig['agentHooks']>
    : {}
  const rawFeishu = raw.feishu && typeof raw.feishu === 'object' ? raw.feishu : {}
  const rawTranscriptImport = raw.transcriptImport && typeof raw.transcriptImport === 'object'
    ? raw.transcriptImport
    : {}

  return {
    ...DEFAULT_AGENT_HOOK_CONFIG,
    ...raw,
    feishu: {
      ...DEFAULT_AGENT_HOOK_CONFIG.feishu,
      ...rawFeishu,
    },
    transcriptImport: {
      ...DEFAULT_AGENT_HOOK_CONFIG.transcriptImport,
      ...rawTranscriptImport,
    },
  }
}

function normalizeAiEnvironmentConfig(config: AppConfig): AppConfig['aiEnvironment'] {
  try {
    const capability = capabilityManager.get()
    return migrateLegacyEnvironment(config.aiEnvironment, capability, {
      runtimeLauncherScript: config.runtimeLauncherScript,
      aiCommitEntrypoint: config.aiEnvironment?.aiCommitEntrypoint,
    })
  } catch {
    return config.aiEnvironment
  }
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
        const codeSession = normalizeCodeSession(project.codeSession)
        return {
          ...project,
          codeFileDrawerState: hasDrawerState
            ? {
              favorites: Array.from(new Set(favorites)),
              recents: Array.from(new Set(recents)).slice(0, 40),
            }
            : undefined,
          codeSession,
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
        const codeSession = normalizeCodeSession(project.codeSession)
        return {
          ...project,
          removedAt: Number.isFinite(project.removedAt) ? Math.trunc(project.removedAt) : Date.now(),
          codeFileDrawerState: hasDrawerState
            ? {
              favorites: Array.from(new Set(favorites)),
              recents: Array.from(new Set(recents)).slice(0, 40),
            }
            : undefined,
          codeSession,
        }
      })
      : []
    cachedConfig = {
      ...DEFAULT_CONFIG,
      ...parsed,
      projects: normalizedProjects,
      removedProjects: normalizedRemovedProjects,
      docLinkTags: normalizeDocLinkTags(parsed.docLinkTags),
      agentHooks: normalizeAgentHookConfig(parsed.agentHooks),
      aiEnvironment: normalizeAiEnvironmentConfig({
        ...DEFAULT_CONFIG,
        ...parsed,
      }),
    }
    if (!cachedConfig.startupDefaultFilter && legacyStartupDefaultTagId) {
      cachedConfig.startupDefaultFilter = { type: 'tag', tagId: legacyStartupDefaultTagId }
    }
  } catch {
    cachedConfig = {
      ...DEFAULT_CONFIG,
      docLinkTags: normalizeDocLinkTags(DEFAULT_CONFIG.docLinkTags),
      agentHooks: normalizeAgentHookConfig(DEFAULT_CONFIG.agentHooks),
      aiEnvironment: normalizeAiEnvironmentConfig(DEFAULT_CONFIG),
    }
  }
  return cachedConfig!
}

export function saveConfig(config: AppConfig): Promise<void> {
  cachedConfig = config
  const configPath = getConfigPath()
  const dir = dirname(configPath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  const serialized = JSON.stringify(config, null, 2)
  saveQueue = saveQueue
    .catch(() => undefined)
    .then(() => writeFile(configPath, serialized, 'utf-8'))
  return saveQueue
}

export async function updateConfig(partial: Partial<AppConfig>): Promise<AppConfig> {
  const current = loadConfig()
  const updated: AppConfig = {
    ...current,
    ...partial,
    agentHooks: Object.prototype.hasOwnProperty.call(partial, 'agentHooks')
      ? normalizeAgentHookConfig(partial.agentHooks)
      : current.agentHooks,
  }
  updated.aiEnvironment = normalizeAiEnvironmentConfig(updated)
  await saveConfig(updated)
  return updated
}
