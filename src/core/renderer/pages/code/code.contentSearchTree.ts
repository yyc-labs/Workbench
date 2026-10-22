import type { ProjectFileContentMatch, ProjectFileContentSearchResult } from '../../../shared/types'

/**
 * 全局搜索结果的目录树纯逻辑。
 *
 * 节点结构与 ProjectFileNode 保持结构兼容（kind: 'directory' | 'file'、
 * name / relativePath / children），使搜索结果可直接交给 CodeFileTree 渲染，
 * 与文件树共用同一套选择、右键菜单、批量复制与展开交互；文件节点额外携带
 * matchCount / matches 供悬浮命中卡片消费。
 */

export interface ContentSearchDirectoryTreeNode {
  name: string
  relativePath: string
  kind: 'directory'
  children: ContentSearchTreeNode[]
}

export interface ContentSearchFileTreeNode {
  name: string
  relativePath: string
  kind: 'file'
  matchCount: number
  matches: ProjectFileContentMatch[]
}

export type ContentSearchTreeNode = ContentSearchDirectoryTreeNode | ContentSearchFileTreeNode

function directorySegmentsOf(relativePath: string): string[] {
  const segments = relativePath.split('/')
  return segments.slice(0, -1)
}

/** 所有命中文件的最深公共目录（共同祖先），作为目录树根；无公共目录时返回 ''。 */
export function findCommonAncestorDirectory(relativePaths: string[]): string {
  if (relativePaths.length === 0) return ''
  let common = directorySegmentsOf(relativePaths[0])
  for (const relativePath of relativePaths.slice(1)) {
    const segments = directorySegmentsOf(relativePath)
    let shared = 0
    while (shared < common.length && shared < segments.length && common[shared] === segments[shared]) {
      shared += 1
    }
    common = common.slice(0, shared)
  }
  return common.join('/')
}

function segmentDepth(relativePath: string): number {
  return relativePath.split('/').length
}

function sortTreeChildren(nodes: ContentSearchTreeNode[]): void {
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  for (const node of nodes) {
    if (node.kind === 'directory') sortTreeChildren(node.children)
  }
}

/**
 * 把扁平搜索结果组装为目录树：以全部命中文件的最深公共目录为根（head，根节点
 * label 即完整路径），其下按文件夹层级挂载命中文件；目录在前、文件在后按名称排序。
 */
export function buildContentSearchTreeData(files: ProjectFileContentSearchResult[]): ContentSearchTreeNode[] {
  if (files.length === 0) return []

  const head = findCommonAncestorDirectory(files.map((file) => file.relativePath))
  const headDepth = head.length > 0 ? segmentDepth(head) : 0

  const folderPaths = new Set<string>()
  for (const file of files) {
    const segments = file.relativePath.split('/')
    for (let depth = headDepth + 1; depth <= segments.length - 1; depth += 1) {
      folderPaths.add(segments.slice(0, depth).join('/'))
    }
  }

  const folderNodes = new Map<string, ContentSearchDirectoryTreeNode>()
  if (head.length > 0) {
    folderNodes.set(head, { name: head, relativePath: head, kind: 'directory', children: [] })
  }
  const sortedFolderPaths = [...folderPaths].sort((a, b) => segmentDepth(a) - segmentDepth(b) || a.localeCompare(b))
  for (const folderPath of sortedFolderPaths) {
    const segments = folderPath.split('/')
    folderNodes.set(folderPath, { name: segments[segments.length - 1], relativePath: folderPath, kind: 'directory', children: [] })
  }

  const topLevelNodes: ContentSearchTreeNode[] = []
  const parentFolderOf = (directoryPath: string): ContentSearchDirectoryTreeNode | null => (directoryPath.length > 0 ? (folderNodes.get(directoryPath) ?? null) : null)

  for (const file of files) {
    const parentPath = directorySegmentsOf(file.relativePath).join('/')
    const fileNode: ContentSearchFileTreeNode = {
      name: file.name,
      relativePath: file.relativePath,
      kind: 'file',
      matchCount: file.matchCount,
      matches: file.matches,
    }
    const parentFolder = parentFolderOf(parentPath)
    if (parentFolder) parentFolder.children.push(fileNode)
    else topLevelNodes.push(fileNode)
  }

  for (const folderPath of sortedFolderPaths) {
    const folderNode = folderNodes.get(folderPath)
    if (!folderNode) continue
    const parentPath = directorySegmentsOf(folderPath).join('/')
    const parentFolder = parentFolderOf(parentPath)
    if (parentFolder) parentFolder.children.push(folderNode)
    else topLevelNodes.push(folderNode)
  }

  const headNode = head.length > 0 ? (folderNodes.get(head) ?? null) : null
  if (headNode) {
    sortTreeChildren(headNode.children)
    return [headNode]
  }

  sortTreeChildren(topLevelNodes)
  return topLevelNodes
}
