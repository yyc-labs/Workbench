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

export function splitRelativePath(relativePath: string): string[] {
  return relativePath
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
}

function trimTrailingPathSeparators(pathValue: string): string {
  const trimmed = pathValue.trim()
  if (!trimmed) return ''
  if (/^[A-Za-z]:[\\/]+$/.test(trimmed)) {
    return `${trimmed.slice(0, 2)}\\`
  }
  return trimmed.replace(/[\\/]+$/, '')
}

export function joinProjectPath(projectRootPath: string, relativePath: string): string {
  const normalizedRoot = trimTrailingPathSeparators(projectRootPath)
  const segments = splitRelativePath(relativePath)
  if (segments.length === 0) return normalizedRoot || projectRootPath

  const separator = normalizedRoot.includes('\\') ? '\\' : '/'
  const joined = segments.join(separator)
  if (!normalizedRoot) return joined
  return normalizedRoot.endsWith(separator) ? `${normalizedRoot}${joined}` : `${normalizedRoot}${separator}${joined}`
}

export function fileNameFromRelativePath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/')
  const segments = normalized.split('/')
  return segments[segments.length - 1] || relativePath
}
