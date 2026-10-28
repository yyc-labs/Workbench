/**
 * Handoff service (plan 20 stage 7, D11/v2 ⑧).
 *
 * Delivery protocol (five steps from review, verbatim contract):
 *  1. build a size-limited, sanitized context package (focused ≤ 8KB digest;
 *     full = file reference + reachability check — never a bare path when the
 *     target environment cannot read it);
 *  2. the target runtime receives it through a SUPPORTED mechanism
 *     (prompt-injection / startup-file / manual fallback);
 *  3. delivery state + mechanism are recorded;
 *  4. a verifiable load signal or explicit user action confirms;
 *  5. unverifiable → shown as awaiting confirmation, never assumed loaded.
 *
 * State lives in a SEPARATE handoff.db (P0-2): workflow records cannot be
 * rebuilt from CLI source files, so cache recovery never touches them.
 */
import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { AgentHistoryHandoffCreateArgs, AgentHistoryHandoffMechanism, AgentHistoryHandoffRecord, AgentHistoryHandoffStatus } from '../../../../shared/types/agentHistoryHandoff'
import type { AgentHistoryCache } from '../cache/db'
import type { AgentHistoryLoadConfig } from '../scan-service'

const FOCUSED_MAX_BYTES = 8 * 1024

export interface AgentHistoryHandoffDeps {
  loadConfig: AgentHistoryLoadConfig
  cache: AgentHistoryCache | null
  /** userData dir for the handoff db + package files. */
  getStorageDir: () => string
  /** Detect whether the TARGET environment can read a given path (full-mode reachability). */
  canTargetRead: (targetProjectId: string, filePath: string) => boolean
  /**
   * Prompt-injection delivery: start the target CLI in the target project with
   * an initial prompt that references the package file. Implemented through
   * the AI Runtime chain (args array; WSL targets degrade to manual).
   */
  startTargetRuntime?: (input: { projectId: string; agent: string; initialPrompt: string }) => Promise<boolean>
}

interface HandoffDb {
  create(record: AgentHistoryHandoffRecord): void
  get(id: string): AgentHistoryHandoffRecord | null
  list(): AgentHistoryHandoffRecord[]
  updateStatus(id: string, status: AgentHistoryHandoffStatus): void
}

function openHandoffDb(dbPath: string): HandoffDb {
  mkdirSync(dirname(dbPath), { recursive: true })
  const db = new DatabaseSync(dbPath)
  db.exec(`
    CREATE TABLE IF NOT EXISTS handoffs (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      source_project_id TEXT NOT NULL,
      source_session_key TEXT NOT NULL,
      source_agent TEXT,
      source_title TEXT,
      target_agent TEXT NOT NULL,
      target_project_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      mechanism TEXT NOT NULL,
      status TEXT NOT NULL,
      package_path TEXT
    );
  `)
  const toRecord = (row: Record<string, unknown>): AgentHistoryHandoffRecord => ({
    id: String(row.id),
    createdAt: String(row.created_at),
    sourceProjectId: String(row.source_project_id),
    sourceSessionKey: String(row.source_session_key),
    sourceAgent: row.source_agent === null ? '' : String(row.source_agent),
    sourceTitle: row.source_title === null ? null : String(row.source_title),
    targetAgent: String(row.target_agent),
    targetProjectId: String(row.target_project_id),
    mode: String(row.mode) as AgentHistoryHandoffRecord['mode'],
    mechanism: String(row.mechanism) as AgentHistoryHandoffRecord['mechanism'],
    status: String(row.status) as AgentHistoryHandoffRecord['status'],
    packagePath: row.package_path === null ? null : String(row.package_path),
  })
  return {
    create(record) {
      db.prepare(`INSERT INTO handoffs (id, created_at, source_project_id, source_session_key, source_agent, source_title, target_agent, target_project_id, mode, mechanism, status, package_path)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(record.id, record.createdAt, record.sourceProjectId, record.sourceSessionKey, record.sourceAgent, record.sourceTitle, record.targetAgent, record.targetProjectId, record.mode, record.mechanism, record.status, record.packagePath)
    },
    get(id) {
      const row = db.prepare('SELECT * FROM handoffs WHERE id = ?').get(id)
      return row ? toRecord(row) : null
    },
    list() {
      return db.prepare('SELECT * FROM handoffs ORDER BY created_at DESC').all().map(toRecord)
    },
    updateStatus(id, status) {
      db.prepare('UPDATE handoffs SET status = ? WHERE id = ?').run(status, id)
    },
  }
}

/** Source-session context builder: digest from the cached view (never raw file dumps). */
function buildFocusedPackage(view: { title?: string | null; agent?: string; updatedAt?: string; previewMessages?: { role: string; text: string }[] }, note?: string): string {
  const lines: string[] = []
  lines.push('# Handoff context (focused)')
  lines.push('')
  lines.push('- Source agent: ' + (view.agent ?? 'unknown'))
  lines.push('- Last activity: ' + (view.updatedAt ?? 'unknown'))
  if (view.title) lines.push('- Session title: ' + view.title)
  if (note?.trim()) lines.push('- Operator note: ' + note.trim())
  lines.push('')
  lines.push('## Recent conversation digest')
  for (const message of view.previewMessages ?? []) {
    const text = message.text.length > 400 ? message.text.slice(0, 400) + '…' : message.text
    lines.push('- [' + message.role + '] ' + text.replace(/\n/g, ' '))
  }
  const body = lines.join('\n')
  return body.length > FOCUSED_MAX_BYTES ? body.slice(0, FOCUSED_MAX_BYTES) + '\n… (truncated)' : body
}

export function createAgentHistoryHandoffService(deps: AgentHistoryHandoffDeps) {
  const db = openHandoffDb(join(deps.getStorageDir(), 'agent-history', 'handoff', 'handoff.db'))

  return {
    list(): AgentHistoryHandoffRecord[] {
      return db.list()
    },

    async create(args: AgentHistoryHandoffCreateArgs): Promise<{ ok: true; record: AgentHistoryHandoffRecord } | { ok: false; reason: 'SESSION_NOT_FOUND' | 'PACKAGE_FAILED' | 'TARGET_UNREACHABLE' }> {
      const row = deps.cache?.listByProject(args.sourceProjectId).find((item) => item.sessionKey === args.sourceSessionKey)
      if (!row) return { ok: false, reason: 'SESSION_NOT_FOUND' }
      const view = JSON.parse(row.dataJson) as { title?: string | null; agent?: string; updatedAt?: string; previewMessages?: { role: string; text: string }[] }

      // Full mode: the source file must be reachable by the TARGET environment.
      let fullReachable = true
      if (args.mode === 'full') {
        fullReachable = deps.canTargetRead(args.targetProjectId, row.filePath)
        if (!fullReachable) {
          // v2 ⑧: inline the content instead of leaving a dead path reference.
          // (Focused-style digest is the inline fallback for stage 7 v1.)
        }
      }

      const intendedMechanism: AgentHistoryHandoffMechanism = args.mode === 'full' && fullReachable ? 'startup-file' : 'prompt-injection'
      const packageDir = join(deps.getStorageDir(), 'agent-history', 'handoff')
      const body = buildFocusedPackage(view, args.note)
      const bodyWithTranscript = args.mode === 'full' && fullReachable ? body + '\n\n## Full transcript\n' + row.filePath + '\n' : body

      // Idempotency (review fix): the record id is a hash over
      // (source, target, mode, package content). Re-clicking with unchanged
      // content resolves to the SAME id → return the existing record without
      // rewriting the file or re-launching the target. Changed content → new id.
      const contentHash = createHash('sha256').update([args.sourceProjectId, args.sourceSessionKey, args.targetAgent, args.targetProjectId, args.mode, body].join('\n')).digest('hex').slice(0, 16)
      const id = 'hnd-' + contentHash
      const existing = db.get(id)
      if (existing && existing.status !== 'failed') {
        return { ok: true, record: existing }
      }

      const packagePath = join(packageDir, id + '.md')
      try {
        mkdirSync(packageDir, { recursive: true })
        writeFileSync(packagePath, bodyWithTranscript)
      } catch {
        return { ok: false, reason: 'PACKAGE_FAILED' }
      }

      // Delivery: prompt-injection starts the target CLI with an initial
      // prompt referencing the package (Windows targets only in v1 — WSL
      // targets would need /mnt/<drive> path translation). Launch failure or
      // a WSL target degrades to manual: package exists, awaiting user load.
      let status: AgentHistoryHandoffStatus = 'delivered'
      let effectiveMechanism: AgentHistoryHandoffMechanism = intendedMechanism
      if (deps.startTargetRuntime) {
        const loadPrompt = `请先完整阅读并加载这份转交上下文文件：${packagePath}。其中包含前一智能体的会话摘要与任务背景，读完后再继续任务。`
        try {
          const launched = await deps.startTargetRuntime({ projectId: args.targetProjectId, agent: args.targetAgent, initialPrompt: loadPrompt })
          if (!launched) {
            effectiveMechanism = 'manual'
            status = 'pending'
          }
        } catch {
          effectiveMechanism = 'manual'
          status = 'pending'
        }
      } else {
        effectiveMechanism = 'manual'
        status = 'pending'
      }
      const record: AgentHistoryHandoffRecord = {
        id,
        createdAt: new Date().toISOString(),
        sourceProjectId: args.sourceProjectId,
        sourceSessionKey: args.sourceSessionKey,
        sourceAgent: view.agent ?? row.providerId,
        sourceTitle: view.title ?? null,
        targetAgent: args.targetAgent,
        targetProjectId: args.targetProjectId,
        mode: args.mode,
        mechanism: effectiveMechanism,
        status,
        packagePath,
      }
      db.create(record)
      return { ok: true, record }
    },

    /** Explicit user confirmation    /** Explicit user confirmation (manual mechanism) or hook-verified load. */
    confirm(id: string, loaded: boolean): AgentHistoryHandoffRecord | null {
      const record = db.list().find((item) => item.id === id)
      if (!record) return null
      const next: AgentHistoryHandoffStatus = loaded ? 'confirmed' : record.status === 'delivered' ? 'pending' : record.status
      db.updateStatus(id, next)
      return { ...record, status: next }
    },

    markFailed(id: string): void {
      db.updateStatus(id, 'failed')
    },
  }
}
