import type { TranscriptShareImage } from '../../../shared/types'

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
    background: var(--color-background, #f5f7fb);
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
`

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

  // Remove focus/role affordances that only make sense inside the app.
  clone.querySelectorAll('[role="button"][data-structured-block-kind]').forEach((node) => {
    node.removeAttribute('role')
    node.removeAttribute('tabindex')
    node.removeAttribute('aria-label')
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
  title: string
): TranscriptShareSnapshot {
  const article = previewNode.querySelector<HTMLElement>('.code-markdown-content') || previewNode
  const { html: bodyHtml, images } = buildSnapshotBody(article)
  const css = collectDocumentCss()
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
</body>
</html>`

  return { html, images }
}
