import { Dirent, promises as fs } from 'node:fs'
import path from 'node:path'
import type { ProjectFileAutoLoadDecision, ProjectFileNode, ProjectFileTreeOptions, ProjectFileTreeResult } from '../../../shared/types'
import { loadConfig } from '../config'
import {
  type AutoLoadProbeCounters,
  compareTreeNodesByName,
  createRgExcludeGlobs,
  type DirectoryListCounters,
  ensureWithinRoot,
  execFileUtf8,
  fileDepth,
  fileNameFromRelativePath,
  filterListedFilePaths,
  fuzzyPathMatch,
  isExcludedDirectory,
  isExcludedFile,
  LARGE_PROJECT_AUTOLOAD_FILE_LIMIT,
  MAX_DIRECTORY_ENTRIES,
  MAX_SEARCH_RESULTS,
  MAX_TREE_DEPTH,
  MAX_TREE_FILES,
  normalizeListedRelativePath,
  normalizeRelativeInput,
  PROJECT_FILE_LIST_CACHE_TTL_MS,
  type ProjectFileExclusions,
  ProjectFileServiceError,
  resolveRoot,
  type ScanCounters,
  scanDirectoryForAutoLoadThreshold,
  shouldSkipListedFilePath,
  toPosixRelativePath,
  validateRelativePathLooksSafe,
} from './shared'

interface ProjectFileListCacheEntry {
  paths: string[]
  updatedAtMs: number
}

const projectFileListCache = new Map<string, ProjectFileListCacheEntry>()

function getProjectFileExclusions(): ProjectFileExclusions {
  const configured = loadConfig().codeFileExclusions
  return {
    directories: new Set(configured?.directories ?? []),
    files: new Set(configured?.files ?? []),
  }
}

// 文件树自动加载上限：用户可在设置页配置（默认 4000，clamp [500, 20000]）。
const MIN_TREE_AUTOLOAD_FILE_LIMIT = 500
const MAX_TREE_AUTOLOAD_FILE_LIMIT = 20000

function getProjectTreeAutoLoadLimit(): number {
  const configured = loadConfig().codeTreeAutoLoadFileLimit
  if (typeof configured !== 'number' || !Number.isFinite(configured)) return LARGE_PROJECT_AUTOLOAD_FILE_LIMIT
  return Math.min(MAX_TREE_AUTOLOAD_FILE_LIMIT, Math.max(MIN_TREE_AUTOLOAD_FILE_LIMIT, Math.round(configured)))
}

// 树扫描截断上限跟随配置抬高，保证「决策放行的项目，树就能完整加载」。
function getProjectTreeScanMaxFiles(): number {
  return Math.max(getProjectTreeAutoLoadLimit(), MAX_TREE_FILES)
}

function projectFileCacheKey(rootRealPath: string, exclusions: ProjectFileExclusions): string {
  return `${rootRealPath}\0${Array.from(exclusions.directories).join('\0')}\0${Array.from(exclusions.files).join('\0')}`
}

function setProjectFileListCache(rootRealPath: string, exclusions: ProjectFileExclusions, paths: string[]): void {
  projectFileListCache.set(projectFileCacheKey(rootRealPath, exclusions), {
    paths,
    updatedAtMs: Date.now(),
  })
}

function invalidateProjectFileListCache(rootRealPath: string): void {
  for (const key of projectFileListCache.keys()) {
    if (key.startsWith(`${rootRealPath}\0`)) projectFileListCache.delete(key)
  }
}

function getProjectFileListFromCache(rootRealPath: string, exclusions: ProjectFileExclusions): string[] | null {
  const cached = projectFileListCache.get(projectFileCacheKey(rootRealPath, exclusions))
  if (!cached) return null
  if (Date.now() - cached.updatedAtMs > PROJECT_FILE_LIST_CACHE_TTL_MS) {
    projectFileListCache.delete(projectFileCacheKey(rootRealPath, exclusions))
    return null
  }
  return cached.paths
}

async function listProjectFilesByRipgrep(rootRealPath: string, exclusions: ProjectFileExclusions): Promise<string[] | null> {
  const args = ['--files', '--hidden', '--no-ignore', '--null', '--max-depth', String(MAX_TREE_DEPTH), ...createRgExcludeGlobs(exclusions).flatMap((glob) => ['--glob', glob]), '.']

  try {
    const output = await execFileUtf8(rootRealPath, args)
    if (!output) return []
    return output
      .split('\0')
      .map(normalizeListedRelativePath)
      .filter((item): item is string => Boolean(item))
  } catch (error) {
    const typedError = error as NodeJS.ErrnoException & { code?: unknown; stdout?: string }
    const errorCode = typedError.code

    if (String(errorCode) === '1') {
      const stdout = typedError.stdout ?? ''
      if (!stdout) return []
      return stdout
        .split('\0')
        .map(normalizeListedRelativePath)
        .filter((item): item is string => Boolean(item))
    }

    if (errorCode === 'ENOENT') return null
    return null
  }
}

async function scanDirectoryFallback(rootRealPath: string, absoluteDirPath: string, depth: number, counters: ScanCounters, exclusions: ProjectFileExclusions, maxFiles: number = MAX_TREE_FILES): Promise<ProjectFileNode[]> {
  if (depth > MAX_TREE_DEPTH) {
    counters.skippedDirectories += 1
    return []
  }

  let entries: Dirent[]
  try {
    entries = await fs.readdir(absoluteDirPath, { withFileTypes: true })
  } catch {
    counters.skippedDirectories += 1
    return []
  }

  entries.sort((a, b) => a.name.localeCompare(b.name))

  const directories: ProjectFileNode[] = []
  const files: ProjectFileNode[] = []

  for (const entry of entries) {
    const entryAbsolutePath = path.join(absoluteDirPath, entry.name)
    const relativePath = toPosixRelativePath(path.relative(rootRealPath, entryAbsolutePath))
    if (!relativePath || relativePath.startsWith('..')) {
      counters.skippedDirectories += 1
      continue
    }

    if (entry.isDirectory()) {
      if (isExcludedDirectory(entry.name, exclusions)) {
        counters.skippedDirectories += 1
        continue
      }

      if (counters.filesScanned >= maxFiles) {
        counters.skippedDirectories += 1
        continue
      }

      const children = await scanDirectoryFallback(rootRealPath, entryAbsolutePath, depth + 1, counters, exclusions, maxFiles)
      directories.push({
        name: entry.name,
        relativePath,
        kind: 'directory',
        hasChildren: children.length > 0,
        isLoaded: true,
        children,
      })
      continue
    }

    if (!entry.isFile()) continue

    if (isExcludedFile(entry.name, exclusions)) {
      counters.skippedFiles += 1
      continue
    }

    if (counters.filesScanned >= maxFiles) {
      counters.skippedFiles += 1
      continue
    }

    counters.filesScanned += 1
    files.push({
      name: entry.name,
      relativePath,
      kind: 'file',
    })
  }

  return [...directories, ...files]
}

async function listProjectDirectoryChildren(rootRealPath: string, directoryRelativePath: string | null, exclusions: ProjectFileExclusions): Promise<ProjectFileTreeResult> {
  const normalizedDirectoryRelativePath = directoryRelativePath ? normalizeRelativeInput(directoryRelativePath) : null
  const targetDirectoryPath = normalizedDirectoryRelativePath ? path.join(rootRealPath, normalizedDirectoryRelativePath) : rootRealPath
  const directoryRealPath = await fs.realpath(targetDirectoryPath)
  ensureWithinRoot(rootRealPath, directoryRealPath)

  const directoryStat = await fs.stat(directoryRealPath)
  if (!directoryStat.isDirectory()) {
    throw new Error('Target path is not a directory.')
  }

  let entries: Dirent[]
  try {
    entries = await fs.readdir(directoryRealPath, { withFileTypes: true })
  } catch {
    throw new Error('Unable to read directory contents.')
  }

  entries.sort((a, b) => a.name.localeCompare(b.name))

  const counters: DirectoryListCounters = {
    skippedFiles: 0,
    skippedDirectories: 0,
  }
  const nodes: ProjectFileNode[] = []
  let includedEntries = 0

  for (const entry of entries) {
    if (includedEntries >= MAX_DIRECTORY_ENTRIES) {
      if (entry.isDirectory()) counters.skippedDirectories += 1
      else if (entry.isFile()) counters.skippedFiles += 1
      continue
    }

    const entryAbsolutePath = path.join(directoryRealPath, entry.name)
    const relativePath = toPosixRelativePath(path.relative(rootRealPath, entryAbsolutePath))
    if (!relativePath || relativePath.startsWith('..')) {
      counters.skippedDirectories += 1
      continue
    }

    if (fileDepth(relativePath) > MAX_TREE_DEPTH) {
      if (entry.isDirectory()) counters.skippedDirectories += 1
      else if (entry.isFile()) counters.skippedFiles += 1
      continue
    }

    if (entry.isDirectory()) {
      if (isExcludedDirectory(entry.name, exclusions)) {
        // 被排除的目录仍以占位节点出现在原位置，点击后进入解释视图而非展开。
        nodes.push({
          name: entry.name,
          relativePath,
          kind: 'directory',
          hasChildren: false,
          isExcluded: true,
        })
        includedEntries += 1
        continue
      }

      nodes.push({
        name: entry.name,
        relativePath,
        kind: 'directory',
        // Keep directory discovery lazy. Probing every listed folder adds an extra
        // readdir round-trip per entry and makes the initial tree load noticeably
        // slower on WSL / mounted Windows disks.
        hasChildren: true,
        isLoaded: false,
      })
      includedEntries += 1
      continue
    }

    if (!entry.isFile()) continue

    if (isExcludedFile(entry.name, exclusions)) {
      nodes.push({
        name: entry.name,
        relativePath,
        kind: 'file',
        isExcluded: true,
      })
      includedEntries += 1
      continue
    }

    nodes.push({
      name: entry.name,
      relativePath,
      kind: 'file',
    })
    includedEntries += 1
  }

  nodes.sort(compareTreeNodesByName)

  return {
    rootPath: rootRealPath,
    directoryRelativePath: normalizedDirectoryRelativePath,
    nodes,
    skipped: {
      directories: counters.skippedDirectories,
      files: counters.skippedFiles,
    },
  }
}

export async function listProjectDirectoryFiles(projectPath: string, directoryRelativePath: string | null): Promise<ProjectFileTreeResult> {
  const rootRealPath = await resolveRoot(projectPath)
  return listProjectDirectoryChildren(rootRealPath, directoryRelativePath, getProjectFileExclusions())
}

export async function listProjectFiles(projectPath: string, options: ProjectFileTreeOptions = {}): Promise<ProjectFileTreeResult> {
  const rootRealPath = await resolveRoot(projectPath)
  const exclusions = getProjectFileExclusions()
  if (options.invalidateCache) {
    invalidateProjectFileListCache(rootRealPath)
  }
  return listProjectDirectoryChildren(rootRealPath, null, exclusions)
}

export async function getProjectFileAutoLoadDecision(projectPath: string): Promise<ProjectFileAutoLoadDecision> {
  const rootRealPath = await resolveRoot(projectPath)
  const exclusions = getProjectFileExclusions()
  const autoLoadLimit = getProjectTreeAutoLoadLimit()
  const scanMaxFiles = getProjectTreeScanMaxFiles()
  const cached = getProjectFileListFromCache(rootRealPath, exclusions)
  if (cached) {
    return {
      shouldAutoLoad: cached.length <= autoLoadLimit,
      reason: cached.length <= autoLoadLimit ? 'ok' : 'large-project',
      fileCountSample: cached.length,
      limit: autoLoadLimit,
    }
  }

  const listedPaths = await listProjectFilesByRipgrep(rootRealPath, exclusions)
  if (listedPaths) {
    const filtered = filterListedFilePaths(listedPaths, exclusions, scanMaxFiles)
    setProjectFileListCache(rootRealPath, exclusions, filtered.acceptedPaths)
    const fileCountSample = filtered.acceptedPaths.length
    return {
      shouldAutoLoad: fileCountSample <= autoLoadLimit,
      reason: fileCountSample <= autoLoadLimit ? 'ok' : 'large-project',
      fileCountSample,
      limit: autoLoadLimit,
    }
  }

  const counters: AutoLoadProbeCounters = {
    filesSeen: 0,
  }
  await scanDirectoryForAutoLoadThreshold(rootRealPath, rootRealPath, 0, autoLoadLimit, counters, exclusions)
  const fileCountSample = counters.filesSeen
  return {
    shouldAutoLoad: fileCountSample <= autoLoadLimit,
    reason: fileCountSample <= autoLoadLimit ? 'ok' : 'large-project',
    fileCountSample,
    limit: autoLoadLimit,
  }
}

/** posix 相对路径的父目录；无父目录（顶层文件）返回 null。 */
function posixParentDirectory(relativePath: string): string | null {
  const slashIndex = relativePath.lastIndexOf('/')
  if (slashIndex <= 0) return null
  return relativePath.slice(0, slashIndex)
}

/**
 * 搜索范围前缀解析（searchProjectFiles / searchProjectDirectories 共用）：
 * 可选地把搜索限定在指定目录子树内；校验复用现有防护链，空值视为全项目。
 */
async function resolveSearchScopePrefix(rootRealPath: string, folderRelativePath?: string): Promise<string> {
  if (!folderRelativePath || !folderRelativePath.trim()) return ''
  const normalizedFolder = normalizeRelativeInput(folderRelativePath)
  validateRelativePathLooksSafe(normalizedFolder)
  const folderCandidatePath = path.resolve(rootRealPath, normalizedFolder)
  const folderRealPath = await fs.realpath(folderCandidatePath)
  ensureWithinRoot(rootRealPath, folderRealPath)
  const folderStat = await fs.stat(folderRealPath)
  if (!folderStat.isDirectory()) {
    throw new ProjectFileServiceError('Selected path is not a directory.')
  }
  return `${toPosixRelativePath(normalizedFolder)}/`
}

/** 项目文件清单（缓存优先，ripgrep 列表 / 目录扫描回退），两种搜索共用。 */
async function resolveProjectFileListForSearch(rootRealPath: string, exclusions: ReturnType<typeof getProjectFileExclusions>): Promise<string[]> {
  const cached = getProjectFileListFromCache(rootRealPath, exclusions)
  if (cached) return cached

  const listedPaths = await listProjectFilesByRipgrep(rootRealPath, exclusions)
  if (listedPaths) {
    listedPaths.sort((a, b) => a.localeCompare(b))
    const filtered = filterListedFilePaths(listedPaths, exclusions, getProjectTreeScanMaxFiles())
    const acceptedPaths = filtered.acceptedPaths
    setProjectFileListCache(rootRealPath, exclusions, acceptedPaths)
    return acceptedPaths
  }

  const counters: ScanCounters = {
    filesScanned: 0,
    skippedFiles: 0,
    skippedDirectories: 0,
  }
  const tree = await scanDirectoryFallback(rootRealPath, rootRealPath, 0, counters, exclusions, getProjectTreeScanMaxFiles())
  const nextPaths: string[] = []
  const walk = (nodes: ProjectFileNode[]) => {
    for (const node of nodes) {
      if (node.kind === 'file') {
        nextPaths.push(node.relativePath)
        continue
      }
      if (node.children && node.children.length > 0) {
        walk(node.children)
      }
    }
  }
  walk(tree)
  setProjectFileListCache(rootRealPath, exclusions, nextPaths)
  return nextPaths
}

export async function searchProjectFiles(projectPath: string, query: string, folderRelativePath?: string): Promise<ProjectFileNode[]> {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) return []

  const rootRealPath = await resolveRoot(projectPath)
  const exclusions = getProjectFileExclusions()
  const folderPrefix = await resolveSearchScopePrefix(rootRealPath, folderRelativePath)
  const resolvedPaths = await resolveProjectFileListForSearch(rootRealPath, exclusions)

  const matches: ProjectFileNode[] = []
  for (const relativePath of resolvedPaths) {
    // 截断发生在范围过滤之后：先过滤前缀，再受 MAX_SEARCH_RESULTS 约束。
    if (folderPrefix && !relativePath.startsWith(folderPrefix)) continue
    if (matches.length >= MAX_SEARCH_RESULTS) break
    const fileName = fileNameFromRelativePath(relativePath)
    if (!fuzzyPathMatch(normalizedQuery, relativePath) && !fuzzyPathMatch(normalizedQuery, fileName)) {
      continue
    }
    matches.push({
      name: fileName,
      relativePath,
      kind: 'file',
    })
  }

  return matches
}

/**
 * 在项目（或指定目录子树）内按名称搜索**文件夹**（17 号需求：右键目录 → 搜索文件夹）。
 * 目录集合从文件清单派生（每个文件的祖先目录），与树的懒加载数据源一致——
 * 空目录不在文件清单中，故搜索不到；范围根自身不算「子目录」，不进结果。
 * 匹配只针对目录名本身（用户 2026-10-22 要求），不做全路径匹配。
 */
export async function searchProjectDirectories(projectPath: string, query: string, folderRelativePath?: string): Promise<ProjectFileNode[]> {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) return []

  const rootRealPath = await resolveRoot(projectPath)
  const exclusions = getProjectFileExclusions()
  const folderPrefix = await resolveSearchScopePrefix(rootRealPath, folderRelativePath)
  const resolvedPaths = await resolveProjectFileListForSearch(rootRealPath, exclusions)

  const directoryPaths = new Set<string>()
  for (const relativePath of resolvedPaths) {
    if (folderPrefix && !relativePath.startsWith(folderPrefix)) continue
    // 逐级上取父目录；越出范围前缀（含范围根本身）即停。
    let current = posixParentDirectory(relativePath)
    while (current && (!folderPrefix || current.startsWith(folderPrefix))) {
      directoryPaths.add(current)
      current = posixParentDirectory(current)
    }
  }

  const matches: ProjectFileNode[] = []
  for (const relativePath of [...directoryPaths].sort((a, b) => a.localeCompare(b))) {
    if (matches.length >= MAX_SEARCH_RESULTS) break
    // 只匹配目录名本身（用户 2026-10-22 要求）：路径匹配会引入大量同前缀的噪音结果。
    const directoryName = fileNameFromRelativePath(relativePath)
    if (!fuzzyPathMatch(normalizedQuery, directoryName)) {
      continue
    }
    matches.push({
      name: directoryName,
      relativePath,
      kind: 'directory',
    })
  }

  return matches
}
