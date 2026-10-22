import type { ChildProcess } from 'child_process'
import { execFile, spawn } from 'child_process'
import { openExternalUrl } from './openers'

const BROWSER_CHECK_TIMEOUT_MS = 4_000

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

/**
 * Launch the browser executable directly with the URL, resolving once the
 * child process has been created (`spawn` event). Showing the window and
 * loading the page are the browser's own job — the IPC caller is not held
 * back by `tasklist` polling or load progress.
 */
function launchBrowserProcess(exePath: string, url: string): Promise<boolean> {
  return new Promise((resolve) => {
    let child: ChildProcess
    try {
      child = spawn(exePath, [url], {
        detached: true,
        windowsHide: true,
        stdio: 'ignore',
      })
    } catch {
      resolve(false)
      return
    }

    // Each open request completes at most once: the first event wins, so a
    // late duplicate (e.g. an error after a successful spawn) cannot trigger
    // a second open attempt.
    let settled = false
    const settle = (ok: boolean) => {
      if (settled) return
      settled = true
      resolve(ok)
    }

    child.on('error', (err) => {
      console.error(`[open-external] failed to launch default browser exe="${exePath}" url="${url}" error=${err instanceof Error ? err.message : String(err)}`)
      settle(false)
    })
    child.on('spawn', () => {
      child.unref()
      settle(true)
    })
  })
}

/**
 * Open a URL in the system browser: when the http default browser is already
 * running, hand the URL over via `shell.openExternal`; on a cold start,
 * launch the resolved browser executable directly with the URL (bypassing the
 * flaky ShellExecute/DDE handshake) and return as soon as the child process
 * exists. Falls back to `openExternalUrl` (shell.openExternal, then
 * explorer.exe) whenever resolution or the direct launch is not possible.
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

  if (browser.exePath && (await launchBrowserProcess(browser.exePath, url))) {
    return
  }

  await openExternalUrl(url)
}
