const MARKDOWN_EXTENSION_PATTERN = /\.(md|markdown)$/i

// 目录入口 index 文件不限后缀：index、index.md、index.html 等均可命中。
const INDEX_FILE_NAME_PATTERN = /^index(\..+)?$/i

function indexEntryPriority(name: string): number {
  const lower = name.toLowerCase()
  if (lower === 'index') return 0
  if (lower === 'index.md' || lower === 'index.markdown') return 1
  return 2
}

/**
 * 在目录内定位入口文件：优先 README.md，其次任意后缀的 index 文件。
 * 返回命中文件的 project-relative path，或 null。
 */
async function resolveDirectoryEntryFile(projectPath: string, directoryPath: string): Promise<string | null> {
  for (const name of ['README.md', 'readme.md']) {
    try {
      const stat = await window.electronAPI.statProjectFile(projectPath, `${directoryPath}/${name}`)
      if (stat?.relativePath) return stat.relativePath
    } catch {
      // Candidate does not exist — probe the next one.
    }
  }

  try {
    const listing = await window.electronAPI.listProjectDirectoryFiles(projectPath, directoryPath)
    const indexEntries = listing.nodes.filter((node) => node.kind === 'file' && INDEX_FILE_NAME_PATTERN.test(node.name)).sort((a, b) => indexEntryPriority(a.name) - indexEntryPriority(b.name) || a.name.localeCompare(b.name))
    return indexEntries[0]?.relativePath ?? null
  } catch {
    return null
  }
}

/**
 * Resolve a markdown relative link target that may omit the extension or point
 * to a directory. Candidates are probed in order:
 *  1. the path itself (covers exact files, with or without extension)
 *  2. `<path>.md` / `<path>.markdown` (extensionless file links)
 *  3. `<path>/README.md` (directory links, README first)
 *  4. any `<path>/index.*` file (directory links, extension agnostic)
 * Returns the first existing file's normalized project-relative path, or null.
 */
export async function resolveMarkdownLinkTarget(projectPath: string, relativePath: string): Promise<string | null> {
  const normalized = relativePath.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  if (!normalized || normalized.startsWith('/') || normalized.includes('..')) return null

  const candidates = [normalized]
  if (!MARKDOWN_EXTENSION_PATTERN.test(normalized)) {
    candidates.push(`${normalized}.md`, `${normalized}.markdown`)
  }

  for (const candidate of candidates) {
    try {
      const stat = await window.electronAPI.statProjectFile(projectPath, candidate)
      if (stat?.relativePath) return stat.relativePath
    } catch {
      // Candidate does not exist (or is a directory) — probe the next one.
    }
  }

  return resolveDirectoryEntryFile(projectPath, normalized)
}
