import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { DocLinkLibraryFile, SharedDocLink, SharedDocLinkGroup } from '../../../shared/types'

const EMPTY_LIBRARY: DocLinkLibraryFile = { version: 1, groups: [], links: [] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function parseGroup(value: unknown): SharedDocLinkGroup | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string' || !value.id) return null
  if (typeof value.name !== 'string' || !value.name) return null
  return {
    id: value.id,
    name: value.name,
    sortOrder: typeof value.sortOrder === 'number' && Number.isFinite(value.sortOrder) ? value.sortOrder : 0,
  }
}

function parseLink(value: unknown): SharedDocLink | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string' || !value.id) return null
  if (typeof value.groupId !== 'string' || !value.groupId) return null
  if (typeof value.title !== 'string' || !value.title) return null
  return {
    ...(value as unknown as SharedDocLink),
    id: value.id,
    groupId: value.groupId,
    title: value.title,
    createdAt: typeof value.createdAt === 'number' && Number.isFinite(value.createdAt) ? value.createdAt : 0,
  }
}

function parseLibrary(value: unknown): DocLinkLibraryFile | null {
  if (!isRecord(value)) return null
  if (!Array.isArray(value.groups) || !Array.isArray(value.links)) return null
  return {
    version: 1,
    groups: value.groups.map(parseGroup).filter((group): group is SharedDocLinkGroup => group !== null),
    links: value.links.map(parseLink).filter((link): link is SharedDocLink => link !== null),
  }
}

/** 共享链接库 JSON 持久化：懒加载缓存 + 原子写 + 损坏容错（读失败返回空库，不阻塞启动）。 */
export class DocLinkLibraryRepository {
  private readonly filePath: string
  private cache: DocLinkLibraryFile | null = null

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, 'doc-link-library', 'library.json')
  }

  async read(): Promise<DocLinkLibraryFile> {
    if (this.cache) return this.cache
    try {
      const raw = await readFile(this.filePath, 'utf8')
      const parsed = parseLibrary(JSON.parse(raw) as unknown)
      this.cache = parsed ?? EMPTY_LIBRARY
    } catch (error) {
      // 文件不存在 = 首次使用，静默返回空库；仅解析/结构损坏才告警。
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[doc-link-library] failed to read library file, falling back to an empty library:', error)
      }
      this.cache = EMPTY_LIBRARY
    }
    return this.cache
  }

  async write(file: DocLinkLibraryFile): Promise<DocLinkLibraryFile> {
    const directory = path.dirname(this.filePath)
    await mkdir(directory, { recursive: true })
    const temporaryPath = `${this.filePath}.tmp`
    await writeFile(temporaryPath, JSON.stringify(file, null, 2), 'utf8')
    await rename(temporaryPath, this.filePath)
    this.cache = file
    return file
  }
}
