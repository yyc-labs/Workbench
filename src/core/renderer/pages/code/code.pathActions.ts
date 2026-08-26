import type { ProjectFileNodeKind } from '../../../shared/types'

function splitRelativePath(relativePath: string): string[] {
  return relativePath
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
}

export function normalizeRelativePathForCopy(relativePath: string): string {
  return splitRelativePath(relativePath).join('/')
}

export function removeRelativePathSlashes(relativePath: string): string {
  return normalizeRelativePathForCopy(relativePath).replace(/[\\/]/g, '')
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

export function resolveFileParentFolderPath(projectRootPath: string, relativePath: string): string {
  const segments = splitRelativePath(relativePath)
  if (segments.length <= 1) return projectRootPath
  return joinProjectPath(projectRootPath, segments.slice(0, -1).join('/'))
}

export function resolveTreeNodeFolderPath(projectRootPath: string, relativePath: string, nodeKind: ProjectFileNodeKind): string {
  return nodeKind === 'directory' ? joinProjectPath(projectRootPath, relativePath) : resolveFileParentFolderPath(projectRootPath, relativePath)
}

// 生成全局内容搜索的范围输入：目录节点搜索其自身，文件节点搜索其所在文件夹；根目录下的文件回退为全项目搜索。
export function resolveTreeNodeSearchScope(relativePath: string, nodeKind: ProjectFileNodeKind): string {
  const segments = splitRelativePath(relativePath)
  if (nodeKind === 'directory') {
    return segments.length > 0 ? `${segments.join('/')}/` : ''
  }
  if (segments.length <= 1) return ''
  return `${segments.slice(0, -1).join('/')}/`
}
