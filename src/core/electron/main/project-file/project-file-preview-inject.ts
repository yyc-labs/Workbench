/**
 * Preview bootstrap injection for `yyc-workbench://` HTML previews.
 *
 * The preview iframe is a standalone document: the IDE app's stylesheet tokens do
 * not cascade into it, so snippets that rely on `var(--font-sans)` (or similar
 * design-system variables) end up with invalid `font-family` and fall back to the
 * UA default font. This module injects a small fallback that defines the common
 * variables and asynchronously loads the Tabler icon webfont (CDN), so such
 * snippets render close to their intended look without changing the app itself.
 */

export const HTML_PREVIEW_BOOTSTRAP_MARKER = 'id="yyc-preview-bootstrap"'

export type HtmlPreviewTheme = 'light' | 'dark'

function buildPreviewBootstrapHtml(theme: HtmlPreviewTheme): string {
  const isDark = theme === 'dark'
  const background = isDark ? '#1c1c1e' : '#f5f5f7'
  const foreground = isDark ? '#f5f5f7' : '#1d1d1f'
  const card = isDark ? '#2c2c2e' : '#ffffff'
  const muted = isDark ? '#a1a1a6' : '#6e6e73'

  return [
    '<style ' + HTML_PREVIEW_BOOTSTRAP_MARKER + '>',
    ':root {',
    `  color-scheme: ${theme};`,
    '  --font-sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;',
    '  --font-mono: ui-monospace, "Cascadia Mono", "SF Mono", "Consolas", monospace;',
    `  --color-background: ${background};`,
    `  --color-card: ${card};`,
    `  --color-foreground: ${foreground};`,
    `  --color-text-primary: ${foreground};`,
    `  --color-text-secondary: ${muted};`,
    `  --color-text-tertiary: ${isDark ? '#73737a' : '#9ca3af'};`,
    '}',
    '</style>',
    '<script>!function(){let t=!1,n=0,o=0;const r=e=>{window.parent.postMessage({type:"preview:mouse-gesture",eventType:e.type,clientX:e.clientX,clientY:e.clientY,button:e.button,buttons:e.buttons,ctrlKey:e.ctrlKey,metaKey:e.metaKey,shiftKey:e.shiftKey,altKey:e.altKey},"*")};window.addEventListener("mousedown",e=>{if(2!==e.button)return;t=!1,n=e.clientX,o=e.clientY,r(e)},!0),window.addEventListener("mousemove",e=>{2&e.buttons&&(t||Math.hypot(e.clientX-n,e.clientY-o)>=8&&(t=!0),r(e))},!0),window.addEventListener("mouseup",e=>{2===e.button&&r(e)},!0),window.addEventListener("contextmenu",e=>{t&&e.preventDefault(),r(e),t=!1},!0)}();</script>',
    // Load the Tabler icon webfont asynchronously so a slow/offline CDN never
    // render-blocks the preview page.
    '<link rel="preload" as="style" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3/dist/tabler-icons.min.css" onload="this.onload=null;this.rel=\'stylesheet\'">',
    '<noscript><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3/dist/tabler-icons.min.css"></noscript>',
  ].join('\n')
}

export function isHtmlPreviewContentType(contentType: string): boolean {
  return /text\/html/i.test(contentType)
}

/**
 * Strict UTF-8 validation. A document whose bytes are not valid UTF-8 is almost
 * certainly encoded in a legacy code page (e.g. GBK on Chinese Windows); browsers
 * would decode it as UTF-8/Windows-1252 and render mojibake, while editors like
 * VS Code auto-detect the encoding and display it correctly.
 */
export function isValidUtf8(buffer: Buffer): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    return true
  } catch {
    return false
  }
}

/**
 * Byte-preserving injection for UTF-8 documents. Processes the buffer through a
 * latin1 mapping so bytes are never re-decoded. A charset declaration is placed
 * immediately after the DOCTYPE, where Chromium will find it during its initial
 * encoding scan.
 */
function injectIntoUtf8Document(buffer: Buffer, theme: HtmlPreviewTheme): Buffer {
  const source = buffer.toString('latin1')
  const lower = source.toLowerCase()
  const headEnd = lower.indexOf('</head>')
  const bodyStart = lower.indexOf('<body')
  let insertAt: number
  if (headEnd !== -1) {
    insertAt = headEnd
  } else if (bodyStart !== -1) {
    insertAt = bodyStart
  } else {
    // No <head>/<body>: keep any DOCTYPE first so the document stays in standards mode.
    const doctypeEnd = lower.match(/^\s*<!doctype[^>]*>/)?.[0].length ?? 0
    insertAt = doctypeEnd
  }

  const charsetDeclaration = '<meta charset="utf-8">\n'
  const doctypeEnd = lower.match(/^\s*<!doctype[^>]*>/)?.[0].length ?? 0
  const withCharset = `${source.slice(0, doctypeEnd)}\n${charsetDeclaration}${source.slice(doctypeEnd)}`
  const adjustedInsertAt = insertAt + charsetDeclaration.length + 1
  const injected = `${withCharset.slice(0, adjustedInsertAt)}${buildPreviewBootstrapHtml(theme)}\n${withCharset.slice(adjustedInsertAt)}`
  return Buffer.from(injected, 'latin1')
}

/**
 * Handles legacy-encoded documents (GBK/GB2312/GB18030): decodes to text,
 * re-encodes as UTF-8 and prepends `<meta charset="utf-8">` so the browser
 * decodes the transcoded content correctly.
 */
function injectIntoLegacyEncodedDocument(buffer: Buffer, theme: HtmlPreviewTheme): Buffer {
  const decoded = new TextDecoder('gb18030').decode(buffer)
  const utf8 = Buffer.from(decoded, 'utf8')
  const source = utf8.toString('utf8')
  const doctype = source.toLowerCase().match(/^\s*<!doctype[^>]*>/i)?.[0] ?? ''
  const rest = source.slice(doctype.length)
  const prefixed = `${doctype}\n<meta charset="utf-8">\n${buildPreviewBootstrapHtml(theme)}\n${rest}`
  return Buffer.from(prefixed, 'utf8')
}

/**
 * Inserts the preview bootstrap right before `</head>` (or before `<body>` /
 * after the DOCTYPE when the document has no head), so the fallback variables are
 * available to the whole page. Existing injections are skipped.
 *
 * Non-UTF-8 documents are transcoded to UTF-8 first so they do not render as
 * mojibake in the browser preview.
 */
export function injectHtmlPreviewBootstrap(buffer: Buffer, theme: HtmlPreviewTheme = 'light'): Buffer {
  if (buffer.toString('latin1').includes(HTML_PREVIEW_BOOTSTRAP_MARKER)) return buffer
  if (isValidUtf8(buffer)) return injectIntoUtf8Document(buffer, theme)
  return injectIntoLegacyEncodedDocument(buffer, theme)
}
