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

export function replaceDirectoryNodes(
  nodes: ProjectFileNode[],
  directoryRelativePath: string | null,
  nextChildren: ProjectFileNode[]
): ProjectFileNode[] {
  const sortedChildren = sortProjectNodes(nextChildren)
  if (directoryRelativePath == null) {
    return sortedChildren
  }

  return sortProjectNodes(nodes.map((node) => {
    if (node.kind !== 'directory') return node
    if (node.relativePath === directoryRelativePath) {
      return {
        ...node,
        hasChildren: sortedChildren.length > 0,
        isLoaded: true,
        children: sortedChildren,
      }
    }
    if (!node.children || node.children.length <= 0) return node
    return {
      ...node,
      children: replaceDirectoryNodes(node.children, directoryRelativePath, sortedChildren),
    }
  }))
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

export function buildKnownFilePathSet(
  treeKnownFilePaths: Set<string>,
  openTabPaths: string[],
  activeRelativePath: string | null,
  drawerState: CodeFileDrawerState,
  session: ProjectCodeSession | undefined,
  persistedLastCodeFile?: string
): Set<string> {
  const next = new Set(treeKnownFilePaths)
  for (const path of openTabPaths) {
    if (path.trim()) next.add(path.trim())
  }
  for (const path of drawerState.favorites) {
    if (path.trim()) next.add(path.trim())
  }
  for (const path of drawerState.recents) {
    if (path.trim()) next.add(path.trim())
  }
  for (const path of session?.tabs ?? []) {
    if (path.trim()) next.add(path.trim())
  }
  if (session?.activePath?.trim()) next.add(session.activePath.trim())
  if (activeRelativePath?.trim()) next.add(activeRelativePath.trim())
  if (persistedLastCodeFile?.trim()) next.add(persistedLastCodeFile.trim())
  return next
}

export async function expandTreePath(
  targetRelativePath: string,
  parentDirectories: string[],
  options: {
    loadDirectory: (directoryRelativePath: string | null) => Promise<boolean>
    setExpandedDirectories: Dispatch<SetStateAction<Set<string>>>
  }
): Promise<void> {
  for (const parent of parentDirectories.reverse()) {
    await options.loadDirectory(parent)
    options.setExpandedDirectories((prev) => {
      if (prev.has(parent)) return prev
      const next = new Set(prev)
      next.add(parent)
      return next
    })
  }
}
