import { app, shell } from 'electron'

const APP_SCHEME = 'yyc-workbench://'

export type WindowOpenDecision = { action: 'allow' } | { action: 'deny'; openExternally: boolean }

/**
 * Decide how a `window.open` / `target="_blank"` popup should be handled:
 *
 * - `yyc-workbench://` stays in the app (project HTML previews rely on it),
 *   matching the pre-policy behavior where `allowpopups` opened the window.
 * - http(s) popups never spawn an Electron window — an untrusted preview page
 *   must not be able to open arbitrary (phishing) windows — and are handed to
 *   the system browser instead.
 * - Every other scheme is denied outright.
 */
export function resolveWindowOpenDecision(url: string): WindowOpenDecision {
  if (url.startsWith(APP_SCHEME)) return { action: 'allow' }
  if (url.startsWith('http://') || url.startsWith('https://')) return { action: 'deny', openExternally: true }
  return { action: 'deny', openExternally: false }
}

/**
 * Global popup policy for every WebContents the app creates (main windows,
 * webview guests, auxiliary windows). Must be registered before windows are
 * created so no guest can slip through without a handler.
 */
export function registerWebContentsSecurityPolicy(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      const decision = resolveWindowOpenDecision(url)
      if (decision.action === 'deny' && decision.openExternally) {
        void shell.openExternal(url).catch(() => undefined)
      }
      return { action: decision.action }
    })
  })
}
