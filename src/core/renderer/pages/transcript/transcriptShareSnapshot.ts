import type { TranscriptShareImage } from '../../../shared/types'

export interface TranscriptShareSnapshotI18n {
  copied: string
  copyFailed: string
  transcriptRefDisabled: string
}

const SNAPSHOT_BASE_STYLE = `
  :root { color-scheme: light dark; }
  html, body {
    margin: 0;
    padding: 0;
    height: auto;
    min-height: 100%;
    overflow-x: hidden;
    overflow-y: auto;
  }
  body {
    /* Match the transcript preview surface instead of the app shell background. */
    background: var(--color-card-solid, #ffffff);
    color: var(--color-foreground, #1a1a1a);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .transcript-share-root {
    max-width: 980px;
    margin: 0 auto;
    padding: 0;
    box-sizing: border-box;
  }
  /* The app relies on an outer scroll container that the snapshot drops, so the
     content layer itself must scroll/flow normally here. */
  .transcript-share-root .code-markdown-content {
    overflow: visible;
    width: auto;
    min-width: 0;
    max-width: 100%;
  }
  .transcript-share-root [data-transcript-ref-disabled] {
    cursor: not-allowed;
  }
  .transcript-share-toast {
    position: fixed;
    left: 50%;
    bottom: 24px;
    transform: translateX(-50%);
    z-index: 10000;
    max-width: min(90vw, 520px);
    padding: 10px 14px;
    border-radius: 999px;
    background: rgba(15, 23, 42, 0.92);
    color: #ffffff;
    font-size: 12px;
    line-height: 1.4;
    box-shadow: 0 10px 32px rgba(15, 23, 42, 0.28);
  }
`

function buildSnapshotRuntimeScript(strings: TranscriptShareSnapshotI18n): string {
  return `
(() => {
  const STRINGS = ${JSON.stringify(strings)}

  const toastNode = document.querySelector('[data-transcript-share-toast]')

  if (!toastNode) {
    return
  }

  let toastTimer = 0

  function closestElement(target, selector) {
    return target instanceof Element ? target.closest(selector) : null
  }

  async function copyText(text) {
    if (!text) return false

    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text)
        return true
      } catch {}
    }

    try {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.setAttribute('readonly', '')
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      textarea.style.pointerEvents = 'none'
      textarea.style.left = '-9999px'
      document.body.appendChild(textarea)
      textarea.focus()
      textarea.select()
      const ok = typeof document.execCommand === 'function' ? document.execCommand('copy') : false
      textarea.remove()
      return ok
    } catch {
      return false
    }
  }

  function showToast(message) {
    window.clearTimeout(toastTimer)
    toastNode.textContent = message
    toastNode.hidden = false
    toastTimer = window.setTimeout(() => {
      toastNode.hidden = true
    }, 1800)
  }

  document.addEventListener('click', (event) => {
    const copyAction = closestElement(event.target, '.code-markdown-copy-btn')
    if (copyAction) {
      event.preventDefault()
      const wrap = copyAction.closest('.code-markdown-syntax-wrap')
      const codeNode = wrap?.querySelector('.code-markdown-syntax-block code, .code-markdown-plain-block code')
      void copyText(codeNode ? (codeNode.textContent || '') : '').then((copied) => {
        showToast(copied ? STRINGS.copied : STRINGS.copyFailed)
      })
      return
    }

    const disabledRef = closestElement(event.target, '[data-transcript-ref-disabled]')
    if (disabledRef) {
      event.preventDefault()
      showToast(STRINGS.transcriptRefDisabled)
    }
  })

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return
    }

    const activator = closestElement(event.target, '[data-transcript-ref-disabled]')
    if (!activator) {
      return
    }

    event.preventDefault()
    showToast(STRINGS.transcriptRefDisabled)
  })
})()
`
}

/**
 * Collect every readable CSS rule from the document's style sheets.
 * Cross-origin sheets throw on cssRules access — those are skipped.
 */
function collectDocumentCss(): string {
  const chunks: string[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList | null = null
    try {
      rules = sheet.cssRules
    } catch {
      rules = null
    }
    if (!rules) continue
    for (const rule of Array.from(rules)) {
      chunks.push(rule.cssText)
    }
  }
  return chunks.join('\n')
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function isTranscriptReferenceHref(value: string): boolean {
  return value.trim().toLowerCase().startsWith('transcript-ref://')
}

/**
 * Clone the rendered preview node, swap file:// image sources for placeholder tokens
 * (main inlines them as data URIs), and strip interactive-only artifacts.
 */
function buildSnapshotBody(sourceNode: HTMLElement): { html: string; images: TranscriptShareImage[] } {
  const clone = sourceNode.cloneNode(true) as HTMLElement
  const images: TranscriptShareImage[] = []

  clone.querySelectorAll('img').forEach((img, index) => {
    const src = img.getAttribute('src') || ''
    if (src.startsWith('file://')) {
      const placeholder = `__TRANSCRIPT_SHARE_IMG_${index}__`
      images.push({ placeholder, fileUrl: src })
      img.setAttribute('src', placeholder)
    } else if (src.startsWith('blob:')) {
      // Blob URLs are renderer-scoped and unreachable remotely; drop them.
      img.removeAttribute('src')
    }
    img.removeAttribute('loading')
  })

  clone.querySelectorAll('a').forEach((anchor) => {
    const href = anchor.getAttribute('href') || ''
    if (!isTranscriptReferenceHref(href)) return
    const replacement = document.createElement('span')
    replacement.className = anchor.className
    replacement.innerHTML = anchor.innerHTML
    replacement.setAttribute('data-transcript-ref-disabled', 'true')
    replacement.setAttribute('data-transcript-ref-href', href)
    replacement.setAttribute('tabindex', '0')
    replacement.setAttribute('role', 'button')
    anchor.replaceWith(replacement)
  })

  clone.querySelectorAll('.code-markdown-code-action-btn').forEach((node) => {
    node.remove()
  })

  return { html: clone.innerHTML, images }
}

export interface TranscriptShareSnapshot {
  html: string
  images: TranscriptShareImage[]
}

/**
 * Build a fully self-contained HTML document mirroring the current transcript preview.
 * @param previewNode  the scroll root that contains the rendered markdown article
 * @param title        document title shown in the browser tab
 */
export function buildTranscriptShareSnapshot(
  previewNode: HTMLElement,
  title: string,
  i18n: TranscriptShareSnapshotI18n
): TranscriptShareSnapshot {
  const article = previewNode.querySelector<HTMLElement>('.code-markdown-content') || previewNode
  const { html: bodyHtml, images } = buildSnapshotBody(article)
  const css = collectDocumentCss()
  const runtimeScript = buildSnapshotRuntimeScript(i18n)
  const themeMode = document.documentElement.getAttribute('data-theme-mode') || 'system'
  const theme = document.documentElement.getAttribute('data-theme') || 'light'
  const safeTitle = escapeHtmlAttribute(title || 'Transcript')
  // Drop classes that depend on the app's outer scroll container (kept out of the snapshot).
  const articleClass = (article.getAttribute('class') || 'code-markdown-content')
    .split(/\s+/)
    .filter((name) => name && name !== 'code-markdown-content--viewport-scroll')
    .join(' ') || 'code-markdown-content'

  const html = `<!doctype html>
<html lang="zh" data-theme="${escapeHtmlAttribute(theme)}" data-theme-mode="${escapeHtmlAttribute(themeMode)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${safeTitle}</title>
<style>${css}</style>
<style>${SNAPSHOT_BASE_STYLE}</style>
</head>
<body>
<main class="transcript-share-root">
<article class="${escapeHtmlAttribute(articleClass)}">${bodyHtml}</article>
</main>
<div class="transcript-share-toast" data-transcript-share-toast hidden></div>
<script>${runtimeScript}</script>
</body>
</html>`

  return { html, images }
}
