import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import type { Dirent, Stats } from 'node:fs'
import path from 'node:path'
import type { ProjectFileContentSearchResult, ProjectFileNode } from '../../../shared/types'

export const MAX_TEXT_FILE_SIZE = 1024 * 1024
export const MAX_TREE_FILES = 5000
export const MAX_TREE_DEPTH = 8
export const MAX_DIRECTORY_ENTRIES = 10_000
export const LARGE_PROJECT_AUTOLOAD_FILE_LIMIT = 4000
export const MAX_BINARY_PROBE_BYTES = 8 * 1024
export const RG_FILE_LIST_TIMEOUT_MS = 20_000
export const RG_FILE_LIST_MAX_BUFFER = 16 * 1024 * 1024
export const MAX_SEARCH_RESULTS = 500
export const PROJECT_FILE_LIST_CACHE_TTL_MS = 15_000
export const MAX_CONTENT_SEARCH_FILES = 200
export const MAX_CONTENT_SEARCH_TOTAL_MATCHES = 2000
export const MAX_CONTENT_SEARCH_MATCHES_PER_FILE = 40
export const RG_CONTENT_SEARCH_TIMEOUT_MS = 25_000
export const RG_CONTENT_SEARCH_MAX_BUFFER = 32 * 1024 * 1024
export const RG_CONTENT_SEARCH_MAX_COLUMNS = 500

export const EXCLUDED_DIRECTORIES = new Set([
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

export const EXCLUDED_FILES = new Set([
  '.DS_Store',
  'Thumbs.db',
])

export const RG_EXCLUDE_GLOBS = (() => {
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

export class ProjectFileServiceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProjectFileServiceError'
  }
}

export interface ScanCounters {
  filesScanned: number
  skippedFiles: number
  skippedDirectories: number
}

export interface FilterListedPathsResult {
  acceptedPaths: string[]
  skippedFiles: number
}

export interface DirectoryListCounters {
  skippedFiles: number
  skippedDirectories: number
}

export interface AutoLoadProbeCounters {
  filesSeen: number
}

export interface RgOutputData {
  text?: string
  bytes?: string
}

export interface RgOutputSubmatch {
  start?: number
  end?: number
}

export interface RgJsonMatchMessage {
  type?: string
  data?: {
    path?: RgOutputData
    lines?: RgOutputData
    line_number?: number
    submatches?: RgOutputSubmatch[]
  }
}

export interface OpenValidatedFileHandleResult {
  fileHandle: fs.FileHandle
  stat: Stats
  rootRealPath: string
  targetRealPath: string
  normalizedRelativePath: string
}

export function toPosixRelativePath(value: string): string {
  return value.replace(/\\/g, '/')
}

export function normalizeRelativeInput(relativePath: string): string {
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

export function validateRelativePathLooksSafe(relativePath: string): void {
  if (path.isAbsolute(relativePath)) {
    throw new ProjectFileServiceError('Absolute paths are not allowed.')
  }

  if (/^[A-Za-z]:[\\/]/.test(relativePath)) {
    throw new ProjectFileServiceError('Windows absolute paths are not allowed.')
  }
}

export function compareTreeNodesByName(a: ProjectFileNode, b: ProjectFileNode): number {
  if (a.kind !== b.kind) {
    return a.kind === 'directory' ? -1 : 1
  }
  return a.name.localeCompare(b.name)
}

export function ensureWithinRoot(rootRealPath: string, targetRealPath: string): void {
  if (targetRealPath === rootRealPath) return
  if (targetRealPath.startsWith(`${rootRealPath}${path.sep}`)) return
  throw new ProjectFileServiceError('Target path is outside project root.')
}

export function normalizeImageExtension(extension: string): string {
  const normalized = extension.trim().toLowerCase().replace(/^\./, '')
  if (!normalized) return 'png'
  if (!/^[a-z0-9]+$/.test(normalized)) return 'png'
  const aliasMap: Record<string, string> = {
    jpeg: 'jpg',
    tif: 'tiff',
  }
  return aliasMap[normalized] ?? normalized
}

export async function resolveRoot(projectPath: string): Promise<string> {
  const rootRealPath = await fs.realpath(projectPath)
  const rootStat = await fs.stat(rootRealPath)
  if (!rootStat.isDirectory()) {
    throw new ProjectFileServiceError('Project path is not a directory.')
  }
  return rootRealPath
}

export async function openValidatedFileHandle(
  projectPath: string,
  relativePath: string
): Promise<OpenValidatedFileHandleResult> {
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

export function inferLanguageFromPath(relativePath: string): string {
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
  if (lower.endsWith('.vue')) return 'vue'
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

export function isExcludedDirectory(name: string): boolean {
  return EXCLUDED_DIRECTORIES.has(name)
}

export function isExcludedFile(name: string): boolean {
  return EXCLUDED_FILES.has(name)
}

export function isLikelyBinaryByExtension(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  return BINARY_EXTENSIONS.has(ext)
}

export async function containsBinaryNullByte(fileHandle: fs.FileHandle): Promise<boolean> {
  const probe = Buffer.alloc(MAX_BINARY_PROBE_BYTES)
  const { bytesRead } = await fileHandle.read(probe, 0, MAX_BINARY_PROBE_BYTES, 0)
  for (let i = 0; i < bytesRead; i += 1) {
    if (probe[i] === 0) return true
  }
  return false
}

export function normalizeListedRelativePath(rawPath: string): string | null {
  const normalized = path.posix.normalize(rawPath.trim().replace(/\\/g, '/'))
  if (!normalized || normalized === '.' || normalized === '..') return null
  if (normalized.startsWith('../') || path.posix.isAbsolute(normalized)) return null
  return normalized
}

export function hasExcludedDirectorySegment(relativePath: string): boolean {
  const segments = relativePath.split('/')
  if (segments.length <= 1) return false
  for (let i = 0; i < segments.length - 1; i += 1) {
    if (isExcludedDirectory(segments[i])) return true
  }
  return false
}

export function shouldSkipListedFilePath(relativePath: string): boolean {
  const segments = relativePath.split('/')
  const fileName = segments[segments.length - 1]
  if (!fileName) return true
  if (isExcludedFile(fileName)) return true
  if (hasExcludedDirectorySegment(relativePath)) return true
  return false
}

export function fileDepth(relativePath: string): number {
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

export function fileNameFromRelativePath(relativePath: string): string {
  const segments = relativePath.split('/')
  return segments[segments.length - 1] || relativePath
}

export function decodeRgOutputData(data: RgOutputData | undefined): string {
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

export function normalizeSearchLineText(lineText: string): string {
  return lineText.replace(/\r?\n$/, '')
}

export function normalizeContentSearchIncludeGlobs(includeGlobs: unknown): string[] {
  if (!Array.isArray(includeGlobs)) return []
  const normalized = Array.from(new Set(
    includeGlobs
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => item.length > 0)
  ))
  return normalized.slice(0, 24)
}

export function parseSearchMatchLine(rawLine: string): RgJsonMatchMessage | null {
  const trimmed = rawLine.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed) as RgJsonMatchMessage
  } catch {
    return null
  }
}

export function toContentSearchResultRecord(
  results: Map<string, ProjectFileContentSearchResult>,
  relativePath: string
): ProjectFileContentSearchResult {
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

export function filterListedFilePaths(listedPaths: string[]): FilterListedPathsResult {
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

export async function scanDirectoryForAutoLoadThreshold(
  rootRealPath: string,
  absoluteDirPath: string,
  depth: number,
  limit: number,
  counters: AutoLoadProbeCounters
): Promise<void> {
  if (counters.filesSeen > limit) return
  if (depth > MAX_TREE_DEPTH) return

  let entries: Dirent[]
  try {
    entries = await fs.readdir(absoluteDirPath, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (counters.filesSeen > limit) return

    const entryAbsolutePath = path.join(absoluteDirPath, entry.name)
    const relativePath = toPosixRelativePath(path.relative(rootRealPath, entryAbsolutePath))
    if (!relativePath || relativePath.startsWith('..')) continue

    if (entry.isDirectory()) {
      if (isExcludedDirectory(entry.name)) continue
      await scanDirectoryForAutoLoadThreshold(rootRealPath, entryAbsolutePath, depth + 1, limit, counters)
      continue
    }

    if (!entry.isFile()) continue
    if (isExcludedFile(entry.name)) continue
    counters.filesSeen += 1
  }
}

export async function execFileUtf8(cwd: string, args: string[]): Promise<string> {
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

export async function execFileUtf8WithLimits(
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

export function toProjectFileServiceErrorMessage(error: unknown): string {
  if (error instanceof ProjectFileServiceError) {
    return error.message
  }
  if (error instanceof Error && error.message) {
    return error.message
  }
  return 'Unknown project file service error.'
}
