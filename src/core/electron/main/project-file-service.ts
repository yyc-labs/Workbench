import { Dirent } from 'node:fs'
import { promises as fs } from 'node:fs'
import { execFile } from 'node:child_process'
import path from 'node:path'
import type {
  ProjectFileContentSearchOptions,
  ProjectFileContentSearchResponse,
  ProjectFileContentSearchResult,
  ProjectFileContentMatch,
  ProjectFileNode,
  ProjectFileReadResult,
  ProjectFileStatResult,
  ProjectFileTreeResult,
  ProjectFileWriteResult,
} from '../../shared/types'

const MAX_TEXT_FILE_SIZE = 1024 * 1024
const MAX_TREE_FILES = 5000
const MAX_TREE_DEPTH = 8
const MAX_BINARY_PROBE_BYTES = 8 * 1024
const RG_FILE_LIST_TIMEOUT_MS = 20_000
const RG_FILE_LIST_MAX_BUFFER = 64 * 1024 * 1024
const MAX_SEARCH_RESULTS = 500
const PROJECT_FILE_LIST_CACHE_TTL_MS = 15_000
const MAX_CONTENT_SEARCH_FILES = 200
const MAX_CONTENT_SEARCH_TOTAL_MATCHES = 2000
const MAX_CONTENT_SEARCH_MATCHES_PER_FILE = 40
const RG_CONTENT_SEARCH_TIMEOUT_MS = 25_000
const RG_CONTENT_SEARCH_MAX_BUFFER = 128 * 1024 * 1024
const RG_CONTENT_SEARCH_MAX_COLUMNS = 500

const EXCLUDED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  'coverage',
  '.venv',
  'venv',
  '__pycache__',
])

const EXCLUDED_FILES = new Set([
  '.DS_Store',
  'Thumbs.db',
])

const RG_EXCLUDE_GLOBS = (() => {
  const globs = new Set<string>()
  for (const directory of EXCLUDED_DIRECTORIES) {
    globs.add(`!${directory}/**`)
    globs.add(`!**/${directory}/**`)
  }
  for (const file of EXCLUDED_FILES) {
    globs.add(`!${file}`)
    globs.add(`!**/${file}`)
  }
  return Array.from(globs)
})()

const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.bmp',
  '.tiff',
  '.mp3',
  '.wav',
  '.flac',
  '.aac',
  '.ogg',
  '.m4a',
  '.mp4',
  '.mov',
  '.mkv',
  '.avi',
  '.webm',
  '.pdf',
  '.zip',
  '.gz',
  '.tar',
  '.tgz',
  '.7z',
  '.rar',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.jar',
  '.class',
  '.wasm',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bin',
  '.dat',
  '.db',
  '.sqlite',
  '.sqlite3',
  '.lockb',
])

class ProjectFileServiceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProjectFileServiceError'
  }
}

interface ScanCounters {
  filesScanned: number
  skippedFiles: number
  skippedDirectories: number
}

interface TreeDirectoryBucket {
  node: ProjectFileNode
  directoryChildren: Map<string, TreeDirectoryBucket>
  fileChildren: Set<string>
}

interface ProjectFileListCacheEntry {
  paths: string[]
  updatedAtMs: number
}

interface FilterListedPathsResult {
  acceptedPaths: string[]
  skippedFiles: number
}

interface RgOutputData {
  text?: string
  bytes?: string
}

interface RgOutputSubmatch {
  start?: number
  end?: number
}

interface RgJsonMatchMessage {
  type?: string
  data?: {
    path?: RgOutputData
    lines?: RgOutputData
    line_number?: number
    submatches?: RgOutputSubmatch[]
  }
}

const projectFileListCache = new Map<string, ProjectFileListCacheEntry>()

function toPosixRelativePath(value: string): string {
  return value.replace(/\\/g, '/')
}

function normalizeRelativeInput(relativePath: string): string {
  const trimmed = relativePath.trim()
  if (!trimmed) {
    throw new ProjectFileServiceError('Relative file path is required.')
  }
  const normalized = path.posix.normalize(trimmed.replace(/\\/g, '/'))
  if (normalized === '.' || normalized === '') {
    throw new ProjectFileServiceError('Relative file path is required.')
  }
  if (normalized.startsWith('../') || normalized === '..') {
    throw new ProjectFileServiceError('Path traversal is not allowed.')
  }
  if (path.posix.isAbsolute(normalized)) {
    throw new ProjectFileServiceError('Absolute paths are not allowed.')
  }
  return normalized
}

function validateRelativePathLooksSafe(relativePath: string): void {
  if (path.isAbsolute(relativePath)) {
    throw new ProjectFileServiceError('Absolute paths are not allowed.')
  }

  // Explicitly reject Windows drive-style absolute paths on non-Windows hosts.
  if (/^[A-Za-z]:[\\/]/.test(relativePath)) {
    throw new ProjectFileServiceError('Windows absolute paths are not allowed.')
  }
}

function ensureWithinRoot(rootRealPath: string, targetRealPath: string): void {
  if (targetRealPath === rootRealPath) return
  if (targetRealPath.startsWith(`${rootRealPath}${path.sep}`)) return
  throw new ProjectFileServiceError('Target path is outside project root.')
}

async function resolveRoot(projectPath: string): Promise<string> {
  const rootRealPath = await fs.realpath(projectPath)
  const rootStat = await fs.stat(rootRealPath)
  if (!rootStat.isDirectory()) {
    throw new ProjectFileServiceError('Project path is not a directory.')
  }
  return rootRealPath
}

async function openValidatedFileHandle(projectPath: string, relativePath: string) {
  const rootRealPath = await resolveRoot(projectPath)
  const normalizedRelativePath = normalizeRelativeInput(relativePath)
  validateRelativePathLooksSafe(normalizedRelativePath)
  const targetCandidatePath = path.resolve(rootRealPath, normalizedRelativePath)
  const targetRealPath = await fs.realpath(targetCandidatePath)
  ensureWithinRoot(rootRealPath, targetRealPath)
  const fileHandle = await fs.open(targetRealPath, 'r')

  try {
    const stat = await fileHandle.stat()
    if (!stat.isFile()) {
      throw new ProjectFileServiceError('Selected path is not a regular file.')
    }
    return {
      fileHandle,
      stat,
      rootRealPath,
      targetRealPath,
      normalizedRelativePath: toPosixRelativePath(normalizedRelativePath),
    }
  } catch (error) {
    await fileHandle.close().catch(() => undefined)
    throw error
  }
}

function inferLanguageFromPath(relativePath: string): string {
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
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'yaml'
  if (lower.endsWith('.xml')) return 'xml'
  if (lower.endsWith('.sh') || lower.endsWith('.bash')) return 'shell'
  if (lower.endsWith('.toml')) return 'toml'
  return 'plaintext'
}

function isExcludedDirectory(name: string): boolean {
  return EXCLUDED_DIRECTORIES.has(name)
}

function isExcludedFile(name: string): boolean {
  return EXCLUDED_FILES.has(name)
}

function isLikelyBinaryByExtension(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  return BINARY_EXTENSIONS.has(ext)
}

async function containsBinaryNullByte(fileHandle: fs.FileHandle): Promise<boolean> {
  const probe = Buffer.alloc(MAX_BINARY_PROBE_BYTES)
  const { bytesRead } = await fileHandle.read(probe, 0, MAX_BINARY_PROBE_BYTES, 0)
  for (let i = 0; i < bytesRead; i++) {
    if (probe[i] === 0) return true
  }
  return false
}

function normalizeListedRelativePath(rawPath: string): string | null {
  const normalized = path.posix.normalize(rawPath.trim().replace(/\\/g, '/'))
  if (!normalized || normalized === '.' || normalized === '..') return null
  if (normalized.startsWith('../') || path.posix.isAbsolute(normalized)) return null
  return normalized
}

function hasExcludedDirectorySegment(relativePath: string): boolean {
  const segments = relativePath.split('/')
  if (segments.length <= 1) return false
  for (let i = 0; i < segments.length - 1; i += 1) {
    if (isExcludedDirectory(segments[i])) return true
  }
  return false
}

function shouldSkipListedFilePath(relativePath: string): boolean {
  const segments = relativePath.split('/')
  const fileName = segments[segments.length - 1]
  if (!fileName) return true
  if (isExcludedFile(fileName)) return true
  if (hasExcludedDirectorySegment(relativePath)) return true
  return false
}

function fileDepth(relativePath: string): number {
  return relativePath.split('/').length - 1
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

function fuzzyPathMatch(query: string, candidate: string): boolean {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return true

  const normalizedCandidate = candidate.toLowerCase()
  if (normalizedCandidate.includes(normalizedQuery)) return true

  const compactQuery = compactPathToken(normalizedQuery)
  const compactCandidate = compactPathToken(normalizedCandidate)
  if (!compactQuery) return true

  return isSubsequenceMatch(compactQuery, compactCandidate)
}

function fileNameFromRelativePath(relativePath: string): string {
  const segments = relativePath.split('/')
  return segments[segments.length - 1] || relativePath
}

function decodeRgOutputData(data: RgOutputData | undefined): string {
  if (!data) return ''
  if (typeof data.text === 'string') return data.text
  if (typeof data.bytes === 'string') {
    try {
      return Buffer.from(data.bytes, 'base64').toString('utf8')
    } catch {
      return ''
    }
  }
  return ''
}

function normalizeSearchLineText(lineText: string): string {
  return lineText.replace(/\r?\n$/, '')
}

function parseSearchMatchLine(rawLine: string): RgJsonMatchMessage | null {
  const trimmed = rawLine.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed) as RgJsonMatchMessage
  } catch {
    return null
  }
}

function toContentSearchResultRecord(results: Map<string, ProjectFileContentSearchResult>, relativePath: string) {
  const existing = results.get(relativePath)
  if (existing) return existing
  const next: ProjectFileContentSearchResult = {
    relativePath,
    name: fileNameFromRelativePath(relativePath),
    matchCount: 0,
    matches: [],
  }
  results.set(relativePath, next)
  return next
}

function filterListedFilePaths(listedPaths: string[]): FilterListedPathsResult {
  let skippedFiles = 0
  const acceptedPaths: string[] = []

  for (const relativePath of listedPaths) {
    if (shouldSkipListedFilePath(relativePath)) {
      skippedFiles += 1
      continue
    }

    if (fileDepth(relativePath) > MAX_TREE_DEPTH) {
      skippedFiles += 1
      continue
    }

    if (acceptedPaths.length >= MAX_TREE_FILES) {
      skippedFiles += 1
      continue
    }

    acceptedPaths.push(relativePath)
  }

  return { acceptedPaths, skippedFiles }
}

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

function createDirectoryBucket(name: string, relativePath: string): TreeDirectoryBucket {
  return {
    node: {
      name,
      relativePath,
      kind: 'directory',
      children: [],
    },
    directoryChildren: new Map(),
    fileChildren: new Set(),
  }
}

function insertFileIntoTree(rootBucket: TreeDirectoryBucket, relativePath: string): void {
  const segments = relativePath.split('/').filter(Boolean)
  if (segments.length === 0) return

  let bucket = rootBucket
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i]
    let childDirectory = bucket.directoryChildren.get(segment)
    if (!childDirectory) {
      const directoryPath = segments.slice(0, i + 1).join('/')
      childDirectory = createDirectoryBucket(segment, directoryPath)
      bucket.directoryChildren.set(segment, childDirectory)
      ;(bucket.node.children as ProjectFileNode[]).push(childDirectory.node)
    }
    bucket = childDirectory
  }

  const fileName = segments[segments.length - 1]
  if (!fileName || bucket.fileChildren.has(fileName)) return
  bucket.fileChildren.add(fileName)
  ;(bucket.node.children as ProjectFileNode[]).push({
    name: fileName,
    relativePath,
    kind: 'file',
  })
}

function buildTreeFromRelativePaths(relativePaths: string[]): ProjectFileNode[] {
  const rootBucket = createDirectoryBucket('', '')
  for (const relativePath of relativePaths) {
    insertFileIntoTree(rootBucket, relativePath)
  }
  return rootBucket.node.children ?? []
}

async function execFileUtf8(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'rg',
      args,
      {
        cwd,
        encoding: 'utf8',
        timeout: RG_FILE_LIST_TIMEOUT_MS,
        maxBuffer: RG_FILE_LIST_MAX_BUFFER,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error) {
          const next = error as NodeJS.ErrnoException & { stdout?: string }
          next.stdout = typeof stdout === 'string' ? stdout : ''
          reject(next)
          return
        }
        resolve(typeof stdout === 'string' ? stdout : '')
      }
    )
  })
}

async function execFileUtf8WithLimits(
  cwd: string,
  args: string[],
  timeoutMs: number,
  maxBufferBytes: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'rg',
      args,
      {
        cwd,
        encoding: 'utf8',
        timeout: timeoutMs,
        maxBuffer: maxBufferBytes,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error) {
          const next = error as NodeJS.ErrnoException & { stdout?: string }
          next.stdout = typeof stdout === 'string' ? stdout : ''
          reject(next)
          return
        }
        resolve(typeof stdout === 'string' ? stdout : '')
      }
    )
  })
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

    // rg exits with code 1 when there are no files to print.
    if (String(errorCode) === '1') {
      const stdout = typedError.stdout ?? ''
      if (!stdout) return []
      return stdout
        .split('\0')
        .map(normalizeListedRelativePath)
        .filter((item): item is string => Boolean(item))
    }

    // ENOENT means rg is not installed; fallback to legacy scanner.
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
        children,
      })
      continue
    }

    if (!entry.isFile()) {
      continue
    }

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

export async function listProjectFiles(projectPath: string): Promise<ProjectFileTreeResult> {
  const rootRealPath = await resolveRoot(projectPath)

  const listedPaths = await listProjectFilesByRipgrep(rootRealPath)
  if (listedPaths) {
    listedPaths.sort((a, b) => a.localeCompare(b))

    const filtered = filterListedFilePaths(listedPaths)
    setProjectFileListCache(rootRealPath, filtered.acceptedPaths)

    return {
      rootPath: rootRealPath,
      nodes: buildTreeFromRelativePaths(filtered.acceptedPaths),
      skipped: {
        files: filtered.skippedFiles,
        directories: 0,
      },
    }
  }

  // Fallback keeps behavior functional when rg is unavailable.
  const counters: ScanCounters = {
    filesScanned: 0,
    skippedFiles: 0,
    skippedDirectories: 0,
  }
  const nodes = await scanDirectoryFallback(rootRealPath, rootRealPath, 0, counters)
  return {
    rootPath: rootRealPath,
    nodes,
    skipped: {
      files: counters.skippedFiles,
      directories: counters.skippedDirectories,
    },
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
      const tree = await listProjectFiles(projectPath)
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
      walk(tree.nodes)
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

export async function searchProjectContent(
  projectPath: string,
  query: string,
  options?: ProjectFileContentSearchOptions
): Promise<ProjectFileContentSearchResponse> {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) {
    return {
      files: [],
      totalMatches: 0,
      limited: false,
    }
  }

  const rootRealPath = await resolveRoot(projectPath)
  const caseSensitive = options?.caseSensitive === true
  const args = [
    '--json',
    '--hidden',
    '--no-ignore',
    '--fixed-strings',
    ...(caseSensitive ? ['--case-sensitive'] : ['--ignore-case']),
    '--line-number',
    '--column',
    '--max-columns',
    String(RG_CONTENT_SEARCH_MAX_COLUMNS),
    '--max-count',
    String(MAX_CONTENT_SEARCH_MATCHES_PER_FILE),
    ...RG_EXCLUDE_GLOBS.flatMap((glob) => ['--glob', glob]),
    '-e',
    normalizedQuery,
    '.',
  ]

  let output = ''
  try {
    output = await execFileUtf8WithLimits(
      rootRealPath,
      args,
      RG_CONTENT_SEARCH_TIMEOUT_MS,
      RG_CONTENT_SEARCH_MAX_BUFFER
    )
  } catch (error) {
    const typedError = error as NodeJS.ErrnoException & { code?: unknown; stdout?: string }
    const errorCode = String(typedError.code ?? '')
    if (errorCode === '1') {
      return {
        files: [],
        totalMatches: 0,
        limited: false,
      }
    }
    if (typedError.code === 'ENOENT') {
      throw new ProjectFileServiceError('rg is not installed. Install ripgrep to enable content search.')
    }
    if (typedError.code === 'ETIMEDOUT') {
      throw new ProjectFileServiceError('Content search timed out. Please refine your query.')
    }
    throw error
  }

  const resultMap = new Map<string, ProjectFileContentSearchResult>()
  let totalMatches = 0
  let limited = false
  const lines = output.split(/\r?\n/)

  for (const rawLine of lines) {
    const parsed = parseSearchMatchLine(rawLine)
    if (!parsed || parsed.type !== 'match') continue

    const relativePath = normalizeListedRelativePath(decodeRgOutputData(parsed.data?.path))
    if (!relativePath) continue
    if (shouldSkipListedFilePath(relativePath)) continue
    if (fileDepth(relativePath) > MAX_TREE_DEPTH) continue

    const matchLineNumber = parsed.data?.line_number
    if (typeof matchLineNumber !== 'number' || !Number.isFinite(matchLineNumber) || matchLineNumber <= 0) continue

    const lineTextRaw = decodeRgOutputData(parsed.data?.lines)
    const lineText = normalizeSearchLineText(lineTextRaw)
    const submatch = parsed.data?.submatches?.[0]
    const start = typeof submatch?.start === 'number' ? submatch.start : 0
    const end = typeof submatch?.end === 'number' ? submatch.end : start + normalizedQuery.length
    const column = Math.max(1, start + 1)
    const endColumn = Math.max(column, end + 1)

    const perFile = toContentSearchResultRecord(resultMap, relativePath)
    if (perFile.matches.length < MAX_CONTENT_SEARCH_MATCHES_PER_FILE) {
      const nextMatch: ProjectFileContentMatch = {
        lineNumber: matchLineNumber,
        column,
        endColumn,
        lineText,
      }
      perFile.matches.push(nextMatch)
    } else {
      limited = true
    }

    perFile.matchCount += 1
    totalMatches += 1

    if (resultMap.size > MAX_CONTENT_SEARCH_FILES || totalMatches >= MAX_CONTENT_SEARCH_TOTAL_MATCHES) {
      limited = true
      break
    }
  }

  const orderedFiles = Array.from(resultMap.values())
    .sort((a, b) => b.matchCount - a.matchCount || a.relativePath.localeCompare(b.relativePath))
    .slice(0, MAX_CONTENT_SEARCH_FILES)

  if (orderedFiles.length < resultMap.size) {
    limited = true
  }

  return {
    files: orderedFiles,
    totalMatches,
    limited,
  }
}

export async function readProjectFile(projectPath: string, relativePath: string): Promise<ProjectFileReadResult> {
  const opened = await openValidatedFileHandle(projectPath, relativePath)
  const { fileHandle, stat, normalizedRelativePath } = opened

  try {
    if (isLikelyBinaryByExtension(normalizedRelativePath)) {
      throw new ProjectFileServiceError('Cannot open binary file.')
    }

    if (stat.size > MAX_TEXT_FILE_SIZE) {
      throw new ProjectFileServiceError(`File is too large. Limit is ${MAX_TEXT_FILE_SIZE} bytes.`)
    }

    const hasNullByte = await containsBinaryNullByte(fileHandle)
    if (hasNullByte) {
      throw new ProjectFileServiceError('Cannot open binary file.')
    }

    const content = await fileHandle.readFile({ encoding: 'utf-8' })
    return {
      relativePath: normalizedRelativePath,
      content,
      size: Buffer.byteLength(content, 'utf-8'),
      mtimeMs: stat.mtimeMs,
      language: inferLanguageFromPath(normalizedRelativePath),
      encoding: 'utf-8',
    }
  } finally {
    await fileHandle.close().catch(() => undefined)
  }
}

export async function statProjectFile(projectPath: string, relativePath: string): Promise<ProjectFileStatResult> {
  const opened = await openValidatedFileHandle(projectPath, relativePath)
  const { fileHandle, stat, normalizedRelativePath } = opened

  try {
    return {
      relativePath: normalizedRelativePath,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    }
  } finally {
    await fileHandle.close().catch(() => undefined)
  }
}

export async function writeProjectFile(
  projectPath: string,
  relativePath: string,
  content: string,
  expectedMtimeMs?: number
): Promise<ProjectFileWriteResult> {
  const opened = await openValidatedFileHandle(projectPath, relativePath)
  const {
    fileHandle,
    stat,
    rootRealPath,
    targetRealPath,
    normalizedRelativePath,
  } = opened

  try {
    if (isLikelyBinaryByExtension(normalizedRelativePath)) {
      throw new ProjectFileServiceError('Cannot write binary file.')
    }

    const nextSize = Buffer.byteLength(content, 'utf-8')
    if (nextSize > MAX_TEXT_FILE_SIZE) {
      throw new ProjectFileServiceError(`File is too large. Limit is ${MAX_TEXT_FILE_SIZE} bytes.`)
    }

    if (typeof expectedMtimeMs === 'number') {
      const currentMtimeMs = stat.mtimeMs
      if (Math.abs(currentMtimeMs - expectedMtimeMs) > 0.001) {
        throw new ProjectFileServiceError('File has changed on disk. Please reload before saving.')
      }
    }

    await fileHandle.close()

    // Resolve again before writing to defend against path/symlink races.
    const writeTargetPath = path.resolve(rootRealPath, normalizedRelativePath)
    const writeTargetRealPath = await fs.realpath(writeTargetPath)
    if (writeTargetRealPath !== targetRealPath) {
      throw new ProjectFileServiceError('File target changed unexpectedly. Please retry.')
    }
    ensureWithinRoot(rootRealPath, writeTargetRealPath)

    await fs.writeFile(writeTargetRealPath, content, { encoding: 'utf-8' })
    const afterStat = await fs.stat(writeTargetRealPath)

    return {
      relativePath: normalizedRelativePath,
      size: Buffer.byteLength(content, 'utf-8'),
      mtimeMs: afterStat.mtimeMs,
    }
  } catch (error) {
    await fileHandle.close().catch(() => undefined)
    throw error
  }
}

export function toProjectFileServiceErrorMessage(error: unknown): string {
  if (error instanceof ProjectFileServiceError) {
    return error.message
  }
  if (error instanceof Error && error.message) {
    return error.message
  }
  return 'Unknown project file service error.'
}
