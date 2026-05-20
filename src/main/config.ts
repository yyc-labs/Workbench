import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import type { AppConfig } from '../shared/types'

const CONFIG_FILE = 'project-launcher-config.json'

function getConfigPath(): string {
  return join(app.getPath('userData'), CONFIG_FILE)
}

const DEFAULT_CONFIG: AppConfig = {
  projects: [],
  theme: 'system',
  folders: [],
  tags: [],
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
  },
}

let cachedConfig: AppConfig | undefined

export function loadConfig(): AppConfig {
  if (cachedConfig) return cachedConfig

  const configPath = getConfigPath()
  try {
    const raw = readFileSync(configPath, 'utf-8')
    const parsed = JSON.parse(raw) as AppConfig & { startupDefaultTagId?: string }
    const legacyStartupDefaultTagId = parsed.startupDefaultTagId
    cachedConfig = { ...DEFAULT_CONFIG, ...parsed }
    if (!cachedConfig.startupDefaultFilter && legacyStartupDefaultTagId) {
      cachedConfig.startupDefaultFilter = { type: 'tag', tagId: legacyStartupDefaultTagId }
    }
  } catch {
    cachedConfig = { ...DEFAULT_CONFIG }
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
