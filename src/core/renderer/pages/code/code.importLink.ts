import type { Uri } from 'monaco-editor'
import { normalizeMonacoCachePath } from './monacoModelCache'

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

export function resolveFilePathFromModelUri(uri: Uri, projectPath?: string | null): string | null {
  if (uri.scheme !== 'file') return null
  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(uri.path)
  } catch {
    decodedPath = uri.path
  }
  let path = decodedPath.replace(/^\/+/, '')
  if (!path) return null

  // 模块级 Model 缓存的 URI 带有项目命名空间前缀，这里剥离后还原为项目内相对路径。
  if (projectPath) {
    // 与 createMonacoModelUri 保持一致：剥掉前导斜杠（WSL UNC 路径会以 // 开头）。
    const normalizedProject = normalizeMonacoCachePath(projectPath).replace(/^\/+/, '').replace(/\/+$/, '')
    if (normalizedProject && path.toLowerCase().startsWith(`${normalizedProject.toLowerCase()}/`)) {
      path = path.slice(normalizedProject.length + 1)
    }
  }
  return path || null
}
