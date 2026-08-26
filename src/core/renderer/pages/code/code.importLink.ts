import type { Uri } from 'monaco-editor'

export const IMPORT_EXTENSION_CANDIDATES = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.json', '.css', '.scss', '.less', '.html', '.md', '.mdc'] as const

// 匹配引号（单/双/反引号）内以 ./ 或 ../ 开头的相对路径。
export const IMPORT_RELATIVE_PATH_PATTERN = /['"`](\.\.?\/[^'"`\s]*)['"`]/g

export interface RelativeImportMatch {
  importPath: string
  startColumn: number
  endColumn: number
}

export function extractRelativeImportRanges(lineText: string): RelativeImportMatch[] {
  const matches: RelativeImportMatch[] = []
  IMPORT_RELATIVE_PATH_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = IMPORT_RELATIVE_PATH_PATTERN.exec(lineText)) !== null) {
    const importPath = match[1]
    if (!importPath) continue
    if (!(importPath.startsWith('./') || importPath.startsWith('../'))) continue

    const pathStart = match.index + 1
    matches.push({
      importPath,
      startColumn: pathStart + 1,
      endColumn: pathStart + 1 + importPath.length,
    })
  }
  return matches
}

function dirnameFromRelativePath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/')
  const idx = normalized.lastIndexOf('/')
  return idx < 0 ? '' : normalized.slice(0, idx)
}

function normalizeRelativePath(value: string): string {
  const segments = value.replace(/\\/g, '/').split('/')
  const result: string[] = []
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (result.length > 0 && result[result.length - 1] !== '..') {
        result.pop()
      } else {
        result.push('..')
      }
    } else {
      result.push(segment)
    }
  }
  return result.join('/')
}

export function resolveImportTarget(currentFileRelativePath: string, importPath: string): string {
  const dir = dirnameFromRelativePath(currentFileRelativePath)
  const joined = dir ? `${dir}/${importPath}` : importPath
  return normalizeRelativePath(joined)
}

function hasKnownExtension(importPath: string): boolean {
  return /\.[A-Za-z0-9]+$/.test(importPath)
}

export function resolveImportCandidatePaths(currentFileRelativePath: string, importPath: string): string[] {
  const base = resolveImportTarget(currentFileRelativePath, importPath)
  if (hasKnownExtension(importPath)) {
    return [base]
  }

  const candidates: string[] = []
  for (const ext of IMPORT_EXTENSION_CANDIDATES) {
    candidates.push(`${base}${ext}`)
  }
  for (const ext of IMPORT_EXTENSION_CANDIDATES) {
    candidates.push(`${base}/index${ext}`)
  }
  return candidates
}

export function resolveFilePathFromModelUri(uri: Uri): string | null {
  if (uri.scheme !== 'file') return null
  try {
    const path = decodeURIComponent(uri.path).replace(/^\/+/, '')
    return path || null
  } catch {
    return uri.path.replace(/^\/+/, '') || null
  }
}
