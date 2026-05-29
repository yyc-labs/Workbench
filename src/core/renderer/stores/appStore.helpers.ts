import type {
  ProjectInfo,
  ProjectFolder,
  ProjectTag,
  RunStartupMode,
} from '../../shared/types'

const MAX_TERMINAL_OUTPUT_CHARS = 1_000_000
const URL_PATTERN = /https?:\/\/[\w.-]+:\d{2,5}/gi
const PROCESS_URLS_STORAGE_KEY = 'launcher:process-urls:v1'

export const initialThemeMode =
  (document.documentElement.getAttribute('data-theme-mode') as 'system' | 'light' | 'dark' | null) ?? 'system'

export function trimTerminalBuffer(text: string): string {
  if (text.length <= MAX_TERMINAL_OUTPUT_CHARS) return text
  return text.slice(text.length - MAX_TERMINAL_OUTPUT_CHARS)
}

export function collectUrlsFromText(text: string): string[] {
  const clean = text.replace(/\x1b\[[0-9;]*m/g, '')
  const matches = clean.match(URL_PATTERN)
  return matches ? [...new Set(matches)] : []
}

function normalizeProcessUrls(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object') return {}
  const result: Record<string, string[]> = {}
  for (const [key, urls] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(urls)) continue
    const normalized = urls.filter((item): item is string => typeof item === 'string').filter(Boolean)
    if (normalized.length > 0) result[key] = [...new Set(normalized)]
  }
  return result
}

export function loadPersistedProcessUrls(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(PROCESS_URLS_STORAGE_KEY)
    if (!raw) return {}
    return normalizeProcessUrls(JSON.parse(raw))
  } catch {
    return {}
  }
}

export function persistProcessUrls(urls: Record<string, string[]>): void {
  try {
    localStorage.setItem(PROCESS_URLS_STORAGE_KEY, JSON.stringify(urls))
  } catch {
    // ignore persistence failures
  }
}

function fallbackProjectName(dirPath: string): string {
  const normalized = dirPath.replace(/[\\/]+$/, '')
  const parts = normalized.split(/[\\/]/)
  return parts[parts.length - 1] || dirPath
}

function fallbackProjectId(filePath: string): string {
  let hash = 0
  for (let i = 0; i < filePath.length; i++) {
    const char = filePath.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0
  }
  return `p${Math.abs(hash).toString(36)}`
}

export function createEntityId(prefix: 'folder' | 'tag'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function createFallbackProject(dirPath: string): ProjectInfo {
  return {
    id: fallbackProjectId(dirPath),
    path: dirPath,
    name: fallbackProjectName(dirPath),
    type: 'unknown',
    command: 'echo Please set project command first',
    docLinks: [],
  }
}

export function toSavedProjects(projects: ProjectInfo[]): Array<{
  path: string
  customName?: string
  customType?: string
  customCommand?: string
  runStartupMode?: RunStartupMode
  pinned?: boolean
  lastOpened?: number
  cli?: 'claude' | 'codex'
  docLinks: ProjectInfo['docLinks']
  folderId?: string
  tagIds: string[]
  lastCodeFile?: string
  lastMarkdownPreviewMode?: 'edit' | 'preview' | 'split'
  codeFileDrawerState?: ProjectInfo['codeFileDrawerState']
}> {
  return projects.map((p) => ({
    path: p.path,
    customName: p.customName,
    customType: p.customType,
    customCommand: p.customCommand,
    runStartupMode: p.runStartupMode,
    pinned: p.pinned,
    lastOpened: p.lastOpened,
    cli: p.cli,
    docLinks: p.docLinks ?? [],
    folderId: p.folderId,
    tagIds: p.tagIds ?? [],
    lastCodeFile: p.lastCodeFile,
    lastMarkdownPreviewMode: p.lastMarkdownPreviewMode,
    codeFileDrawerState: p.codeFileDrawerState,
  }))
}

export async function persistWorkspace(
  projects: ProjectInfo[],
  folders: ProjectFolder[],
  tags: ProjectTag[],
): Promise<void> {
  await window.electronAPI.setConfig({
    projects: toSavedProjects(projects),
    folders,
    tags,
  })
}
