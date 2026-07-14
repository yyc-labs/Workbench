import type { Page } from 'playwright-core'
import type { BrowserAiSite } from '../../../../shared/types'

export type BrowserAiLoginState = 'logged-in' | 'needs-login' | 'unknown'

export interface BrowserAiSiteAdapter {
  site: BrowserAiSite
  matchesPage: (url: string, configuredUrl?: string) => boolean
  detectLoginState: (page: Page) => Promise<BrowserAiLoginState>
  openNewConversation: (page: Page, siteUrl: string) => Promise<void>
  submitPrompt: (page: Page, prompt: string) => Promise<void>
  waitForCompletion: (page: Page, timeoutMs: number, isCancelled?: () => boolean) => Promise<void>
  readAnswer: (page: Page) => Promise<string>
}
