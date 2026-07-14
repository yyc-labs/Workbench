import type { Locator, Page } from 'playwright-core'
import type { BrowserAiSite } from '../../../../shared/types'
import type { BrowserAiSiteAdapter, BrowserAiLoginState } from './browserAiSiteAdapter'
import { isSupportedChatGptSiteUrl } from '../browserAiConfig'

const LOGIN_TEXT_PATTERN = /\b(log in|login|sign up|create account)\b/i
const SITE_ERROR_PATTERN = /(something went wrong|network error|too many requests|rate limit|quota|capacity|try again later)/i

function isPageClosed(page: Page): boolean {
  return page.isClosed()
}

async function isVisible(locator: Locator): Promise<boolean> {
  try {
    return await locator.first().isVisible({ timeout: 450 })
  } catch {
    return false
  }
}

async function findVisibleLocator(page: Page, locators: Locator[]): Promise<Locator | null> {
  for (const locator of locators) {
    if (await isVisible(locator)) return locator.first()
  }
  return null
}

function composerLocators(page: Page): Locator[] {
  return [
    page.getByRole('textbox', { name: /message|prompt|ask/i }),
    page.locator('textarea[placeholder*="Message" i]'),
    page.locator('textarea[placeholder*="Ask" i]'),
    page.locator('div[contenteditable="true"]'),
    page.locator('textarea'),
  ]
}

async function findComposer(page: Page): Promise<Locator | null> {
  return findVisibleLocator(page, composerLocators(page))
}

async function bodyText(page: Page): Promise<string> {
  try {
    return await page.locator('body').innerText({ timeout: 1_000 })
  } catch {
    return ''
  }
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function isGenerating(page: Page): Promise<boolean> {
  return Boolean(await findVisibleLocator(page, [
    page.getByRole('button', { name: /stop generating|stop streaming/i }),
    page.locator('button[data-testid*="stop" i]'),
  ]))
}

async function lastAssistantText(page: Page): Promise<string> {
  const candidates = [
    page.locator('[data-message-author-role="assistant"]'),
    page.locator('[data-testid*="conversation-turn" i]'),
    page.locator('main article'),
  ]
  for (const locator of candidates) {
    try {
      const count = await locator.count()
      if (!count) continue
      const text = (await locator.nth(count - 1).innerText({ timeout: 1_000 })).trim()
      if (text) return text
    } catch {
      // The page may replace a streaming node while it is being sampled.
    }
  }
  return ''
}

function createAdapter(): BrowserAiSiteAdapter {
  return {
    site: 'chatgpt-web' satisfies BrowserAiSite,

    matchesPage: (url) => isSupportedChatGptSiteUrl(url),

    detectLoginState: async (page): Promise<BrowserAiLoginState> => {
      if (!createAdapter().matchesPage(page.url())) return 'unknown'
      const composer = await findComposer(page)
      if (composer) return 'logged-in'

      const loginControl = await findVisibleLocator(page, [
        page.getByRole('button', { name: LOGIN_TEXT_PATTERN }),
        page.getByRole('link', { name: LOGIN_TEXT_PATTERN }),
        page.locator('input[type="email"]'),
      ])
      if (loginControl || LOGIN_TEXT_PATTERN.test(await bodyText(page))) return 'needs-login'
      return 'unknown'
    },

    openNewConversation: async (page, siteUrl) => {
      if (isPageClosed(page)) throw new Error('Browser page was closed.')
      if (!isSupportedChatGptSiteUrl(siteUrl)) throw new Error('The configured ChatGPT site URL is not supported.')
      await page.goto(siteUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined)
      const newConversation = await findVisibleLocator(page, [
        page.getByRole('link', { name: /new chat|new conversation/i }),
        page.getByRole('button', { name: /new chat|new conversation/i }),
      ])
      if (newConversation && /\/c\//.test(page.url())) {
        await newConversation.click()
        await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined)
      }
    },

    submitPrompt: async (page, prompt) => {
      const composer = await findComposer(page)
      if (!composer) throw new Error('ChatGPT message composer was not found.')
      try {
        await composer.fill(prompt)
      } catch {
        await composer.click()
        await page.keyboard.insertText(prompt)
      }

      const sendButton = await findVisibleLocator(page, [
        page.getByRole('button', { name: /^send$|send message|submit/i }),
        page.locator('button[aria-label*="send" i]'),
        page.locator('button[data-testid*="send" i]'),
      ])
      if (sendButton) {
        await sendButton.click()
        return
      }
      await composer.press('Enter')
    },

    waitForCompletion: async (page, timeoutMs, isCancelled) => {
      const deadline = Date.now() + timeoutMs
      let previous = ''
      let stableSince = 0
      let sawAssistantText = false

      while (Date.now() < deadline) {
        if (isCancelled?.()) throw new Error('Browser AI task was cancelled.')
        if (isPageClosed(page)) throw new Error('Browser page was closed.')

        const text = await bodyText(page)
        if (SITE_ERROR_PATTERN.test(text)) {
          throw new Error('ChatGPT reported a site or quota error.')
        }
        const loginState = await createAdapter().detectLoginState(page)
        if (loginState === 'needs-login') throw new Error('ChatGPT login is required.')

        const answer = await lastAssistantText(page)
        if (answer) {
          sawAssistantText = true
          if (answer === previous) {
            stableSince ||= Date.now()
          } else {
            previous = answer
            stableSince = Date.now()
          }
        }

        if (sawAssistantText && stableSince > 0 && Date.now() - stableSince >= 1_800 && !(await isGenerating(page))) {
          return
        }
        await wait(350)
      }

      throw new Error(sawAssistantText ? 'ChatGPT response did not stabilize before timeout.' : 'ChatGPT response timed out.')
    },

    readAnswer: async (page) => lastAssistantText(page),
  }
}

export const chatgptAdapter = createAdapter()
