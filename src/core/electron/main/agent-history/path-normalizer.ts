import { existsSync, realpathSync } from 'node:fs'

/**
 * Path identity utilities for agent history scanning (docs/todo/19 §2.1).
 *
 * Matching rule: normalized full-path exact equality only. Never fall back to
 * substring containment — "D:\work\app" and "D:\work\application" are distinct.
 * Ambiguity must hide sessions, never misreport them.
 *
 * v1 covers the win32 namespace only (plan decision D3): WSL sessions live in a
 * different home and namespace; they must never be matched against Windows paths.
 */

/** Lexical normalization for Windows paths: unified separators, collapsed runs, no trailing separator, lowercased (NTFS is case-insensitive). */
export function normalizeWindowsPath(input: string): string {
  let p = input.trim().replace(/\//g, '\\')
  const isUnc = p.startsWith('\\\\')
  if (isUnc) p = p.slice(2)
  p = p.replace(/\\{2,}/g, '\\')
  while (p.length > 1 && p.endsWith('\\')) p = p.slice(0, -1)
  if (isUnc) p = '\\\\' + p
  return p.toLowerCase()
}

/** Realpath-resolved normalization for paths that exist; null when missing, lexical fallback on realpath failure. */
export function realpathNormalized(input: string): string | null {
  if (!existsSync(input)) return null
  try {
    return normalizeWindowsPath(realpathSync(input))
  } catch {
    return normalizeWindowsPath(input)
  }
}

export function pathIdentityEquals(a: string, b: string): boolean {
  return normalizeWindowsPath(a) === normalizeWindowsPath(b)
}

/**
 * claude-code style project bucket name: every non-alphanumeric character maps
 * to '-', case preserved. Observed layout: "C:\Users\x" -> "C--Users-x".
 */
export function encodeClaudeBucketName(cwd: string): string {
  return cwd.trim().replace(/[^A-Za-z0-9]/g, '-')
}

/**
 * codebuddy style project bucket name: lowercased, drive colon dropped,
 * separator runs collapse to a single '-'. Observed layout:
 * "D:\tools\ide-electron" -> "d-tools-ide-electron".
 *
 * Note the two rules differ (plan stage 0): matching encodes the project path
 * with the provider's own rule and compares bucket names exactly — bucket names
 * are never decoded back to paths, because literal hyphens in directory names
 * are indistinguishable from separators.
 */
export function encodeCodebuddyBucketName(cwd: string): string {
  const unified = cwd.trim().replace(/\//g, '\\').replace(/:/g, '')
  const dashed = unified.replace(/\\+/g, '-').replace(/-+$/, '')
  return dashed.toLowerCase()
}

/**
 * POSIX-side path identity (plan 20 stage 1): WSL sessions live in the Linux
 * namespace where the filesystem IS case-sensitive — never lowercase there.
 */
export function normalizePosixPath(input: string): string {
  let p = input.trim().split('\\').join('/')
  p = p.replace(/\/{2,}/g, '/')
  while (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1)
  return p
}

/** Environment-aware path identity: case-insensitive on win32, case-sensitive under WSL. */
export function pathIdentityFor(executionEnvironment: 'windows' | 'wsl', input: string): string {
  return executionEnvironment === 'wsl' ? normalizePosixPath(input) : normalizeWindowsPath(input)
}

/** Namespace-aware source-path identity: WSL namespaces are posix + case-sensitive, win32 is normalized + lowercased. */
export function identityForNamespace(namespaceId: string, input: string): string {
  return namespaceId.startsWith('wsl:') ? normalizePosixPath(input) : normalizeWindowsPath(input)
}
