import path from 'node:path'
import { existsSync } from 'node:fs'
import { isMarkdownDocumentPath } from './markdownDocumentPath'

const IGNORED_FLAGS = new Set(['--hidden', '--silent', '--autostart', '--no-sandbox'])

export function parseMarkdownDocumentOpenRequest(argv: readonly string[]): string | null {
  let candidate: string | null = null
  for (const argument of argv) {
    if (!argument || IGNORED_FLAGS.has(argument) || argument.startsWith('--')) continue
    if (path.isAbsolute(argument) && isMarkdownDocumentPath(argument) && existsSync(argument)) candidate = path.resolve(argument)
  }
  return candidate
}

export class MarkdownDocumentOpenRequestStore {
  private pendingPath: string | null = null

  setFromArgv(argv: readonly string[]): string | null {
    const path = parseMarkdownDocumentOpenRequest(argv)
    if (path) this.pendingPath = path
    return path
  }

  consume(): { path: string } | null {
    if (!this.pendingPath) return null
    const path = this.pendingPath
    this.pendingPath = null
    return { path }
  }
}
