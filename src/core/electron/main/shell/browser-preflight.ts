import { execFile, spawn } from 'child_process'
import { openExternalUrl } from './openers'

const BROWSER_CHECK_TIMEOUT_MS = 4_000
const BROWSER_READY_TIMEOUT_MS = 20_000
const BROWSER_READY_POLL_INTERVAL_MS = 500

export type DefaultBrowserInfo = {
  progId: string
  processName: string
  exePath: string | null
}

export function parseProgIdFromRegOutput(output: string): string | null {
  const match = output.match(/ProgId\s+REG_SZ\s+(\S+)/i)
  return match ? match[1] : null
}

export function parseBrowserExePathFromRegOutput(output: string): string | null {
  const quoted = output.match(/"([^"]+\.exe)"/i)
  if (quoted) return quoted[1]
  // Unquoted command values allow spaces in the path; stop at the first
  // `.exe` followed by an argument boundary (`--`, `%1`, a quote, or EOL).
  const unquoted = output.match(/([A-Za-z]:\\[^\n]+?\.exe)(?=\s*(?:--|%1\b|")|\s*$)/i)
  return unquoted ? unquoted[1] : null
}

export function parseProcessNameFromExePath(exePath: string): string {
  const normalized = exePath.replace(/\//g, '\\')
  const lastSegment = normalized.split('\\').pop() ?? ''
  return lastSegment.toLowerCase()
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function execCommandOutput(command: string, args: string[], timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(command, args, { windowsHide: true, timeout: timeoutMs, encoding: 'utf8' }, (_error, stdout) => {
      const text = String(stdout ?? '').trim()
      resolve(text ? text : null)
    })
  })
}

/** Resolve the http default browser via registry: UserChoice ProgId -> HKCR open command. */
async function probeDefaultBrowser(): Promise<DefaultBrowserInfo | null> {
  if (process.platform !== 'win32') return null

  const userChoice = await execCommandOutput('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice', '/v', 'ProgId'], BROWSER_CHECK_TIMEOUT_MS)
  const progId = userChoice ? parseProgIdFromRegOutput(userChoice) : null
  if (!progId) return null

  const commandOutput = await execCommandOutput('reg', ['query', `HKCR\\${progId}\\shell\\open\\command`, '/ve'], BROWSER_CHECK_TIMEOUT_MS)
  const exePath = commandOutput ? parseBrowserExePathFromRegOutput(commandOutput) : null
  if (!exePath) return null

  return { progId, processName: parseProcessNameFromExePath(exePath), exePath }
}

let cachedBrowserInfo: DefaultBrowserInfo | null | undefined

export async function resolveDefaultBrowser(): Promise<DefaultBrowserInfo | null> {
  if (cachedBrowserInfo === undefined) {
    cachedBrowserInfo = await probeDefaultBrowser()
  }
  return cachedBrowserInfo
}

/** `tasklist` image-name probe: the output lists matching images only when one is running. */
export async function isBrowserProcessRunning(processName: string, timeoutMs = BROWSER_CHECK_TIMEOUT_MS): Promise<boolean> {
  const output = await execCommandOutput('tasklist', ['/FI', `IMAGENAME eq ${processName}`, '/NH', '/FO', 'CSV'], timeoutMs)
  return Boolean(output && output.toLowerCase().includes(processName))
}

function spawnDetachedBrowser(exePath: string, url: string): boolean {
  try {
    const child = spawn(exePath, [url], { detached: true, windowsHide: true, stdio: 'ignore' })
    child.on('error', () => undefined)
    child.unref()
    return true
  } catch {
    return false
  }
}

async function waitForBrowserProcess(processName: string): Promise<boolean> {
  const deadline = Date.now() + BROWSER_READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    await sleep(BROWSER_READY_POLL_INTERVAL_MS)
    if (await isBrowserProcessRunning(processName)) return true
  }
  return false
}

/**
 * Open a URL in the system browser with a Docker-style preflight:
 * probe whether the default browser is running; on a cold start, launch the
 * browser executable directly with the URL (bypassing the flaky
 * ShellExecute/DDE handshake) and poll until the process is up, falling back
 * to `openExternalUrl` when probing or direct launch is not possible.
 */
export async function openExternalUrlWithBrowserPreflight(url: string): Promise<void> {
  const isHttpUrl = /^https?:\/\//i.test(url)
  const browser = isHttpUrl && process.platform === 'win32' ? await resolveDefaultBrowser() : null

  if (!browser) {
    await openExternalUrl(url)
    return
  }

  if (await isBrowserProcessRunning(browser.processName)) {
    await openExternalUrl(url)
    return
  }

  if (browser.exePath) {
    spawnDetachedBrowser(browser.exePath, url)
    if (await waitForBrowserProcess(browser.processName)) {
      return
    }
    console.warn(`[open-external] browser cold start timed out for "${browser.processName}", falling back to openExternal`)
  }

  await openExternalUrl(url)
  await waitForBrowserProcess(browser.processName)
}
