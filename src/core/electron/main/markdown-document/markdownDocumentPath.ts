import path from 'node:path'
import { lstat, realpath } from 'node:fs/promises'

export const MARKDOWN_DOCUMENT_EXTENSIONS = new Set(['.md', '.markdown'])
export const MARKDOWN_DOCUMENT_MAX_SIZE = 1024 * 1024

export function normalizeMarkdownDocumentPath(filePath: string): string {
  if (process.platform === 'win32') return path.resolve(filePath).toLowerCase()
  return path.resolve(filePath)
}

export function isMarkdownDocumentPath(filePath: string): boolean {
  return MARKDOWN_DOCUMENT_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

export async function resolveMarkdownDocumentPath(filePath: string): Promise<string> {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('Markdown document path must be absolute.')
  if (!isMarkdownDocumentPath(filePath)) throw new Error('Only .md and .markdown files are supported.')
  const resolved = await realpath(path.resolve(filePath))
  const stats = await lstat(resolved)
  if (!stats.isFile()) throw new Error('Markdown document path is not a regular file.')
  return resolved
}
