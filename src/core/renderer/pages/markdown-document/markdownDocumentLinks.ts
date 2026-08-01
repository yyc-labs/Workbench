const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown'])

function normalizeSegments(value: string): string[] {
  const segments: string[] = []
  for (const segment of value.replace(/\\/g, '/').split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') segments.pop()
    else segments.push(segment)
  }
  return segments
}

export function resolveMarkdownDocumentLink(href: string, activePath: string): string | null {
  const raw = href.trim().split(/[?#]/, 1)[0]?.replace(/\\/g, '/') ?? ''
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return null
  }
  if (!decoded || decoded.startsWith('/') || decoded.startsWith('//') || /^[A-Za-z]:[\\/]/.test(decoded) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(decoded)) return null
  const activeSegments = activePath.replace(/\\/g, '/').split('/')
  activeSegments.pop()
  const baseSegments = normalizeSegments(activeSegments.join('/'))
  const resolvedSegments = normalizeSegments([...baseSegments, decoded].join('/'))
  if (resolvedSegments.slice(0, baseSegments.length).join('/').toLowerCase() !== baseSegments.join('/').toLowerCase()) return null
  const resolved = resolvedSegments.join('/')
  const extension = resolved.slice(resolved.lastIndexOf('.')).toLowerCase()
  return MARKDOWN_EXTENSIONS.has(extension) ? resolved : null
}
