import { Dirent } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type {
  ProjectFileAutoLoadDecision,
  ProjectFileNode,
  ProjectFileTreeResult,
} from '../../../shared/types'
import {
  LARGE_PROJECT_AUTOLOAD_FILE_LIMIT,
  MAX_DIRECTORY_ENTRIES,
  MAX_SEARCH_RESULTS,
  MAX_TREE_DEPTH,
  MAX_TREE_FILES,
  PROJECT_FILE_LIST_CACHE_TTL_MS,
  type AutoLoadProbeCounters,
  type DirectoryListCounters,
  type ScanCounters,
  compareTreeNodesByName,
  ensureWithinRoot,
  execFileUtf8,
  fileDepth,
  fileNameFromRelativePath,
  filterListedFilePaths,
  fuzzyPathMatch,
  isExcludedDirectory,
  isExcludedFile,
  normalizeListedRelativePath,
  normalizeRelativeInput,
  resolveRoot,
  RG_EXCLUDE_GLOBS,
  scanDirectoryForAutoLoadThreshold,
  shouldSkipListedFilePath,
  toPosixRelativePath,
} from './shared'

interface ProjectFileListCacheEntry {
  paths: string[]
  updatedAtMs: number
}

const projectFileListCache = new Map<string, ProjectFileListCacheEntry>()

function setProjectFileListCache(rootRealPath: string, paths: string[]): void {
  projectFileListCache.set(rootRealPath, {
    paths,
    updatedAtMs: Date.now(),
  })
}

function getProjectFileListFromCache(rootRealPath: string): string[] | null {
  const cached = projectFileListCache.get(rootRealPath)
  if (!cached) return null
  if (Date.now() - cached.updatedAtMs > PROJECT_FILE_LIST_CACHE_TTL_MS) {
    projectFileListCache.delete(rootRealPath)
    return null
  }
  return cached.paths
}

async function listProjectFilesByRipgrep(rootRealPath: string): Promise<string[] | null> {
  const args = [
    '--files',
    '--hidden',
    '--no-ignore',
    '--null',
    '--max-depth',
    String(MAX_TREE_DEPTH),
    ...RG_EXCLUDE_GLOBS.flatMap((glob) => ['--glob', glob]),
    '.',
  ]

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

async function scanDirectoryFallback(
  rootRealPath: string,
  absoluteDirPath: string,
  depth: number,
  counters: ScanCounters
): Promise<ProjectFileNode[]> {
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
      if (isExcludedDirectory(entry.name)) {
        counters.skippedDirectories += 1
        continue
      }

      if (counters.filesScanned >= MAX_TREE_FILES) {
        counters.skippedDirectories += 1
        continue
      }

      const children = await scanDirectoryFallback(rootRealPath, entryAbsolutePath, depth + 1, counters)
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

    if (isExcludedFile(entry.name)) {
      counters.skippedFiles += 1
      continue
    }

    if (counters.filesScanned >= MAX_TREE_FILES) {
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

async function listProjectDirectoryChildren(
  rootRealPath: string,
  directoryRelativePath: string | null
): Promise<ProjectFileTreeResult> {
  const normalizedDirectoryRelativePath = directoryRelativePath ? normalizeRelativeInput(directoryRelativePath) : null
  const targetDirectoryPath = normalizedDirectoryRelativePath
    ? path.join(rootRealPath, normalizedDirectoryRelativePath)
    : rootRealPath
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
      if (isExcludedDirectory(entry.name)) {
        counters.skippedDirectories += 1
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

    if (isExcludedFile(entry.name)) {
      counters.skippedFiles += 1
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

export async function listProjectDirectoryFiles(
  projectPath: string,
  directoryRelativePath: string | null
): Promise<ProjectFileTreeResult> {
  const rootRealPath = await resolveRoot(projectPath)
  return listProjectDirectoryChildren(rootRealPath, directoryRelativePath)
}

export async function listProjectFiles(projectPath: string): Promise<ProjectFileTreeResult> {
  return listProjectDirectoryFiles(projectPath, null)
}

export async function getProjectFileAutoLoadDecision(projectPath: string): Promise<ProjectFileAutoLoadDecision> {
  const rootRealPath = await resolveRoot(projectPath)
  const cached = getProjectFileListFromCache(rootRealPath)
  if (cached) {
    return {
      shouldAutoLoad: cached.length <= LARGE_PROJECT_AUTOLOAD_FILE_LIMIT,
      reason: cached.length <= LARGE_PROJECT_AUTOLOAD_FILE_LIMIT ? 'ok' : 'large-project',
      fileCountSample: cached.length,
      limit: LARGE_PROJECT_AUTOLOAD_FILE_LIMIT,
    }
  }

  const listedPaths = await listProjectFilesByRipgrep(rootRealPath)
  if (listedPaths) {
    const filtered = filterListedFilePaths(listedPaths)
    setProjectFileListCache(rootRealPath, filtered.acceptedPaths)
    const fileCountSample = filtered.acceptedPaths.length
    return {
      shouldAutoLoad: fileCountSample <= LARGE_PROJECT_AUTOLOAD_FILE_LIMIT,
      reason: fileCountSample <= LARGE_PROJECT_AUTOLOAD_FILE_LIMIT ? 'ok' : 'large-project',
      fileCountSample,
      limit: LARGE_PROJECT_AUTOLOAD_FILE_LIMIT,
    }
  }

  const counters: AutoLoadProbeCounters = {
    filesSeen: 0,
  }
  await scanDirectoryForAutoLoadThreshold(rootRealPath, rootRealPath, 0, LARGE_PROJECT_AUTOLOAD_FILE_LIMIT, counters)
  const fileCountSample = counters.filesSeen
  return {
    shouldAutoLoad: fileCountSample <= LARGE_PROJECT_AUTOLOAD_FILE_LIMIT,
    reason: fileCountSample <= LARGE_PROJECT_AUTOLOAD_FILE_LIMIT ? 'ok' : 'large-project',
    fileCountSample,
    limit: LARGE_PROJECT_AUTOLOAD_FILE_LIMIT,
  }
}

export async function searchProjectFiles(projectPath: string, query: string): Promise<ProjectFileNode[]> {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) return []

  const rootRealPath = await resolveRoot(projectPath)

  let resolvedPaths = getProjectFileListFromCache(rootRealPath)
  if (!resolvedPaths) {
    const listedPaths = await listProjectFilesByRipgrep(rootRealPath)
    if (listedPaths) {
      listedPaths.sort((a, b) => a.localeCompare(b))
      const filtered = filterListedFilePaths(listedPaths)
      resolvedPaths = filtered.acceptedPaths
    } else {
      const counters: ScanCounters = {
        filesScanned: 0,
        skippedFiles: 0,
        skippedDirectories: 0,
      }
      const tree = await scanDirectoryFallback(rootRealPath, rootRealPath, 0, counters)
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
      resolvedPaths = nextPaths
    }
    setProjectFileListCache(rootRealPath, resolvedPaths)
  }

  const matches: ProjectFileNode[] = []
  for (const relativePath of resolvedPaths) {
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
