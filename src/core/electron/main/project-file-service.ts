import { Dirent } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type {
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

interface ResolvePathsResult {
  rootRealPath: string
  targetRealPath: string
  normalizedRelativePath: string
}

interface ScanCounters {
  filesScanned: number
  skippedFiles: number
  skippedDirectories: number
}

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

async function resolveTargetPaths(projectPath: string, relativePath: string): Promise<ResolvePathsResult> {
  const rootRealPath = await resolveRoot(projectPath)
  const normalizedRelativePath = normalizeRelativeInput(relativePath)
  validateRelativePathLooksSafe(normalizedRelativePath)
  const targetCandidatePath = path.resolve(rootRealPath, normalizedRelativePath)
  const targetRealPath = await fs.realpath(targetCandidatePath)
  ensureWithinRoot(rootRealPath, targetRealPath)
  return {
    rootRealPath,
    targetRealPath,
    normalizedRelativePath: toPosixRelativePath(normalizedRelativePath),
  }
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

async function scanDirectory(
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

      const children = await scanDirectory(rootRealPath, entryAbsolutePath, depth + 1, counters)
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
  const counters: ScanCounters = {
    filesScanned: 0,
    skippedFiles: 0,
    skippedDirectories: 0,
  }
  const nodes = await scanDirectory(rootRealPath, rootRealPath, 0, counters)
  return {
    rootPath: rootRealPath,
    nodes,
    skipped: {
      files: counters.skippedFiles,
      directories: counters.skippedDirectories,
    },
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
