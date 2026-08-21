import type { Dispatch, SetStateAction } from 'react'
import type { ProjectCodeSession, ProjectFileNode } from '../../../shared/types'
import { sortTreeNodes } from './code.helpers'
import type { CodeFileDrawerState } from './code.types'

export function sortProjectNodes(nodes: ProjectFileNode[]): ProjectFileNode[] {
  return sortTreeNodes(nodes)
}

export function mergeKnownFilePaths(previous: Set<string>, nodes: ProjectFileNode[]): Set<string> {
  const next = new Set(previous)
  const walk = (items: ProjectFileNode[]) => {
    for (const item of items) {
      if (item.isExcluded) continue
      if (item.kind === 'file') {
        next.add(item.relativePath)
        continue
      }
      if (item.children && item.children.length > 0) {
        walk(item.children)
      }
    }
  }
  walk(nodes)
  return next
}

type ReplaceDirectoryNodesOptions = {
  preserveLoadedDescendants?: boolean
}

function directoryPathSegments(relativePath: string): string[] {
  return relativePath
    .replace(/\\/g, '/')
    .split('/')
    .map((item) => item.trim())
    .filter(Boolean)
}

function createDirectoryBranch(segments: string[], depth: number, sortedChildren: ProjectFileNode[]): ProjectFileNode {
  const relativePath = segments.slice(0, depth + 1).join('/')
  const isTargetDirectory = depth === segments.length - 1
  const children = isTargetDirectory ? sortedChildren : [createDirectoryBranch(segments, depth + 1, sortedChildren)]

  return {
    name: segments[depth],
    relativePath,
    kind: 'directory',
    hasChildren: children.length > 0,
    isLoaded: isTargetDirectory,
    children,
  }
}

function mergeLoadedDirectoryChildren(nextChildren: ProjectFileNode[], previousChildren: ProjectFileNode[] | undefined, options: ReplaceDirectoryNodesOptions): ProjectFileNode[] {
  if (options.preserveLoadedDescendants === false) return sortProjectNodes(nextChildren)
  if (!previousChildren || previousChildren.length <= 0) return sortProjectNodes(nextChildren)

  const previousDirectories = new Map<string, ProjectFileNode>()
  for (const previousChild of previousChildren) {
    if (previousChild.kind === 'directory') {
      previousDirectories.set(previousChild.relativePath, previousChild)
    }
  }

  return sortProjectNodes(
    nextChildren.map((nextChild) => {
      if (nextChild.kind !== 'directory') return nextChild
      // 被排除的目录始终是叶子占位，不继承此前已加载的 children。
      if (nextChild.isExcluded) return nextChild

      const previousChild = previousDirectories.get(nextChild.relativePath)
      if (!previousChild || previousChild.kind !== 'directory') return nextChild

      const previousGrandChildren = previousChild.children ?? []
      if (previousGrandChildren.length <= 0) return nextChild

      if (previousChild.isLoaded) {
        return {
          ...nextChild,
          hasChildren: previousGrandChildren.length > 0,
          isLoaded: true,
          children: previousGrandChildren,
        }
      }

      const nextGrandChildren = nextChild.children ?? []
      if (nextGrandChildren.length <= 0) {
        return {
          ...nextChild,
          hasChildren: true,
          children: previousGrandChildren,
        }
      }

      return {
        ...nextChild,
        hasChildren: true,
        children: mergeLoadedDirectoryChildren(nextGrandChildren, previousGrandChildren, options),
      }
    }),
  )
}

function upsertDirectoryBranch(nodes: ProjectFileNode[], directoryRelativePath: string, sortedChildren: ProjectFileNode[], options: ReplaceDirectoryNodesOptions): ProjectFileNode[] {
  const segments = directoryPathSegments(directoryRelativePath)
  if (segments.length <= 0) return sortedChildren

  const upsertAtDepth = (items: ProjectFileNode[], depth: number): ProjectFileNode[] => {
    const currentRelativePath = segments.slice(0, depth + 1).join('/')
    let found = false
    const nextItems = items.map((item) => {
      if (item.kind !== 'directory' || item.relativePath !== currentRelativePath) return item

      found = true
      if (depth === segments.length - 1) {
        const mergedChildren = mergeLoadedDirectoryChildren(sortedChildren, item.children, options)
        return {
          ...item,
          hasChildren: mergedChildren.length > 0,
          isLoaded: true,
          children: mergedChildren,
        }
      }

      const children = upsertAtDepth(item.children ?? [], depth + 1)
      return {
        ...item,
        hasChildren: true,
        children,
      }
    })

    if (!found) {
      nextItems.push(createDirectoryBranch(segments, depth, sortedChildren))
    }

    return sortProjectNodes(nextItems)
  }

  return upsertAtDepth(nodes, 0)
}

function replaceDirectoryNodesInTree(nodes: ProjectFileNode[], directoryRelativePath: string, sortedChildren: ProjectFileNode[], options: ReplaceDirectoryNodesOptions): { nodes: ProjectFileNode[]; found: boolean } {
  let found = false
  const nextNodes = nodes.map((node) => {
    if (node.kind !== 'directory') return node
    if (node.relativePath === directoryRelativePath) {
      found = true
      const mergedChildren = mergeLoadedDirectoryChildren(sortedChildren, node.children, options)
      return {
        ...node,
        hasChildren: mergedChildren.length > 0,
        isLoaded: true,
        children: mergedChildren,
      }
    }
    if (!node.children || node.children.length <= 0) return node

    const replaced = replaceDirectoryNodesInTree(node.children, directoryRelativePath, sortedChildren, options)
    if (!replaced.found) return node

    found = true
    return {
      ...node,
      hasChildren: true,
      children: replaced.nodes,
    }
  })

  return {
    nodes: sortProjectNodes(nextNodes),
    found,
  }
}

export function replaceDirectoryNodes(nodes: ProjectFileNode[], directoryRelativePath: string | null, nextChildren: ProjectFileNode[], options: ReplaceDirectoryNodesOptions = {}): ProjectFileNode[] {
  const sortedChildren = sortProjectNodes(nextChildren)
  if (directoryRelativePath == null) {
    return mergeLoadedDirectoryChildren(sortedChildren, nodes, options)
  }

  const replaced = replaceDirectoryNodesInTree(nodes, directoryRelativePath, sortedChildren, options)
  return replaced.found ? replaced.nodes : upsertDirectoryBranch(nodes, directoryRelativePath, sortedChildren, options)
}

export function findDirectoryNode(nodes: ProjectFileNode[], relativePath: string): ProjectFileNode | null {
  for (const node of nodes) {
    if (node.kind !== 'directory') continue
    if (node.relativePath === relativePath) return node
    if (node.children && node.children.length > 0) {
      const nested = findDirectoryNode(node.children, relativePath)
      if (nested) return nested
    }
  }
  return null
}

export function collectTopLevelDirectories(nodes: ProjectFileNode[]): Set<string> {
  const directories = new Set<string>()
  for (const node of nodes) {
    if (node.kind !== 'directory') continue
    if (!node.relativePath.includes('/')) {
      directories.add(node.relativePath)
    }
  }
  return directories
}

export function buildKnownFilePathSet(treeKnownFilePaths: Set<string>, openTabPaths: string[], activeRelativePath: string | null, drawerState: CodeFileDrawerState, session: ProjectCodeSession | undefined, persistedLastCodeFile?: string, excludedPaths?: ReadonlySet<string>): Set<string> {
  const isExcluded = (path: string | null | undefined): boolean => Boolean(path && excludedPaths?.has(path))
  const next = new Set<string>()
  for (const path of treeKnownFilePaths) {
    if (isExcluded(path)) continue
    next.add(path)
  }
  for (const path of openTabPaths) {
    if (path.trim() && !isExcluded(path.trim())) next.add(path.trim())
  }
  for (const path of drawerState.favorites) {
    if (path.trim() && !isExcluded(path.trim())) next.add(path.trim())
  }
  for (const path of drawerState.recents) {
    if (path.trim() && !isExcluded(path.trim())) next.add(path.trim())
  }
  for (const path of session?.tabs ?? []) {
    if (path.trim() && !isExcluded(path.trim())) next.add(path.trim())
  }
  if (session?.activePath?.trim() && !isExcluded(session.activePath.trim())) next.add(session.activePath.trim())
  if (activeRelativePath?.trim() && !isExcluded(activeRelativePath.trim())) next.add(activeRelativePath.trim())
  if (persistedLastCodeFile?.trim() && !isExcluded(persistedLastCodeFile.trim())) next.add(persistedLastCodeFile.trim())
  return next
}

export async function expandTreePath(
  targetRelativePath: string,
  parentDirectories: string[],
  options: {
    loadDirectory: (directoryRelativePath: string | null) => Promise<boolean>
    setExpandedDirectories: Dispatch<SetStateAction<Set<string>>>
  },
): Promise<void> {
  for (const parent of [...parentDirectories].reverse()) {
    await options.loadDirectory(parent)
    options.setExpandedDirectories((prev) => {
      if (prev.has(parent)) return prev
      const next = new Set(prev)
      next.add(parent)
      return next
    })
  }
}
