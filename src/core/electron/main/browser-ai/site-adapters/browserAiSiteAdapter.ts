import type { Page } from 'playwright-core'
import type { BrowserAiSite } from '../../../../shared/types'
import type { BrowserAiTaskStep } from '../../../../shared/types'

export type BrowserAiLoginState = 'logged-in' | 'needs-login' | 'unknown'
export type BrowserAiAdapterStepUpdate = Pick<BrowserAiTaskStep, 'id' | 'status' | 'message' | 'detail' | 'elapsedMs'>

export interface BrowserAiSiteAdapter {
  site: BrowserAiSite
  matchesPage: (url: string, configuredUrl?: string) => boolean
  detectLoginState: (page: Page) => Promise<BrowserAiLoginState>
  openNewConversation: (page: Page, siteUrl: string) => Promise<void>
  submitPrompt: (page: Page, prompt: string, onStep?: (step: BrowserAiAdapterStepUpdate) => void) => Promise<void>
  waitForCompletion: (
    page: Page,
    timeoutMs: number,
    isCancelled?: () => boolean,
    onStep?: (step: BrowserAiAdapterStepUpdate) => void,
  ) => Promise<void>
  readAnswer: (page: Page) => Promise<string>
}
