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

// ── 命中行显示窗口（悬浮卡片） ─────────────────────────────

/** 命中行可见窗口的目标宽度（等宽单位：ASCII 记 1，CJK/全角记 2）。 */
const MATCH_WINDOW_UNITS = 60

function charWeight(character: string): number {
  const code = character.codePointAt(0) ?? 0
  // CJK 部首起（含全角标点、CJK、emoji）按 2 个单位计，其余记 1。
  return code >= 0x2e80 ? 2 : 1
}

function weightedLength(text: string, start: number, end: number): number {
  let units = 0
  for (let index = start; index < end; index += 1) {
    units += charWeight(text[index])
  }
  return units
}

export interface MatchLineDisplay {
  text: string
  ellipsisBefore: boolean
  ellipsisAfter: boolean
  /** 匹配文字在 text 中的起止偏移（相对位置，始终落在 [0, text.length] 内）。 */
  matchStart: number
  matchEnd: number
}

/**
 * 命中行开窗：整行放得下时原样展示；放不下时以匹配文字为中心截取窗口，
 * 前后被裁掉的部分以省略号标记（匹配文字一定落在可见窗口内）。
 * column / endColumn 为 1 基字符位置，超出 lineText 长度时按行尾兜底。
 */
export function buildMatchLineDisplay(match: ProjectFileContentMatch): MatchLineDisplay {
  const line = match.lineText
  const matchStart = Math.min(Math.max(0, match.column - 1), line.length)
  const matchEnd = Math.min(line.length, Math.max(matchStart + 1, match.endColumn - 1))

  if (weightedLength(line, 0, line.length) <= MATCH_WINDOW_UNITS) {
    return { text: line, ellipsisBefore: false, ellipsisAfter: false, matchStart, matchEnd }
  }

  // 前后上下文尽量均分剩余预算，使匹配文字居于窗口中间。
  const contextUnits = Math.max(0, Math.floor((MATCH_WINDOW_UNITS - weightedLength(line, matchStart, matchEnd)) / 2))
  let windowStart = matchStart
  let beforeUnits = 0
  while (windowStart > 0 && beforeUnits < contextUnits) {
    windowStart -= 1
    beforeUnits += charWeight(line[windowStart])
  }

  let windowEnd = matchEnd
  let usedUnits = weightedLength(line, windowStart, windowEnd)
  while (windowEnd < line.length) {
    const nextUnits = charWeight(line[windowEnd])
    if (usedUnits + nextUnits > MATCH_WINDOW_UNITS) break
    usedUnits += nextUnits
    windowEnd += 1
  }

  return {
    text: line.slice(windowStart, windowEnd),
    ellipsisBefore: windowStart > 0,
    ellipsisAfter: windowEnd < line.length,
    matchStart: matchStart - windowStart,
    matchEnd: matchEnd - windowStart,
  }
}
