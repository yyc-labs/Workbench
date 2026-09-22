import type { ProjectFileTreeResult } from '../../../shared/types'

const MARKDOWN_EXTENSION_PATTERN = /\.(md|markdown)$/i

// 目录入口 index 文件不限后缀：index、index.md、index.html 等均可命中。
const INDEX_FILE_NAME_PATTERN = /^index(\..+)?$/i

function indexEntryPriority(name: string): number {
  const lower = name.toLowerCase()
  if (lower === 'index') return 0
  if (lower === 'index.md' || lower === 'index.markdown') return 1
  return 2
}

function findFileByName(nodes: ProjectFileTreeResult['nodes'], name: string): ProjectFileTreeResult['nodes'][number] | undefined {
  const lowerName = name.toLowerCase()
  return nodes.find((node) => node.kind === 'file' && node.name.toLowerCase() === lowerName)
}

/**
 * 在目录内定位入口文件：优先 README.md，其次任意后缀的 index 文件。
 * 返回命中文件的 project-relative path，或 null。
 */
async function resolveDirectoryEntryFile(projectPath: string, directoryRelativePath: string): Promise<string | null> {
  let listing: ProjectFileTreeResult
  try {
    listing = await window.electronAPI.listProjectDirectoryFiles(projectPath, directoryRelativePath)
  } catch {
    return null
  }

  const readme = findFileByName(listing.nodes, 'readme.md')
  if (readme) return readme.relativePath

  const indexEntries = listing.nodes.filter((node) => node.kind === 'file' && INDEX_FILE_NAME_PATTERN.test(node.name)).sort((a, b) => indexEntryPriority(a.name) - indexEntryPriority(b.name) || a.name.localeCompare(b.name))
  return indexEntries[0]?.relativePath ?? null
}

/**
 * Resolve a markdown relative link target that may omit the extension or point
 * to a directory. Resolution relies on a single directory listing (instead of
 * stat probes) to avoid noisy ENOENT IPC errors:
 *  1. `<name>` / `<name>.md` / `<name>.markdown` as a file in the parent directory
 *  2. `<name>/README.md` (directory links, README first)
 *  3. any `<name>/index.*` file (directory links, extension agnostic)
 * Returns the first existing file's normalized project-relative path, or null.
 */
export async function resolveMarkdownLinkTarget(projectPath: string, relativePath: string): Promise<string | null> {
  const normalized = relativePath.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  if (!normalized || normalized.startsWith('/') || normalized.includes('..')) return null

  const separatorIndex = normalized.lastIndexOf('/')
  const directoryPath = separatorIndex >= 0 ? normalized.slice(0, separatorIndex) : null
  const baseName = separatorIndex >= 0 ? normalized.slice(separatorIndex + 1) : normalized

  let listing: ProjectFileTreeResult
  try {
    listing = await window.electronAPI.listProjectDirectoryFiles(projectPath, directoryPath)
  } catch {
    return null
  }

  const direct = findFileByName(listing.nodes, baseName) ?? findFileByName(listing.nodes, `${baseName}.md`) ?? findFileByName(listing.nodes, `${baseName}.markdown`)
  if (direct) return direct.relativePath

  const lowerBaseName = baseName.toLowerCase()
  const isDirectory = listing.nodes.some((node) => node.kind === 'directory' && node.name.toLowerCase() === lowerBaseName)
  if (!isDirectory) return null

  return resolveDirectoryEntryFile(projectPath, normalized)
}
