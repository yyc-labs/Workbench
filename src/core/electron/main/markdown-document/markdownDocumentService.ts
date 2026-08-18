import path from 'node:path'
import { dialog, type BrowserWindow, type OpenDialogOptions, type SaveDialogOptions } from 'electron'
import { readFile, stat, writeFile } from 'node:fs/promises'
import type { MarkdownDocumentHistoryEntry, MarkdownDocumentImageSaveResult, MarkdownDocumentReadResult, MarkdownDocumentWriteResult } from '../../../shared/types'
import { MARKDOWN_DOCUMENT_MAX_SIZE, normalizeMarkdownDocumentPath, resolveMarkdownDocumentPath } from './markdownDocumentPath'
import { MarkdownDocumentRepository } from './markdownDocumentRepository'

const MARKDOWN_DOCUMENT_PASTED_IMAGE_MAX_SIZE = 10 * 1024 * 1024

const IMAGE_EXTENSION_FILTERS: Record<string, { name: string; extensions: string[] }> = {
  png: { name: 'PNG image', extensions: ['png'] },
  jpg: { name: 'JPEG image', extensions: ['jpg', 'jpeg'] },
  jpeg: { name: 'JPEG image', extensions: ['jpg', 'jpeg'] },
  gif: { name: 'GIF image', extensions: ['gif'] },
  webp: { name: 'WebP image', extensions: ['webp'] },
  bmp: { name: 'BMP image', extensions: ['bmp'] },
}

function normalizePastedImageExtension(extension: string): string {
  const normalized = extension.trim().toLowerCase().replace(/^\./, '')
  if (normalized === 'jpeg') return 'jpg'
  if (normalized === 'png' || normalized === 'jpg' || normalized === 'gif' || normalized === 'webp' || normalized === 'bmp') return normalized
  return 'png'
}

function normalizeSuggestedImageName(suggestedName: string | undefined, extension: string): string {
  const safeName = suggestedName?.replace(/[<>:"\/\\|?*\x00-\x1F]+/g, '-').trim()
  const baseName = safeName || `pasted-image-${Date.now()}`
  return path.extname(baseName) ? baseName : `${baseName}.${extension}`
}

function ensureImageExtension(filePath: string, extension: string): string {
  return path.extname(filePath) ? filePath : `${filePath}.${extension}`
}

export class MarkdownDocumentService {
  constructor(
    private readonly repository: MarkdownDocumentRepository,
    private readonly getWindow: () => BrowserWindow | null,
  ) {}

  async select(): Promise<string | null> {
    const options: OpenDialogOptions = {
      properties: ['openFile'],
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
    }
    const window = this.getWindow()
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  }

  async read(filePath: string): Promise<MarkdownDocumentReadResult> {
    const resolvedPath = await resolveMarkdownDocumentPath(filePath)
    const fileStats = await stat(resolvedPath)
    if (fileStats.size > MARKDOWN_DOCUMENT_MAX_SIZE) throw new Error('Markdown document exceeds the 1 MiB limit.')
    const buffer = await readFile(resolvedPath)
    if (buffer.includes(0)) throw new Error('Binary files are not supported.')
    const content = buffer.toString('utf8').replace(/^\uFEFF/, '')
    const entry: MarkdownDocumentHistoryEntry = {
      path: resolvedPath,
      normalizedPath: normalizeMarkdownDocumentPath(resolvedPath),
      displayName: path.basename(resolvedPath),
      lastOpenedAt: Date.now(),
      lastKnownMtimeMs: fileStats.mtimeMs,
    }
    await this.repository.record(entry)
    return { path: resolvedPath, content, size: buffer.byteLength, mtimeMs: fileStats.mtimeMs, encoding: 'utf-8' }
  }

  async write(filePath: string, content: string, expectedMtimeMs: number): Promise<MarkdownDocumentWriteResult> {
    const resolvedPath = await resolveMarkdownDocumentPath(filePath)
    const currentStats = await stat(resolvedPath)
    if (currentStats.mtimeMs !== expectedMtimeMs) {
      const error = new Error('Markdown document was modified externally.') as Error & { code?: string; actualMtimeMs?: number }
      error.code = 'conflict'
      error.actualMtimeMs = currentStats.mtimeMs
      throw error
    }
    const buffer = Buffer.from(content, 'utf8')
    if (buffer.byteLength > MARKDOWN_DOCUMENT_MAX_SIZE) throw new Error('Markdown document exceeds the 1 MiB limit.')
    await writeFile(resolvedPath, buffer)
    const nextStats = await stat(resolvedPath)
    return { path: resolvedPath, size: buffer.byteLength, mtimeMs: nextStats.mtimeMs }
  }

  async savePastedImageAs(dataBase64: string, extension: string, suggestedName?: string): Promise<MarkdownDocumentImageSaveResult | null> {
    let dataBuffer: Buffer
    try {
      dataBuffer = Buffer.from(dataBase64, 'base64')
    } catch {
      throw new Error('Invalid image payload.')
    }
    if (!dataBuffer.length) throw new Error('Image payload is empty.')
    if (dataBuffer.byteLength > MARKDOWN_DOCUMENT_PASTED_IMAGE_MAX_SIZE) throw new Error('Image file is too large.')

    const normalizedExtension = normalizePastedImageExtension(extension)
    const primaryFilter = IMAGE_EXTENSION_FILTERS[normalizedExtension] ?? IMAGE_EXTENSION_FILTERS.png
    const options: SaveDialogOptions = {
      defaultPath: normalizeSuggestedImageName(suggestedName, normalizedExtension),
      filters: primaryFilter ? [primaryFilter, { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }] : [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
    }
    const window = this.getWindow()
    const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null

    const targetPath = ensureImageExtension(result.filePath, normalizedExtension)
    await writeFile(targetPath, dataBuffer)
    const nextStats = await stat(targetPath)
    return { path: targetPath, size: dataBuffer.byteLength, mtimeMs: nextStats.mtimeMs }
  }

  listHistory(): Promise<MarkdownDocumentHistoryEntry[]> {
    return this.repository.list()
  }
  removeHistory(filePath: string): Promise<MarkdownDocumentHistoryEntry[]> {
    return this.repository.remove(normalizeMarkdownDocumentPath(filePath))
  }
  clearHistory(): Promise<void> {
    return this.repository.clear()
  }
}
