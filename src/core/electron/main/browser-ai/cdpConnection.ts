import http from 'http'
import type { Browser, BrowserContext } from 'playwright-core'
import { chromium } from 'playwright-core'

export type BrowserAiCdpConnection = {
  browser: Browser
  context: BrowserContext
  port: number
}

function cdpEndpoint(host: string, port: number): string {
  return `http://${host}:${port}`
}

export async function probeCdp(host: string, port: number, timeoutMs = 1_500): Promise<boolean> {
  return new Promise((resolve) => {
    const request = http.get(
      {
        host,
        port,
        path: '/json/version',
        timeout: timeoutMs,
      },
      (response) => {
        response.resume()
        response.once('end', () => resolve((response.statusCode ?? 500) >= 200 && (response.statusCode ?? 500) < 300))
      },
    )
    request.once('timeout', () => {
      request.destroy()
      resolve(false)
    })
    request.once('error', () => resolve(false))
  })
}

export async function connectOverCdp(
  host: string,
  port: number,
  options?: { timeoutMs?: number; attempts?: number },
): Promise<BrowserAiCdpConnection> {
  const attempts = Math.max(1, options?.attempts ?? 12)
  const timeoutMs = Math.max(200, options?.timeoutMs ?? 1_000)
  let lastError: unknown = null

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const browser = await chromium.connectOverCDP(cdpEndpoint(host, port), { timeout: timeoutMs })
      const context = browser.contexts()[0]
      if (!context) {
        await browser.close().catch(() => undefined)
        throw new Error('CDP connected without a browser context.')
      }
      return { browser, context, port }
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Unable to connect over CDP.')
}

export async function disconnectFromCdp(browser: Browser | null): Promise<void> {
  if (!browser || !browser.isConnected()) return
  await browser.close().catch(() => undefined)
}

