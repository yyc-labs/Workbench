export function normalizePathForCompare(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/\/+$/, '')
}

/**
 * Convert an absolute selected path into a project-relative directory string
 * ('' means project root). Paths outside the project are returned unchanged.
 */
export function toProjectRelativeDirectory(projectPath: string, selectedPath: string): string {
  const root = normalizePathForCompare(projectPath)
  const selected = normalizePathForCompare(selectedPath)
  if (!selected) return ''
  if (selected === root) return ''

  const rootPrefix = `${root}/`
  if (selected.startsWith(rootPrefix)) return selected.slice(rootPrefix.length)

  const rootLowerPrefix = `${root.toLowerCase()}/`
  if (selected.toLowerCase().startsWith(rootLowerPrefix)) return selected.slice(rootPrefix.length)

  return selectedPath
}

export function resolveWorkingDirectoryPreview(projectPath: string, workingDirectory: string): string {
  const raw = workingDirectory.trim()
  if (!raw) return projectPath
  if (/^[a-z]:[\\/]/i.test(raw) || raw.startsWith('/') || raw.startsWith('\\\\') || raw.startsWith('//')) {
    return raw
  }
  return `${normalizePathForCompare(projectPath)}/${raw.replace(/^[\\/]+/, '').replace(/[\\/]+/g, '/')}`
}
