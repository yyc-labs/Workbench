import type { ProjectFileNodeKind } from '../../../shared/types'
import { joinProjectPath, splitRelativePath } from '../../lib/projectPaths'

export function normalizeRelativePathForCopy(relativePath: string): string {
  return splitRelativePath(relativePath).join('/')
}

export function removeRelativePathSlashes(relativePath: string): string {
  return normalizeRelativePathForCopy(relativePath).replace(/[\\/]/g, '')
}

export function resolveFileParentFolderPath(projectRootPath: string, relativePath: string): string {
  const segments = splitRelativePath(relativePath)
  if (segments.length <= 1) return projectRootPath
  return joinProjectPath(projectRootPath, segments.slice(0, -1).join('/'))
}

export function resolveTreeNodeFolderPath(projectRootPath: string, relativePath: string, nodeKind: ProjectFileNodeKind): string {
  return nodeKind === 'directory' ? joinProjectPath(projectRootPath, relativePath) : resolveFileParentFolderPath(projectRootPath, relativePath)
}

/** 项目路径 → 项目名（批量 zip 默认名 {项目名}-selected 与「打包中」toast 共用）。 */
export function projectNameFromPath(projectPath: string): string {
  const segments = projectPath
    .trim()
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .filter(Boolean)
  return segments.length > 0 ? segments[segments.length - 1] : ''
}

/** 批量 zip 的默认文件名：{项目名}-selected（无项目路径时回退 selected.zip，与主进程 defaultSelectedZipName 同语义）。 */
export function defaultSelectedZipName(projectPath: string): string {
  const projectName = projectNameFromPath(projectPath)
  return projectName ? `${projectName}-selected.zip` : 'selected.zip'
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
