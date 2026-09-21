const MARKDOWN_EXTENSION_PATTERN = /\.(md|markdown)$/i

export function isMarkdownRelativePath(value: string): boolean {
  return MARKDOWN_EXTENSION_PATTERN.test(value)
}

/**
 * Resolve a markdown relative link target that may omit the extension or point
 * to a directory. Candidates are probed in order:
 *  1. the path itself (covers exact files, with or without extension)
 *  2. `<path>.md` / `<path>.markdown` (extensionless file links)
 *  3. `<path>/index.md` / `<path>/index.markdown` / `<path>/README.md` / `<path>/readme.md` (directory links)
 * Returns the first existing file's normalized project-relative path, or null.
 */
export async function resolveMarkdownLinkTarget(projectPath: string, relativePath: string): Promise<string | null> {
  const normalized = relativePath.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  if (!normalized || normalized.startsWith('/') || normalized.includes('..')) return null

  const candidates = [normalized]
  if (!MARKDOWN_EXTENSION_PATTERN.test(normalized)) {
    candidates.push(`${normalized}.md`, `${normalized}.markdown`, `${normalized}/index.md`, `${normalized}/index.markdown`, `${normalized}/README.md`, `${normalized}/readme.md`)
  }

  for (const candidate of candidates) {
    try {
      const stat = await window.electronAPI.statProjectFile(projectPath, candidate)
      if (stat?.relativePath) return stat.relativePath
    } catch {
      // Candidate does not exist (or is a directory) — probe the next one.
    }
  }
  return null
}
