import path from 'node:path'
import { dialog, type BrowserWindow, type OpenDialogOptions } from 'electron'
import { readFile, stat, writeFile } from 'node:fs/promises'
import type { MarkdownDocumentHistoryEntry, MarkdownDocumentReadResult, MarkdownDocumentWriteResult } from '../../../shared/types'
import { MARKDOWN_DOCUMENT_MAX_SIZE, normalizeMarkdownDocumentPath, resolveMarkdownDocumentPath } from './markdownDocumentPath'
import { MarkdownDocumentRepository } from './markdownDocumentRepository'

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
