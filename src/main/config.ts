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
  runtimeLauncherScript: '$HOME/tools/claude-code-script/start-claude-with-env.sh',
  aiCommit: {
    enabled: true,
    apiBaseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
  },
}

let cachedConfig: AppConfig | undefined

export function loadConfig(): AppConfig {
  if (cachedConfig) return cachedConfig

  const configPath = getConfigPath()
  try {
    const raw = readFileSync(configPath, 'utf-8')
    cachedConfig = { ...DEFAULT_CONFIG, ...JSON.parse(raw) }
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
