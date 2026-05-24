import type { ProjectFileNode } from '../../../shared/types'

export function inferLanguageFromRelativePath(relativePath: string): string {
  const lower = relativePath.toLowerCase()
  if (lower.endsWith('.d.ts') || lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript'
  if (lower.endsWith('.mjs') || lower.endsWith('.cjs') || lower.endsWith('.js') || lower.endsWith('.jsx')) return 'javascript'
  if (lower.endsWith('.json')) return 'json'
  if (lower.endsWith('.css')) return 'css'
  if (lower.endsWith('.scss')) return 'scss'
  if (lower.endsWith('.less')) return 'less'
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html'
  if (lower.endsWith('.md') || lower.endsWith('.mdx')) return 'markdown'
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
