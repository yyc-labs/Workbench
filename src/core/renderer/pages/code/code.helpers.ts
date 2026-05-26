import type { ProjectFileNode } from '../../../shared/types'
import type { CodeFileDrawerState } from './code.types'

const MAX_CODE_FILE_RECENTS = 40

function normalizeRelativePathList(value: string[] | undefined): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map((item) => item.trim()).filter(Boolean)))
}

function isSamePathList(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false
  }
  return true
}

export function normalizeCodeFileDrawerState(value: Partial<CodeFileDrawerState> | null | undefined): CodeFileDrawerState {
  return {
    favorites: normalizeRelativePathList(value?.favorites),
    recents: normalizeRelativePathList(value?.recents).slice(0, MAX_CODE_FILE_RECENTS),
  }
}

export function pushRecentCodeFilePath(state: CodeFileDrawerState, relativePath: string): CodeFileDrawerState {
  const normalizedPath = relativePath.trim()
  if (!normalizedPath) return state
  const nextRecents = [normalizedPath, ...state.recents.filter((item) => item !== normalizedPath)].slice(0, MAX_CODE_FILE_RECENTS)
  return {
    favorites: state.favorites,
    recents: nextRecents,
  }
}

export function isSameCodeFileDrawerState(left: CodeFileDrawerState, right: CodeFileDrawerState): boolean {
  return isSamePathList(left.favorites, right.favorites) && isSamePathList(left.recents, right.recents)
}

export function toggleFavoriteCodeFilePath(state: CodeFileDrawerState, relativePath: string): CodeFileDrawerState {
  const normalizedPath = relativePath.trim()
  if (!normalizedPath) return state
  if (state.favorites.includes(normalizedPath)) {
    return {
      favorites: state.favorites.filter((item) => item !== normalizedPath),
      recents: state.recents,
    }
  }
  return {
    favorites: [...state.favorites, normalizedPath],
    recents: state.recents,
  }
}

export function removeCodeFilePathFromDrawerState(state: CodeFileDrawerState, relativePath: string): CodeFileDrawerState {
  const normalizedPath = relativePath.trim()
  if (!normalizedPath) return state
  return {
    favorites: state.favorites.filter((item) => item !== normalizedPath),
    recents: state.recents.filter((item) => item !== normalizedPath),
  }
}

export function inferLanguageFromRelativePath(relativePath: string): string {
  const lower = relativePath.toLowerCase()
  const fileName = lower.split('/').pop() ?? lower

  if (fileName === '.env' || fileName.startsWith('.env.')) return 'ini'
  if (fileName === '.envrc') return 'shell'

  if (lower.endsWith('.d.ts') || lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript'
  if (lower.endsWith('.mjs') || lower.endsWith('.cjs') || lower.endsWith('.js') || lower.endsWith('.jsx')) return 'javascript'
  if (lower.endsWith('.json')) return 'json'
  if (lower.endsWith('.css')) return 'css'
  if (lower.endsWith('.scss')) return 'scss'
  if (lower.endsWith('.less')) return 'less'
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html'
  if (lower.endsWith('.md') || lower.endsWith('.mdx') || lower.endsWith('.mdc')) return 'markdown'
  if (lower.endsWith('.py')) return 'python'
  if (lower.endsWith('.go')) return 'go'
  if (lower.endsWith('.rs')) return 'rust'
  if (lower.endsWith('.java')) return 'java'
  if (lower.endsWith('.kt') || lower.endsWith('.kts')) return 'kotlin'
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml'
  return 'plaintext'
}

export function sortTreeNodes(nodes: ProjectFileNode[]): ProjectFileNode[] {
  const sorted = [...nodes].sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === 'directory' ? -1 : 1
    }
    return a.name.localeCompare(b.name)
  })

  return sorted.map((node) => {
    if (node.kind !== 'directory') return node
    return {
      ...node,
      children: sortTreeNodes(node.children ?? []),
    }
  })
}

export function createDefaultExpandedDirectorySet(nodes: ProjectFileNode[]): Set<string> {
  const expanded = new Set<string>()
  for (const node of nodes) {
    if (node.kind !== 'directory') continue
    expanded.add(node.relativePath)
  }
  return expanded
}

export function parentDirectory(relativePath: string): string | null {
  const normalized = relativePath.replace(/\\/g, '/')
  const slashIndex = normalized.lastIndexOf('/')
  if (slashIndex <= 0) return null
  const dir = normalized.slice(0, slashIndex)
  return dir || null
}

export function collectParentDirectories(relativePath: string): string[] {
  const items: string[] = []
  let current = parentDirectory(relativePath)
  while (current) {
    items.push(current)
    current = parentDirectory(current)
  }
  return items
}

export function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function compactPathToken(value: string): string {
  return value.toLowerCase().replace(/[\/\\._\-\s]+/g, '')
}

function isSubsequenceMatch(needle: string, haystack: string): boolean {
  if (!needle) return true
  let needleIndex = 0
  for (let i = 0; i < haystack.length; i += 1) {
    if (haystack[i] === needle[needleIndex]) {
      needleIndex += 1
      if (needleIndex >= needle.length) return true
    }
  }
  return false
}

export function fuzzyPathMatch(query: string, candidate: string): boolean {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return true

  const normalizedCandidate = candidate.toLowerCase()
  if (normalizedCandidate.includes(normalizedQuery)) return true

  const compactQuery = compactPathToken(normalizedQuery)
  const compactCandidate = compactPathToken(normalizedCandidate)
  if (!compactQuery) return true

  return isSubsequenceMatch(compactQuery, compactCandidate)
}

export function filterTreeNodesByQuery(nodes: ProjectFileNode[], query: string): ProjectFileNode[] {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) return nodes

  const filtered: ProjectFileNode[] = []
  for (const node of nodes) {
    const matchedSelf = fuzzyPathMatch(normalizedQuery, node.relativePath) || fuzzyPathMatch(normalizedQuery, node.name)
    if (node.kind === 'file') {
      if (matchedSelf) filtered.push(node)
      continue
    }

    if (matchedSelf) {
      filtered.push(node)
      continue
    }

    const matchedChildren = filterTreeNodesByQuery(node.children ?? [], normalizedQuery)
    if (matchedChildren.length > 0) {
      filtered.push({
        ...node,
        children: matchedChildren,
      })
    }
  }

  return filtered
}

export function collectAllFileRelativePaths(nodes: ProjectFileNode[]): string[] {
  const result: string[] = []

  const walk = (items: ProjectFileNode[]) => {
    for (const node of items) {
      if (node.kind === 'file') {
        result.push(node.relativePath)
        continue
      }
      if (node.children && node.children.length > 0) {
        walk(node.children)
      }
    }
  }

  walk(nodes)
  return result
}
