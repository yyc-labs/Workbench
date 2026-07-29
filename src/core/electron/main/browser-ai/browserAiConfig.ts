import { existsSync } from 'fs'
import { join, resolve } from 'path'
import type { BrowserAiConfig, BrowserAiSiteProfile } from '../../../shared/types'

const DEFAULT_BROWSER_AI_SITE_ID = 'web-ai-default'
const DEFAULT_BROWSER_AI_SITE_NAME = 'Web AI'
const DEFAULT_BROWSER_AI_SITE_URL = ''

export const DEFAULT_BROWSER_AI_CONFIG: BrowserAiConfig = {
  enabled: true,
  mode: 'managed-edge',
  edgeExecutablePath: getDefaultEdgeExecutablePath(),
  cdpHost: '127.0.0.1',
  site: 'generic-web',
  siteUrl: DEFAULT_BROWSER_AI_SITE_URL,
  sites: [
    {
      id: DEFAULT_BROWSER_AI_SITE_ID,
      name: DEFAULT_BROWSER_AI_SITE_NAME,
      url: DEFAULT_BROWSER_AI_SITE_URL,
      site: 'generic-web',
    },
  ],
  activeSiteId: DEFAULT_BROWSER_AI_SITE_ID,
  keepBrowserRunning: true,
  headless: false,
  learningHeadless: true,
  responseTimeoutMs: 120_000,
}

const MIN_CDP_PORT = 1
const MAX_CDP_PORT = 65_535
const MIN_RESPONSE_TIMEOUT_MS = 10_000
const MAX_RESPONSE_TIMEOUT_MS = 10 * 60 * 1_000

function normalizeCdpPort(value: unknown): number | undefined {
  if (!Number.isFinite(value)) return undefined
  const port = Math.trunc(Number(value))
  return port >= MIN_CDP_PORT && port <= MAX_CDP_PORT ? port : undefined
}

function normalizeResponseTimeout(value: unknown): number {
  if (!Number.isFinite(value)) return DEFAULT_BROWSER_AI_CONFIG.responseTimeoutMs
  return Math.min(MAX_RESPONSE_TIMEOUT_MS, Math.max(MIN_RESPONSE_TIMEOUT_MS, Math.trunc(Number(value))))
}

export function normalizeBrowserAiConfig(input: unknown): BrowserAiConfig {
  const raw = input && typeof input === 'object' ? (input as Partial<BrowserAiConfig>) : {}
  const edgeExecutablePath = typeof raw.edgeExecutablePath === 'string' && raw.edgeExecutablePath.trim() ? resolve(raw.edgeExecutablePath.trim()) : DEFAULT_BROWSER_AI_CONFIG.edgeExecutablePath
  const legacySiteUrl = typeof raw.siteUrl === 'string' && raw.siteUrl.trim() ? raw.siteUrl.trim() : DEFAULT_BROWSER_AI_SITE_URL
  const legacySite = raw.site === 'chatgpt-web' && isSupportedChatGptSiteUrl(legacySiteUrl) ? 'chatgpt-web' : 'generic-web'
  const sites = normalizeBrowserAiSites(raw.sites, legacySiteUrl, legacySite)
  const activeSiteId = typeof raw.activeSiteId === 'string' && sites.some((site) => site.id === raw.activeSiteId) ? raw.activeSiteId : sites[0].id
  const activeSite = sites.find((site) => site.id === activeSiteId) ?? sites[0]

  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_BROWSER_AI_CONFIG.enabled,
    mode: raw.mode === 'external-cdp' ? 'external-cdp' : DEFAULT_BROWSER_AI_CONFIG.mode,
    edgeExecutablePath,
    cdpHost: '127.0.0.1',
    cdpPort: normalizeCdpPort(raw.cdpPort),
    site: activeSite.site,
    siteUrl: activeSite.url,
    sites,
    activeSiteId: activeSite.id,
    keepBrowserRunning: typeof raw.keepBrowserRunning === 'boolean' ? raw.keepBrowserRunning : DEFAULT_BROWSER_AI_CONFIG.keepBrowserRunning,
    headless: typeof raw.headless === 'boolean' ? raw.headless : DEFAULT_BROWSER_AI_CONFIG.headless,
    learningHeadless: typeof raw.learningHeadless === 'boolean' ? raw.learningHeadless : DEFAULT_BROWSER_AI_CONFIG.learningHeadless,
    responseTimeoutMs: normalizeResponseTimeout(raw.responseTimeoutMs),
  }
}

function normalizeBrowserAiSites(input: unknown, legacySiteUrl: string, legacySite: BrowserAiSiteProfile['site']): BrowserAiSiteProfile[] {
  const rawSites = Array.isArray(input) ? input : []
  const seenIds = new Set<string>()
  const sites = rawSites.flatMap((value, index): BrowserAiSiteProfile[] => {
    if (!value || typeof value !== 'object') return []
    const raw = value as Partial<BrowserAiSiteProfile>
    const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `browser-ai-site-${index + 1}`
    if (seenIds.has(id)) return []
    seenIds.add(id)
    const url = typeof raw.url === 'string' && raw.url.trim() ? raw.url.trim() : index === 0 ? legacySiteUrl : DEFAULT_BROWSER_AI_SITE_URL
    const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : index === 0 ? (legacySite === 'chatgpt-web' ? 'ChatGPT' : DEFAULT_BROWSER_AI_SITE_NAME) : `Web AI ${index + 1}`
    const site = raw.site === 'chatgpt-web' || (typeof raw.site !== 'string' && isSupportedChatGptSiteUrl(url)) ? 'chatgpt-web' : 'generic-web'
    return [{ id, name, url, site }]
  })

  return sites.length > 0
    ? sites
    : [
        {
          id: DEFAULT_BROWSER_AI_SITE_ID,
          name: legacySite === 'chatgpt-web' ? 'ChatGPT' : DEFAULT_BROWSER_AI_SITE_NAME,
          url: legacySiteUrl,
          site: legacySite,
        },
      ]
}

export function isSupportedBrowserAiSiteUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && Boolean(url.hostname)
  } catch {
    return false
  }
}

export function isSupportedChatGptSiteUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) return false
    const hostname = url.hostname.toLowerCase()
    return hostname === 'chatgpt.com' || hostname === 'www.chatgpt.com' || hostname === 'chat.openai.com'
  } catch {
    return false
  }
}

export function resolveBrowserAiProfilePath(userDataPath: string, profileName = 'edge-profile'): string {
  return join(resolve(userDataPath), 'browser-ai', profileName)
}

export function getDefaultEdgeExecutablePaths(env: NodeJS.ProcessEnv = process.env): string[] {
  const programFilesX86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
  const programFiles = env.ProgramFiles || 'C:\\Program Files'
  return [join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe')]
}

export function getDefaultEdgeExecutablePath(env: NodeJS.ProcessEnv = process.env): string {
  const candidates = getDefaultEdgeExecutablePaths(env)
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0] ?? ''
}

export function resolveEdgeExecutablePath(config: BrowserAiConfig, env: NodeJS.ProcessEnv = process.env): string | null {
  const candidates = [config.edgeExecutablePath, ...getDefaultEdgeExecutablePaths(env)].filter((candidate): candidate is string => Boolean(candidate)).map((candidate) => resolve(candidate))

  return candidates.find((candidate, index) => candidates.indexOf(candidate) === index && existsSync(candidate)) ?? null
}

export function buildEdgeLaunchArgs(config: BrowserAiConfig, cdpPort: number, profilePath: string): string[] {
  const args = ['--new-window', '--no-first-run', '--no-default-browser-check', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profilePath}`]
  if (config.headless) args.push('--headless=new')
  return args
}
