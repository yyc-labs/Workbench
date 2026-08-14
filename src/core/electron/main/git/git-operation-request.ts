import type { GitOperationRequest } from '../../../shared/types'

export type NormalizedGitOperationRequest = {
  message?: string
  operation: GitOperationRequest['operation']
  remoteName: string
  repoRoot: string
  targetBranch?: string
  expectedHead?: string
}

export function normalizeGitRemoteName(input: string | undefined): string {
  const normalized = (input || '').trim()
  return normalized || 'origin'
}

export function isValidGitBranchName(name: string): boolean {
  if (!name || name.length > 255) return false
  if (name.startsWith('/') || name.endsWith('/')) return false
  if (name.includes('//')) return false
  if (name.includes('\\')) return false
  if (name.includes('..')) return false
  if (name.includes('@{')) return false
  if (name.endsWith('.')) return false
  if (name.endsWith('.lock')) return false
  if (/[\x00-\x20\x7f~^:?*\[]/.test(name)) return false
  if (name.split('/').some((part) => part.length === 0 || part.startsWith('.') || part.endsWith('.'))) return false
  return true
}

export function normalizeGitOperationRequest(request: GitOperationRequest): NormalizedGitOperationRequest {
  const message = request.message?.trim()
  const targetBranch = request.targetBranch?.trim()
  const expectedHead = request.expectedHead?.trim()
  return {
    operation: request.operation,
    remoteName: normalizeGitRemoteName(request.remoteName),
    repoRoot: request.repoRoot.trim(),
    targetBranch: targetBranch || undefined,
    ...(message ? { message } : {}),
    ...(expectedHead ? { expectedHead } : {}),
  }
}
