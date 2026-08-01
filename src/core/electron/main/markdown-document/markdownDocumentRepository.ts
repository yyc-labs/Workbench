import path from 'node:path'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import type { MarkdownDocumentHistoryEntry } from '../../../shared/types'

const MAX_HISTORY_ENTRIES = 50

export class MarkdownDocumentRepository {
  private readonly filePath: string

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, 'markdown-documents', 'history.json')
  }

  async list(): Promise<MarkdownDocumentHistoryEntry[]> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      const entries = JSON.parse(raw)
      if (!Array.isArray(entries)) return []
      return entries.filter((entry): entry is MarkdownDocumentHistoryEntry => typeof entry?.path === 'string' && typeof entry?.normalizedPath === 'string' && typeof entry?.displayName === 'string' && typeof entry?.lastOpenedAt === 'number')
    } catch {
      return []
    }
  }

  async save(entries: MarkdownDocumentHistoryEntry[]): Promise<void> {
    const directory = path.dirname(this.filePath)
    await mkdir(directory, { recursive: true })
    const temporaryPath = `${this.filePath}.tmp`
    await writeFile(temporaryPath, JSON.stringify(entries.slice(0, MAX_HISTORY_ENTRIES), null, 2), 'utf8')
    await rename(temporaryPath, this.filePath)
  }

  async record(entry: MarkdownDocumentHistoryEntry): Promise<MarkdownDocumentHistoryEntry[]> {
    const entries = (await this.list()).filter((item) => item.normalizedPath !== entry.normalizedPath)
    entries.unshift(entry)
    await this.save(entries)
    return entries
  }

  async remove(normalizedPath: string): Promise<MarkdownDocumentHistoryEntry[]> {
    const entries = (await this.list()).filter((entry) => entry.normalizedPath !== normalizedPath)
    await this.save(entries)
    return entries
  }

  async clear(): Promise<void> {
    await this.save([])
  }
}
