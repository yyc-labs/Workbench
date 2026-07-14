import { normalizeBrowserAiConfig } from './browserAiConfig'
import type { BrowserAiConfig } from '../../../shared/types'

export interface BrowserAiRepository {
  getConfig: () => BrowserAiConfig
  saveConfig: (config: BrowserAiConfig) => Promise<BrowserAiConfig>
}

export function createBrowserAiRepository(deps: {
  loadConfig: () => BrowserAiConfig | undefined
  saveConfig: (config: BrowserAiConfig) => Promise<BrowserAiConfig>
}): BrowserAiRepository {
  return {
    getConfig: () => normalizeBrowserAiConfig(deps.loadConfig()),
    saveConfig: (config) => deps.saveConfig(normalizeBrowserAiConfig(config)),
  }
}

