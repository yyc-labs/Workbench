/**
 * Declarative dynamic provider (plan 20 stage 8, D6).
 *
 * SECURITY BOUNDARY (P0-3, four hard rules — each enforced here and re-asserted
 * by tests): ① executableId can only reference an allow-listed registered CLI;
 * ② dynamic providers gain NO custom-command capability; ③ launch goes through
 * the Runtime chain's args array with shell:false (this file never builds shell
 * strings); ④ sessionId is format-checked before injection. Provider JSON that
 * fails validation is rejected wholesale; nothing third-party is ever executed.
 */

import type { AgentHistoryExecutionEnvironment, AgentHistoryProviderRef } from '../../../../../shared/types/agentHistory'
import { AGENT_HISTORY_LIMITS, type AgentHistoryProjectContext, type AgentHistorySession } from '../../../../../shared/types/agentHistory'
import type { AgentHistoryDataSource } from '../../datasource/types'
import { joinLogicPath, listJsonlSessionFiles } from '../../file-discovery'
import { identityForNamespace } from '../../path-normalizer'
import { createSessionKey } from '../../session-identity'
import { createSessionAccumulator, parseJsonLine, readJsonlLines } from '../shared/jsonl-parser'
import { AgentHistoryFileError, type AgentHistoryProvider, type DiscoverResult, type ParseSessionOptions, type SessionCandidate } from '../types'

export const DYNAMIC_PARSER_VERSION = 1
/** P0-3 ①: only registered CLIs may be referenced by a resume config. */
export const ALLOWED_EXECUTABLE_IDS = ['claude', 'codex', 'codebuddy'] as const

export interface DynamicProviderConfig {
  id: string
  name: string
  datasource: 'local' | 'wsl'
  /** Directory relative to the environment home (posix separators). */
  homeRelativeDir: string
  /** Whitelisted file suffix regex source (no nested quantifiers; length-capped). */
  filePattern: string
  recursive: boolean
  lineMapping: {
    typeField: string
    messageTypes: string[]
    sessionId?: string
    title?: string
    cwd?: string
    branch?: string
    model?: string
    role?: string
    text?: string
    timestamp?: string
    /** Content array blocks with these types carry text (input_text/output_text/text). */
    textBlockTypes?: string[]
  }
  resume: { executableId: string; args: string[]; sessionIdArg?: { index: number; prefix?: string } } | null
  capabilities: { preview: boolean; fullTranscript: boolean; nativeResume: boolean }
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,31}$/
const FIELD_PATTERN = /^[A-Za-z0-9_./-]{1,64}$/
const PATTERN_MAX_LENGTH = 64

export type DynamicConfigValidation = { ok: true; config: DynamicProviderConfig } | { ok: false; reason: string }

/** Strict schema validation: unknown fields are rejected so no smuggled shell channel can hide. */
export function validateDynamicProviderConfig(input: unknown): DynamicConfigValidation {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, reason: 'config must be an object' }
  const raw = input as Record<string, unknown>
  const allowed = new Set(['id', 'name', 'datasource', 'homeRelativeDir', 'filePattern', 'recursive', 'lineMapping', 'resume', 'capabilities'])
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) return { ok: false, reason: 'unknown field: ' + key }
  }
  if (typeof raw.id !== 'string' || !ID_PATTERN.test(raw.id)) return { ok: false, reason: 'id must match [a-z0-9-]{2,32}' }
  if (typeof raw.name !== 'string' || raw.name.trim().length < 1 || raw.name.length > 64) return { ok: false, reason: 'name required (1..64)' }
  if (raw.datasource !== 'local' && raw.datasource !== 'wsl') return { ok: false, reason: 'datasource must be local|wsl' }
  if (typeof raw.homeRelativeDir !== 'string' || !FIELD_PATTERN.test(raw.homeRelativeDir)) return { ok: false, reason: 'homeRelativeDir invalid' }
  // Safe subset only: literal chars, dots, escaped dots, anchors, and the *
  // quantifier. Parentheses/braces/alternation are excluded so the pattern can
  // neither nest quantifiers (ReDoS) nor smuggle anything shell-like.
  if (typeof raw.filePattern !== 'string' || raw.filePattern.length > PATTERN_MAX_LENGTH || !/^[A-Za-z0-9._\\[\]$^*-]+$/.test(raw.filePattern)) {
    return { ok: false, reason: 'filePattern outside the safe subset' }
  }
  const filePattern = raw.filePattern
  try {
    new RegExp(filePattern)
  } catch {
    return { ok: false, reason: 'filePattern is not a valid regex' }
  }
  if (typeof raw.recursive !== 'boolean') return { ok: false, reason: 'recursive must be boolean' }
  if (!raw.lineMapping || typeof raw.lineMapping !== 'object' || Array.isArray(raw.lineMapping)) return { ok: false, reason: 'lineMapping required' }
  const lm = raw.lineMapping as Record<string, unknown>
  if (typeof lm.typeField !== 'string' || !FIELD_PATTERN.test(lm.typeField)) return { ok: false, reason: 'lineMapping.typeField invalid' }
  if (!Array.isArray(lm.messageTypes) || lm.messageTypes.length === 0 || !lm.messageTypes.every((item) => typeof item === 'string' && FIELD_PATTERN.test(item))) {
    return { ok: false, reason: 'lineMapping.messageTypes invalid' }
  }
  for (const field of ['sessionId', 'title', 'cwd', 'branch', 'model', 'role', 'text', 'timestamp'] as const) {
    if (lm[field] !== undefined && (typeof lm[field] !== 'string' || !FIELD_PATTERN.test(lm[field]))) return { ok: false, reason: 'lineMapping.' + field + ' invalid' }
  }
  if (lm.textBlockTypes !== undefined && (!Array.isArray(lm.textBlockTypes) || !lm.textBlockTypes.every((item) => typeof item === 'string' && FIELD_PATTERN.test(item)))) {
    return { ok: false, reason: 'lineMapping.textBlockTypes invalid' }
  }
  // P0-3 ①②: resume must reference an allow-listed executable, or be null.
  if (raw.resume !== null && raw.resume !== undefined) {
    if (typeof raw.resume !== 'object' || Array.isArray(raw.resume)) return { ok: false, reason: 'resume must be an object or null' }
    const resume = raw.resume as Record<string, unknown>
    if (typeof resume.executableId !== 'string' || !(ALLOWED_EXECUTABLE_IDS as readonly string[]).includes(resume.executableId)) {
      return { ok: false, reason: 'resume.executableId must reference a registered CLI' }
    }
    if (!Array.isArray(resume.args) || !resume.args.every((item) => typeof item === 'string')) return { ok: false, reason: 'resume.args must be a string array' }
    if (resume.sessionIdArg !== undefined) {
      if (typeof resume.sessionIdArg !== 'object' || resume.sessionIdArg === null) return { ok: false, reason: 'resume.sessionIdArg invalid' }
      const arg = resume.sessionIdArg as { index?: unknown }
      if (typeof arg.index !== 'number' || !Number.isInteger(arg.index) || arg.index < 0) return { ok: false, reason: 'resume.sessionIdArg.index invalid' }
    }
  }
  const capabilities = raw.capabilities as Record<string, unknown> | undefined
  if (capabilities !== undefined) {
    if (typeof capabilities !== 'object' || Array.isArray(capabilities)) return { ok: false, reason: 'capabilities must be an object' }
    for (const key of ['preview', 'fullTranscript', 'nativeResume'] as const) {
      if (capabilities[key] !== undefined && typeof capabilities[key] !== 'boolean') return { ok: false, reason: 'capabilities.' + key + ' must be boolean' }
    }
  }
  const config: DynamicProviderConfig = {
    id: raw.id,
    name: raw.name,
    datasource: raw.datasource,
    homeRelativeDir: raw.homeRelativeDir,
    filePattern,
    recursive: raw.recursive,
    lineMapping: {
      typeField: lm.typeField as string,
      messageTypes: lm.messageTypes as string[],
      sessionId: lm.sessionId as string | undefined,
      title: lm.title as string | undefined,
      cwd: lm.cwd as string | undefined,
      branch: lm.branch as string | undefined,
      model: lm.model as string | undefined,
      role: lm.role as string | undefined,
      text: lm.text as string | undefined,
      timestamp: lm.timestamp as string | undefined,
      textBlockTypes: (lm.textBlockTypes as string[] | undefined) ?? ['text', 'input_text', 'output_text'],
    },
    // Dynamic resume: structured config only; the resume service composes the
    // final argv through the Runtime chain (args array + shell:false).
    resume: (raw.resume as DynamicProviderConfig['resume']) ?? null,
    capabilities: {
      preview: capabilities?.preview === undefined ? true : Boolean(capabilities.preview),
      fullTranscript: capabilities?.fullTranscript === undefined ? true : Boolean(capabilities.fullTranscript),
      nativeResume: capabilities?.nativeResume === undefined ? false : Boolean(capabilities.nativeResume),
    },
  }
  return { ok: true, config }
}

function pickPath(row: Record<string, unknown>, path: string | undefined): unknown {
  if (!path) return undefined
  let current: unknown = row
  for (const segment of path.split('.')) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

export function createDynamicAgentHistoryProvider(config: DynamicProviderConfig, deps: { getHomeDir: () => string; getWslHomeDir: () => Promise<string | null> }): AgentHistoryProvider {
  const fileRegex = new RegExp(config.filePattern + '$')
  const isMessageRow = (row: Record<string, unknown>) => config.lineMapping.messageTypes.includes(String(pickPath(row, config.lineMapping.typeField)))

  return {
    id: config.id as unknown as AgentHistoryProviderRef,
    parserVersion: DYNAMIC_PARSER_VERSION,
    capabilities: {
      preview: config.capabilities.preview,
      fullTranscript: config.capabilities.fullTranscript,
      // Dynamic mappings cannot prove derived-field preservation → forced off (plan §4 stage 8).
      incrementalRead: false,
      nativeResume: config.capabilities.nativeResume && config.resume !== null,
    },

    async discover(context: AgentHistoryProjectContext, dataSource: AgentHistoryDataSource, signal?: AbortSignal): Promise<DiscoverResult> {
      const base = await resolveHome(dataSource, deps)
      if (base === null) throw new AgentHistoryFileError('SOURCE_UNAVAILABLE', config.id + ' home unresolvable')
      const root = joinLogicPath(base, config.homeRelativeDir)
      if (!(await dataSource.stat(root, signal))) {
        throw new AgentHistoryFileError('SOURCE_UNAVAILABLE', config.id + ' session root not found')
      }
      const listing = await listJsonlSessionFiles(dataSource, root, {
        maxFiles: AGENT_HISTORY_LIMITS.maxCandidateFiles,
        recursive: config.recursive,
        signal,
        fileFilter: (name) => fileRegex.test(name),
      })
      const toCandidate = (file: { filePath: string; mtimeMs: number; sizeBytes: number }): SessionCandidate => ({
        agent: config.id as unknown as SessionCandidate['agent'],
        filePath: file.filePath,
        mtimeMs: file.mtimeMs,
        sizeBytes: file.sizeBytes,
      })
      return { candidates: listing.files.map(toCandidate), truncated: listing.truncated }
    },

    async parseSession(candidate: SessionCandidate, dataSource: AgentHistoryDataSource, options?: ParseSessionOptions): Promise<AgentHistorySession> {
      const accumulator = createSessionAccumulator({
        previewMessageCount: AGENT_HISTORY_LIMITS.previewMessageCount,
        previewTextMaxLength: AGENT_HISTORY_LIMITS.previewTextMaxLength,
      })
      let sessionId: string | null = null
      let title: string | null = null
      let cwd: string | null = null
      let branch: string | null = null
      let model: string | null = null

      for await (const line of readJsonlLines(dataSource, candidate.filePath, options?.signal)) {
        const row = parseJsonLine<Record<string, unknown>>(line)
        if (!row || !isMessageRow(row)) continue
        accumulator.touch(pickPath(row, config.lineMapping.timestamp) as string | number | undefined)
        const text = textOf(row, config.lineMapping)
        if (text) {
          accumulator.addMessage({
            role: roleOf(pickPath(row, config.lineMapping.role)),
            text,
            timestamp: pickPath(row, config.lineMapping.timestamp) as string | number | undefined,
          })
          if (title === null) title = text.length > 120 ? text.slice(0, 120) + '…' : text
        }
        const sessionIdValue = pickPath(row, config.lineMapping.sessionId)
        if (typeof sessionIdValue === 'string' && sessionIdValue) sessionId = sessionIdValue
        const cwdValue = pickPath(row, config.lineMapping.cwd)
        if (typeof cwdValue === 'string' && cwdValue) cwd = cwdValue
        const branchValue = pickPath(row, config.lineMapping.branch)
        if (typeof branchValue === 'string' && branchValue) branch = branchValue
        const modelValue = pickPath(row, config.lineMapping.model)
        if (typeof modelValue === 'string' && modelValue) model = modelValue
      }

      const summary = accumulator.summary()
      return {
        sessionKey: createSessionKey({ agent: config.id, namespaceId: dataSource.namespaceId, filePath: identityForNamespace(dataSource.namespaceId, candidate.filePath), nativeSessionId: sessionId }),
        agent: config.id as unknown as AgentHistoryProviderRef,
        updatedAt: summary.updatedAt ?? new Date(candidate.mtimeMs).toISOString(),
        sessionId,
        title,
        cwd,
        branch,
        model,
        createdAt: summary.createdAt,
        messageCount: summary.messageCount,
        previewMessages: summary.previewMessages,
        source: { filePath: candidate.filePath, mtimeMs: candidate.mtimeMs, sizeBytes: candidate.sizeBytes, parserVersion: DYNAMIC_PARSER_VERSION },
      }
    },
  }
}

function resolveHome(dataSource: AgentHistoryDataSource, deps: { getHomeDir: () => string; getWslHomeDir: () => Promise<string | null> }): Promise<string | null> {
  if (dataSource.homeDir) return dataSource.homeDir()
  return Promise.resolve(deps.getHomeDir())
}

function roleOf(value: unknown): 'user' | 'assistant' {
  return value === 'assistant' ? 'assistant' : 'user'
}

function textOf(row: Record<string, unknown>, lm: DynamicProviderConfig['lineMapping']): string {
  const blockTypes = lm.textBlockTypes ?? ['text', 'input_text', 'output_text']
  const direct = pickPath(row, lm.text)
  if (typeof direct === 'string' && direct.trim()) return direct.trim()
  const content = pickPath(row, 'content')
  if (Array.isArray(content)) {
    const joined = content
      .filter((block) => blockTypes.includes(String((block as { type?: unknown }).type)))
      .map((block) => String((block as { text?: unknown }).text ?? ''))
      .join('\n')
      .trim()
    if (joined) return joined
  }
  return ''
}
