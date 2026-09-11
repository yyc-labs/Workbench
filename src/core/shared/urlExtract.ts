/**
 * Shared URL extraction from process terminal output. Used by both the
 * renderer (persisting per-process URLs for UI display) and the main-process
 * run-task scheduler (url readiness strategy) so both sides agree on what
 * counts as a dev-server URL.
 */

const URL_PATTERN = /https?:\/\/[\w.-]+:\d{2,5}/gi

/** Strip ANSI escape sequences before matching. */
export function stripAnsiEscapes(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '')
}

export function collectUrlsFromText(text: string): string[] {
  const clean = stripAnsiEscapes(text)
  const matches = clean.match(URL_PATTERN)
  return matches ? [...new Set(matches)] : []
}

/** Find the first URL matching an optional custom pattern (string regex). */
export function findFirstUrl(text: string, urlPattern?: string): string | null {
  const clean = stripAnsiEscapes(text)
  if (urlPattern) {
    try {
      const match = new RegExp(urlPattern, 'i').exec(clean)
      if (match) return match[0]
    } catch {
      // fall through to default extraction for invalid user regexes
    }
  }
  const urls = collectUrlsFromText(clean)
  return urls.length > 0 ? (urls[0] ?? null) : null
}
