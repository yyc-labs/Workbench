import { createHash } from 'node:crypto'

/**
 * Stable session key generation (docs/todo/19 §2.1).
 *
 * The key is a truncated sha-256 over provider id, namespace, normalized source
 * file identity and the agent's native session id (when present). It never
 * exposes raw file paths, and it is NOT an authorization token: consumers must
 * pass (projectId, sessionKey) and the main process re-validates project scope.
 */

export interface AgentHistoryIdentityInput {
  /** Built-in literal or dynamic provider id — the key encodes whatever id the source declares. */
  agent: string
  /** Path namespace of the source file, e.g. "win32". */
  namespaceId: string
  /** Normalized (via path-normalizer) source file path. */
  filePath: string
  nativeSessionId: string | null
}

export function createSessionKey(input: AgentHistoryIdentityInput): string {
  const hash = createHash('sha256')
    .update([input.agent, input.namespaceId, input.filePath, input.nativeSessionId ?? ''].join('\n'), 'utf8')
    .digest('hex')
    .slice(0, 24)
  return `ah-${input.agent}-${hash}`
}
