import { promises as fs } from 'node:fs'
import path from 'node:path'
import { shell } from 'electron'
import type { ProjectFileReadResult, ProjectFileStatResult, ProjectFileWriteImageResult, ProjectFileWriteResult } from '../../../shared/types'
import { toHostAccessiblePath } from '../host-path'
import { wslBridge } from '../wsl-bridge'
import {
  containsBinaryNullByte,
  ensureWithinRoot,
  inferLanguageFromPath,
  inferPreviewKindFromPath,
  isLikelyBinaryByExtension,
  MAX_PREVIEW_IMAGE_BYTES,
  MAX_PREVIEW_MEDIA_BYTES,
  MAX_PREVIEW_PDF_BYTES,
  MAX_TEXT_FILE_SIZE,
  mimeTypeFromPreviewPath,
  normalizeImageExtension,
  normalizeRelativeInput,
  openValidatedFileHandle,
  ProjectFileServiceError,
  resolveRoot,
  toPosixRelativePath,
  validateRelativePathLooksSafe,
} from './shared'

function toUnsupportedReadResult(relativePath: string, stat: { size: number; mtimeMs: number }): ProjectFileReadResult {
  return {
    relativePath,
    content: '',
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    language: inferLanguageFromPath(relativePath),
    encoding: 'utf-8',
    kind: 'unsupported',
  }
}

export async function readProjectFile(projectPath: string, relativePath: string): Promise<ProjectFileReadResult> {
  const opened = await openValidatedFileHandle(projectPath, relativePath)
  const { fileHandle, stat, normalizedRelativePath } = opened

  try {
    const kind = inferPreviewKindFromPath(normalizedRelativePath)

    if (kind === 'unsupported') {
      return toUnsupportedReadResult(normalizedRelativePath, stat)
    }

    if (kind === 'image' || kind === 'pdf' || kind === 'video' || kind === 'audio') {
      const limit = kind === 'image' ? MAX_PREVIEW_IMAGE_BYTES : kind === 'pdf' ? MAX_PREVIEW_PDF_BYTES : MAX_PREVIEW_MEDIA_BYTES
      if (stat.size > limit) {
        return toUnsupportedReadResult(normalizedRelativePath, stat)
      }
      const buffer = await fileHandle.readFile()
      return {
        relativePath: normalizedRelativePath,
        content: buffer.toString('base64'),
        size: buffer.byteLength,
        mtimeMs: stat.mtimeMs,
        language: inferLanguageFromPath(normalizedRelativePath),
        encoding: 'base64',
        kind,
        mimeType: mimeTypeFromPreviewPath(normalizedRelativePath),
      }
    }

    if (isLikelyBinaryByExtension(normalizedRelativePath)) {
      return toUnsupportedReadResult(normalizedRelativePath, stat)
    }

    if (stat.size > MAX_TEXT_FILE_SIZE) {
      return toUnsupportedReadResult(normalizedRelativePath, stat)
    }

    const hasNullByte = await containsBinaryNullByte(fileHandle)
    if (hasNullByte) {
      return toUnsupportedReadResult(normalizedRelativePath, stat)
    }

    const content = await fileHandle.readFile({ encoding: 'utf-8' })
    return {
      relativePath: normalizedRelativePath,
      content,
      size: Buffer.byteLength(content, 'utf-8'),
      mtimeMs: stat.mtimeMs,
      language: inferLanguageFromPath(normalizedRelativePath),
      encoding: 'utf-8',
      kind,
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

export async function writeProjectFile(projectPath: string, relativePath: string, content: string, expectedMtimeMs?: number): Promise<ProjectFileWriteResult> {
  const opened = await openValidatedFileHandle(projectPath, relativePath)
  const { fileHandle, stat, rootRealPath, targetRealPath, normalizedRelativePath } = opened

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

export async function writeProjectImageFile(projectPath: string, targetDirectoryRelativePath: string, extension: string, dataBase64: string): Promise<ProjectFileWriteImageResult> {
  const rootRealPath = await resolveRoot(projectPath)
  const normalizedTargetDirectory = normalizeRelativeInput(targetDirectoryRelativePath)
  validateRelativePathLooksSafe(normalizedTargetDirectory)

  const targetDirectoryPath = path.resolve(rootRealPath, normalizedTargetDirectory)
  ensureWithinRoot(rootRealPath, targetDirectoryPath)

  await fs.mkdir(targetDirectoryPath, { recursive: true })

  const directoryRealPath = await fs.realpath(targetDirectoryPath)
  ensureWithinRoot(rootRealPath, directoryRealPath)

  let dataBuffer: Buffer
  try {
    dataBuffer = Buffer.from(dataBase64, 'base64')
  } catch {
    throw new ProjectFileServiceError('Invalid image payload.')
  }

  if (!dataBuffer.length) {
    throw new ProjectFileServiceError('Image payload is empty.')
  }

  const normalizedExtension = normalizeImageExtension(extension)
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${normalizedExtension}`
  const filePath = path.join(directoryRealPath, fileName)
  await fs.writeFile(filePath, dataBuffer)
  const stat = await fs.stat(filePath)

  const relativePath = toPosixRelativePath(path.relative(rootRealPath, filePath))
  if (!relativePath || relativePath.startsWith('..') || path.posix.isAbsolute(relativePath)) {
    throw new ProjectFileServiceError('Failed to resolve image path within project root.')
  }

  return {
    relativePath,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
  }
}

function resolvePathForCurrentHost(pathValue: string): string {
  const trimmed = pathValue.trim()
  if (!trimmed) return ''

  if (process.platform === 'win32') {
    return toHostAccessiblePath(trimmed)
  }

  if (/^[A-Za-z]:[\\/]/.test(trimmed)) {
    return wslBridge.toWslPath(trimmed)
  }

  return trimmed
}

export async function openProjectFileInSystem(projectPath: string, relativePath: string): Promise<{ ok: boolean; error?: string }> {
  const opened = await openValidatedFileHandle(projectPath, relativePath)
  const { fileHandle, targetRealPath } = opened

  try {
    const resolved = resolvePathForCurrentHost(targetRealPath)
    if (!resolved) {
      return { ok: false, error: 'Failed to resolve file path for current host.' }
    }
    const error = await shell.openPath(resolved)
    if (error) {
      return { ok: false, error }
    }
    return { ok: true }
  } finally {
    await fileHandle.close().catch(() => undefined)
  }
}
