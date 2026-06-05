import { promises as fs } from 'node:fs'
import path from 'node:path'
import type {
  ProjectFileReadResult,
  ProjectFileStatResult,
  ProjectFileWriteImageResult,
  ProjectFileWriteResult,
} from '../../../shared/types'
import {
  MAX_TEXT_FILE_SIZE,
  ProjectFileServiceError,
  containsBinaryNullByte,
  ensureWithinRoot,
  inferLanguageFromPath,
  isLikelyBinaryByExtension,
  normalizeImageExtension,
  normalizeRelativeInput,
  openValidatedFileHandle,
  resolveRoot,
  toPosixRelativePath,
  validateRelativePathLooksSafe,
} from './shared'

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

export async function writeProjectImageFile(
  projectPath: string,
  targetDirectoryRelativePath: string,
  extension: string,
  dataBase64: string
): Promise<ProjectFileWriteImageResult> {
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
