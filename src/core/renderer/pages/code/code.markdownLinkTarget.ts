import type { ProjectFileTreeResult } from '../../../shared/types'

// 目录入口 index 文件不限后缀：index、index.md、index.html 等均可命中。
const INDEX_FILE_NAME_PATTERN = /^index(\..+)?$/i

export type MarkdownLinkTargetResolution = { kind: 'file'; relativePath: string } | { kind: 'directory'; relativePath: string } | { kind: 'missing' }

type ProjectFileNodes = ProjectFileTreeResult['nodes']

function indexEntryPriority(name: string): number {
  const lower = name.toLowerCase()
  if (lower === 'index') return 0
  if (lower === 'index.md' || lower === 'index.markdown') return 1
  return 2
}

function findFileByName(nodes: ProjectFileNodes, name: string): ProjectFileNodes[number] | undefined {
  const lowerName = name.toLowerCase()
  return nodes.find((node) => node.kind === 'file' && node.name.toLowerCase() === lowerName)
}

/** 折叠路径中的 `.` / `..` 段；越出项目根时返回 null（严格语义）。 */
function normalizeRelativePathSegments(value: string): string[] | null {
  const segments: string[] = []
  for (const rawSegment of value.split('/')) {
    const segment = rawSegment.trim()
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (segments.length === 0) return null
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  return segments
}

async function listDirectoryNodes(projectPath: string, directoryRelativePath: string | null): Promise<ProjectFileNodes | null> {
  try {
    const listing = await window.electronAPI.listProjectDirectoryFiles(projectPath, directoryRelativePath)
    return listing.nodes
  } catch {
    return null
  }
}

/** 在目录内定位入口文件：优先 README.md，其次任意后缀的 index 文件。返回命中文件的 project-relative path，或 null。 */
async function resolveDirectoryEntryFile(projectPath: string, directoryRelativePath: string): Promise<string | null> {
  const nodes = await listDirectoryNodes(projectPath, directoryRelativePath)
  if (!nodes) return null

  const readme = findFileByName(nodes, 'readme.md')
  if (readme) return readme.relativePath

  const indexEntries = nodes.filter((node) => node.kind === 'file' && INDEX_FILE_NAME_PATTERN.test(node.name)).sort((a, b) => indexEntryPriority(a.name) - indexEntryPriority(b.name) || a.name.localeCompare(b.name))
  return indexEntries[0]?.relativePath ?? null
}

/**
 * 逐段下行解析：每一步只 listing 上一步已确认存在的目录，坏路径会在中途
 * 断掉并返回 missing，不会触发主进程 tree-directory 的 ENOENT 报错日志。
 * 末段依次尝试：同名义件、省略 .md/.markdown 后缀的文件、目录入口（README 优先，其次 index.*）。
 */
async function resolvePathSegments(projectPath: string, segments: string[]): Promise<MarkdownLinkTargetResolution> {
  let nodes = await listDirectoryNodes(projectPath, null)
  if (!nodes) return { kind: 'missing' }

  for (let index = 0; index < segments.length; index += 1) {
    const segmentName = segments[index]
    const isLast = index === segments.length - 1
    const lowerName = segmentName.toLowerCase()

    if (isLast) {
      const directFile = findFileByName(nodes, segmentName) ?? findFileByName(nodes, `${segmentName}.md`) ?? findFileByName(nodes, `${segmentName}.markdown`)
      if (directFile) return { kind: 'file', relativePath: directFile.relativePath }
    }

    const directory = nodes.find((node) => node.kind === 'directory' && node.name.toLowerCase() === lowerName)
    if (!directory) return { kind: 'missing' }

    if (isLast) {
      const entryFile = await resolveDirectoryEntryFile(projectPath, directory.relativePath)
      return entryFile ? { kind: 'file', relativePath: entryFile } : { kind: 'directory', relativePath: directory.relativePath }
    }

    const childNodes = await listDirectoryNodes(projectPath, directory.relativePath)
    if (!childNodes) return { kind: 'missing' }
    nodes = childNodes
  }

  return { kind: 'missing' }
}

/**
 * Resolve a markdown relative link target that may omit the extension, climb
 * with `..` segments, or point to a directory:
 *  1. `<name>` / `<name>.md` / `<name>.markdown` as a file
 *  2. `<name>/README.md` (directory links, README first)
 *  3. any `<name>/index.*` file (directory links, extension agnostic)
 * When the target only exists as a directory without an entry file, the
 * directory itself is returned so the caller can reveal it in the file tree.
 */
export async function resolveMarkdownLinkTarget(projectPath: string, relativePath: string): Promise<MarkdownLinkTargetResolution> {
  const segments = normalizeRelativePathSegments(relativePath.trim().replace(/\\/g, '/'))
  if (!segments || segments.length === 0) return { kind: 'missing' }
  return resolvePathSegments(projectPath, segments)
}

/**
 * 主候选（按链接所在目录折叠的相对路径）miss 后，再用根相对候选兜底：
 * AI 生成的文档常把「项目根相对路径」写成 `../../src/...` 形式，从所在目录
 * 折叠会得到不存在的重复前缀路径；按项目根重新解释才能命中真实目标。
 */
export async function resolveMarkdownLinkTargetWithRootFallback(projectPath: string, relativePath: string, rootRelativeFallback?: string | null): Promise<MarkdownLinkTargetResolution> {
  const primary = await resolveMarkdownLinkTarget(projectPath, relativePath)
  if (primary.kind !== 'missing') return primary

  const fallbackSegments = normalizeRelativePathSegments((rootRelativeFallback ?? '').trim().replace(/\\/g, '/'))
  if (!fallbackSegments || fallbackSegments.length === 0) return primary
  return resolvePathSegments(projectPath, fallbackSegments)
}
