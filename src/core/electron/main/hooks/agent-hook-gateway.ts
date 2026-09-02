import { createHash, randomUUID } from 'crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import type { AgentHookCanonicalEvent, AgentHookEnvelope, AgentHookGatewayConfig, AgentHookLogDetail, AgentHookGatewayStatus, AgentHookProvider, StructuredHttpRequestSnapshot, TranscriptExternalImportPayload, TranscriptImportedEvent, TranscriptImportProjectTarget } from '../../../shared/types'
import { buildJsonSnapshot, buildRequestSnapshot, hasStructuredTruncation, maskUnknown } from '../agent-logs/log-snapshots'
import { buildTranscriptImportSkillMarkdown } from './transcript-import-skill'

type AgentHookGatewayOptions = {
  getConfig: () => AgentHookGatewayConfig | undefined
  isLogCaptureEnabled?: () => boolean
  onEvent: (event: AgentHookEnvelope) => void
  listProjects?: () => TranscriptImportProjectTarget[]
  onTranscriptImport?: (payload: TranscriptExternalImportPayload) => Promise<TranscriptImportedEvent>
  /** 读取仓库内 skills/transcript-import/SKILL.md 正文；读取失败时网关使用内置兜底指令。 */
  transcriptSkillFileProvider?: () => string | undefined
}

const DEFAULT_HOST = '0.0.0.0'
const DEFAULT_PORT = 17373
const DEFAULT_MAX_BODY_BYTES = 256 * 1024
const DEFAULT_RECENT_EVENT_LIMIT = 200
const PROVIDER_PATHS: Record<string, AgentHookProvider> = {
  '/hooks/claude-code': 'claude-code',
  '/hooks/codex-cli': 'codex-cli',
}

const EVENT_ALIASES: Record<string, AgentHookCanonicalEvent> = {
  SessionStart: 'session-start',
  SessionEnd: 'session-end',
  UserPromptSubmit: 'user-prompt-submit',
  PreToolUse: 'pre-tool-use',
  PermissionRequest: 'permission-request',
  PostToolUse: 'post-tool-use',
  PostToolUseFailure: 'post-tool-use-failure',
  PostToolBatch: 'post-tool-batch',
  Stop: 'stop',
  StopFailure: 'stop-failure',
  PreCompact: 'pre-compact',
  PostCompact: 'post-compact',
  SubagentStart: 'subagent-start',
  SubagentStop: 'subagent-stop',
  TaskCreated: 'task-created',
  TaskCompleted: 'task-completed',
  Notification: 'notification',
  FileChanged: 'file-changed',
  CwdChanged: 'cwd-changed',
  ConfigChange: 'config-change',
  WorktreeCreate: 'worktree-create',
  WorktreeRemove: 'worktree-remove',
  TeammateIdle: 'teammate-idle',
}

type HookRequestTrace = {
  id: string
  startedAt: number
  provider: AgentHookProvider
  ingressRequest: StructuredHttpRequestSnapshot
}

function jsonResponse(res: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function emptyResponse(res: ServerResponse, statusCode: number): void {
  res.writeHead(statusCode)
  res.end()
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function getObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function getNestedString(source: Record<string, unknown>, keys: string[]): string | undefined {
  let current: unknown = source
  for (const key of keys) {
    const object = getObject(current)
    if (!object) return undefined
    current = object[key]
  }
  return getString(current)
}

function getBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function stableEventId(provider: AgentHookProvider, providerEvent: string, rawBody: string): string {
  const digest = createHash('sha256').update(provider).update('\0').update(providerEvent).update('\0').update(rawBody).digest('hex').slice(0, 24)
  return `${Date.now().toString(36)}-${digest}`
}

function inferProviderEvent(payload: unknown, fallback: string): string {
  const object = getObject(payload)
  if (!object) return fallback
  const nestedPayload = getObject(object.payload) || {}

  return (
    getString(object.eventName) ||
    getString(object.event_name) ||
    getString(object.hookEventName) ||
    getString(object.hook_event_name) ||
    getString(object.hook_event) ||
    getString(object.event) ||
    getString(nestedPayload.eventName) ||
    getString(nestedPayload.event_name) ||
    getString(nestedPayload.hookEventName) ||
    getString(nestedPayload.hook_event_name) ||
    getString(nestedPayload.hook_event) ||
    getString(nestedPayload.event) ||
    fallback
  )
}

function toCanonicalEvent(providerEvent: string): AgentHookCanonicalEvent {
  if (EVENT_ALIASES[providerEvent]) return EVENT_ALIASES[providerEvent]

  const compact = providerEvent.replace(/[-_\s]+/g, '').toLowerCase()
  const matched = Object.entries(EVENT_ALIASES).find(([eventName]) => eventName.toLowerCase() === compact)
  return matched?.[1] || 'unknown'
}

function normalizeEnvelope(provider: AgentHookProvider, rawBody: string, payload: unknown, fallbackEvent: string): AgentHookEnvelope {
  const object = getObject(payload) || {}
  const providerEvent = inferProviderEvent(payload, fallbackEvent)
  const nestedPayload = getObject(object.payload) || {}
  const toolObject = getObject(object.tool) || getObject(nestedPayload.tool) || {}
  const agentObject = getObject(object.agent) || getObject(nestedPayload.agent) || {}

  return {
    schemaVersion: 1,
    provider,
    providerEvent,
    canonicalEvent: toCanonicalEvent(providerEvent),
    eventId: getString(object.eventId) || getString(object.event_id) || getString(nestedPayload.eventId) || getString(nestedPayload.event_id) || stableEventId(provider, providerEvent, rawBody),
    receivedAt: Date.now(),
    sessionId: getString(object.sessionId) || getString(object.session_id) || getString(nestedPayload.sessionId) || getString(nestedPayload.session_id) || getNestedString(object, ['session', 'id']),
    turnId: getString(object.turnId) || getString(object.turn_id) || getString(nestedPayload.turnId) || getString(nestedPayload.turn_id) || getNestedString(object, ['turn', 'id']),
    cwd: getString(object.cwd) || getString(object.currentWorkingDirectory) || getString(object.current_working_directory) || getString(nestedPayload.cwd) || getString(nestedPayload.currentWorkingDirectory) || getString(nestedPayload.current_working_directory) || getNestedString(object, ['workspace', 'cwd']),
    toolName: getString(object.toolName) || getString(object.tool_name) || getString(nestedPayload.toolName) || getString(nestedPayload.tool_name) || getString(toolObject.name) || getString(toolObject.type),
    agentId: getString(object.agentId) || getString(object.agent_id) || getString(nestedPayload.agentId) || getString(nestedPayload.agent_id) || getString(agentObject.id),
    agentType: getString(object.agentType) || getString(object.agent_type) || getString(nestedPayload.agentType) || getString(nestedPayload.agent_type) || getString(agentObject.type),
    permissionMode: getString(object.permissionMode) || getString(object.permission_mode) || getString(nestedPayload.permissionMode) || getString(nestedPayload.permission_mode),
    raw: payload,
  }
}

function readRequestBody(req: IncomingMessage, maxBodyBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    let bytes = 0

    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      bytes += Buffer.byteLength(chunk)
      if (bytes > maxBodyBytes) {
        reject(new Error('REQUEST_BODY_TOO_LARGE'))
        req.destroy()
        return
      }
      body += chunk
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function normalizeProjectPathForMatch(value: string): string {
  return value.trim().replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}

function findTranscriptImportProject(projects: TranscriptImportProjectTarget[], queryPath: string): TranscriptImportProjectTarget | undefined {
  const trimmed = queryPath.trim()
  return projects.find((project) => project.projectPath === trimmed) || projects.find((project) => normalizeProjectPathForMatch(project.projectPath) === normalizeProjectPathForMatch(trimmed))
}

export class AgentHookGateway {
  private readonly getConfig: AgentHookGatewayOptions['getConfig']
  private readonly isLogCaptureEnabled: () => boolean
  private readonly onEvent: AgentHookGatewayOptions['onEvent']
  private readonly listProjects?: AgentHookGatewayOptions['listProjects']
  private readonly onTranscriptImport?: AgentHookGatewayOptions['onTranscriptImport']
  private readonly transcriptSkillFileProvider?: AgentHookGatewayOptions['transcriptSkillFileProvider']
  private server: Server | null = null
  private recentEvents: AgentHookEnvelope[] = []
  private recentLogDetails: AgentHookLogDetail[] = []
  private running = false
  private error: string | undefined
  private activeHost = DEFAULT_HOST
  private activePort = DEFAULT_PORT

  constructor(options: AgentHookGatewayOptions) {
    this.getConfig = options.getConfig
    this.isLogCaptureEnabled = options.isLogCaptureEnabled ?? (() => true)
    this.onEvent = options.onEvent
    this.listProjects = options.listProjects
    this.onTranscriptImport = options.onTranscriptImport
    this.transcriptSkillFileProvider = options.transcriptSkillFileProvider
  }

  start(): void {
    const config = this.resolveConfig()
    this.activeHost = config.host
    this.activePort = config.port

    if (!config.enabled || this.server) {
      return
    }

    this.error = undefined
    const server = createServer((req, res) => {
      void this.handleRequest(req, res)
    })
    server.on('error', (error) => {
      this.running = false
      this.error = error instanceof Error ? error.message : String(error)
    })
    server.listen(config.port, config.host, () => {
      this.running = true
      this.error = undefined
    })
    this.server = server
  }

  stop(): Promise<void> {
    if (!this.server) {
      this.running = false
      return Promise.resolve()
    }

    const server = this.server
    this.server = null
    this.running = false
    // 强制断开存量连接，确保端口立即释放，便于重启换绑 host。
    server.closeAllConnections()
    return new Promise((resolve) => {
      server.close(() => resolve())
    })
  }

  restart(): void {
    this.stop()
    this.start()
  }

  getRecentEvents(): AgentHookEnvelope[] {
    return this.recentEvents.slice()
  }

  getRecentLogDetails(): AgentHookLogDetail[] {
    return this.recentLogDetails.slice()
  }

  clearRecentLogs(): void {
    this.recentEvents = []
    this.recentLogDetails = []
  }

  getStatus(): AgentHookGatewayStatus {
    const config = this.resolveConfig()
    const host = this.server ? this.activeHost : config.host
    const port = this.server ? this.activePort : config.port
    const baseUrl = `http://${host}:${port}`
    return {
      enabled: config.enabled,
      running: this.running,
      host,
      port,
      url: baseUrl,
      tokenConfigured: Boolean(config.token),
      recentEventCount: this.recentEvents.length,
      transcriptImportEnabled: config.transcriptImportEnabled,
      transcriptImportUrl: `${baseUrl}/transcripts/import`,
      transcriptProjectsUrl: `${baseUrl}/transcripts/projects`,
      transcriptProjectIdUrl: `${baseUrl}/transcripts/project-id`,
      transcriptSkillUrl: `${baseUrl}/transcripts/skill`,
      transcriptImportTokenConfigured: Boolean(config.transcriptImportToken),
      error: this.error,
    }
  }

  private appendRecentLogDetail(detail: AgentHookLogDetail): void {
    if (!this.isLogCaptureEnabled()) return
    this.recentLogDetails.unshift(detail)
    const { recentEventLimit } = this.resolveConfig()
    if (this.recentLogDetails.length > recentEventLimit) {
      this.recentLogDetails = this.recentLogDetails.slice(0, recentEventLimit)
    }
  }

  private beginHookTrace(req: IncomingMessage, provider: AgentHookProvider, url: URL): HookRequestTrace {
    return {
      id: randomUUID(),
      startedAt: Date.now(),
      provider,
      ingressRequest: buildRequestSnapshot({
        method: req.method || 'POST',
        path: url.pathname,
        url: req.url || url.pathname,
        query: url.searchParams,
        headers: req.headers,
        contentType: typeof req.headers['content-type'] === 'string' ? req.headers['content-type'] : undefined,
      }),
    }
  }

  private finalizeHookTrace(
    trace: HookRequestTrace,
    envelope: AgentHookEnvelope | null,
    payload: unknown,
    options: {
      level: 'info' | 'warn' | 'error'
      statusCode: number
      errorCode?: string
      errorMessage?: string
      bodyText?: string
      maxBodyBytes: number
      parseError?: string
      bodyTruncated?: boolean
    },
  ): void {
    const durationMs = Math.max(0, Date.now() - trace.startedAt)
    const providerEvent = envelope?.providerEvent || 'unknown'
    const canonicalEvent = envelope?.canonicalEvent || 'unknown'
    const detail: AgentHookLogDetail = {
      source: 'agent-hooks',
      summary: {
        id: trace.id,
        source: 'agent-hooks',
        title: providerEvent,
        timestamp: trace.startedAt,
        level: options.level,
        providerEvent,
        canonicalEvent,
        provider: trace.provider,
        statusCode: options.statusCode,
        durationMs,
        truncated: hasStructuredTruncation({
          ingressRequest: trace.ingressRequest,
          payload,
        }),
        cwd: envelope?.cwd,
        toolName: envelope?.toolName,
      },
      meta: {
        requestId: trace.id,
        provider: trace.provider,
        providerEvent,
        canonicalEvent,
        durationMs,
      },
      ingressRequest: buildRequestSnapshot({
        method: trace.ingressRequest.method,
        path: trace.ingressRequest.path,
        url: trace.ingressRequest.url,
        query: trace.ingressRequest.query,
        headers: trace.ingressRequest.headers,
        bodyText: options.bodyText,
        bodyValue: payload,
        contentType: trace.ingressRequest.body?.contentType ?? (typeof trace.ingressRequest.headers['content-type'] === 'string' ? trace.ingressRequest.headers['content-type'] : undefined),
        maxBodyBytes: options.maxBodyBytes,
        bodyParseError: options.parseError,
        bodyTruncated: options.bodyTruncated,
      }),
      normalizedEnvelope: envelope ? maskUnknown(envelope) : undefined,
      payload: buildJsonSnapshot({
        contentType: typeof trace.ingressRequest.headers['content-type'] === 'string' ? trace.ingressRequest.headers['content-type'] : 'application/json; charset=utf-8',
        rawText: options.bodyText,
        parsedValue: payload,
        maxBytes: options.maxBodyBytes,
        parseError: options.parseError,
        truncated: options.bodyTruncated,
      }),
      error: options.errorMessage
        ? {
            code: options.errorCode,
            message: options.errorMessage,
          }
        : undefined,
    }
    this.appendRecentLogDetail(detail)
  }

  private resolveConfig(): {
    enabled: boolean
    host: string
    port: number
    token: string
    maxBodyBytes: number
    recentEventLimit: number
    transcriptImportEnabled: boolean
    transcriptImportToken: string
    transcriptImportOpenViewerByDefault: boolean
  } {
    const config = this.getConfig() || {}
    const configuredHost = config.host || DEFAULT_HOST
    const transcriptImport = config.transcriptImport || {}
    return {
      enabled: config.enabled ?? true,
      // host 按配置字面生效：0.0.0.0 = 局域网可访问，127.0.0.1 = 仅本机。
      host: configuredHost,
      port: Number.isFinite(config.port) ? Number(config.port) : DEFAULT_PORT,
      token: config.token || '',
      maxBodyBytes: Number.isFinite(config.maxBodyBytes) ? Number(config.maxBodyBytes) : DEFAULT_MAX_BODY_BYTES,
      recentEventLimit: Number.isFinite(config.recentEventLimit) ? Number(config.recentEventLimit) : DEFAULT_RECENT_EVENT_LIMIT,
      transcriptImportEnabled: transcriptImport.enabled ?? true,
      transcriptImportToken: transcriptImport.token || '',
      transcriptImportOpenViewerByDefault: transcriptImport.openViewerByDefault ?? false,
    }
  }

  private isAuthorized(req: IncomingMessage, token: string, headerNames: string[]): boolean {
    if (!token) return true
    for (const headerName of headerNames) {
      const header = req.headers[headerName]
      const received = Array.isArray(header) ? header[0] : header
      if (received === token) return true
    }
    const authHeader = req.headers.authorization
    const receivedAuth = Array.isArray(authHeader) ? authHeader[0] : authHeader
    return receivedAuth === `Bearer ${token}`
  }

  private normalizeTranscriptImportPayload(payload: unknown): TranscriptExternalImportPayload {
    const object = getObject(payload)
    if (!object) {
      throw new Error('INVALID_TRANSCRIPT_IMPORT_PAYLOAD')
    }
    const rawText = typeof object.rawText === 'string' ? object.rawText : typeof object.content === 'string' ? object.content : ''
    return {
      projectId: getString(object.projectId),
      projectPath: getString(object.projectPath),
      sourceType: getString(object.sourceType) as TranscriptExternalImportPayload['sourceType'],
      rawText,
      title: getString(object.title),
      sourceLabel: getString(object.sourceLabel),
      processId: getString(object.processId),
      capturedAt: Number.isFinite(Number(object.capturedAt)) ? Number(object.capturedAt) : undefined,
      openViewer: getBoolean(object.openViewer) ?? getBoolean(object.reveal),
    }
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', 'http://localhost')
    const config = this.resolveConfig()

    if (req.method === 'GET' && url.pathname === '/health') {
      jsonResponse(res, 200, this.getStatus())
      return
    }

    if (url.pathname.startsWith('/transcripts/')) {
      if (!config.transcriptImportEnabled) {
        emptyResponse(res, 404)
        return
      }
      // skill 下发接口：token 写在返回内容里，因此不能用转录 token 做前置鉴权（鸡生蛋问题）。
      // 改为网关 token 或转录 token 任一命中即可；两者都未配置时开放（与导入接口的无 token 模式一致）。
      if (req.method === 'GET' && url.pathname === '/transcripts/skill') {
        const skillAuthorized = (!config.token && !config.transcriptImportToken) || this.isAuthorized(req, config.transcriptImportToken, ['x-ide-electron-transcript-token', 'x-ide-electron-token']) || this.isAuthorized(req, config.token, ['x-agent-hook-token', 'x-ide-electron-token'])
        if (!skillAuthorized) {
          emptyResponse(res, 401)
          return
        }
        jsonResponse(res, 200, {
          ok: true,
          skill: buildTranscriptImportSkillMarkdown(
            {
              baseUrl: `http://127.0.0.1:${config.port}`,
              token: config.transcriptImportToken || '',
            },
            this.transcriptSkillFileProvider?.(),
          ),
        })
        return
      }
      if (!this.isAuthorized(req, config.transcriptImportToken, ['x-ide-electron-transcript-token', 'x-ide-electron-token'])) {
        emptyResponse(res, 401)
        return
      }
      if (req.method === 'GET' && url.pathname === '/transcripts/projects') {
        jsonResponse(res, 200, {
          ok: true,
          projects: this.listProjects ? this.listProjects() : [],
        })
        return
      }
      if (req.method === 'GET' && url.pathname === '/transcripts/project-id') {
        const queryPath = url.searchParams.get('path') || ''
        if (!queryPath.trim()) {
          jsonResponse(res, 400, { ok: false, error: 'missing "path" query parameter' })
          return
        }
        const projects = this.listProjects ? this.listProjects() : []
        const target = findTranscriptImportProject(projects, queryPath)
        if (!target) {
          jsonResponse(res, 404, { ok: false, error: 'project not found' })
          return
        }
        jsonResponse(res, 200, {
          ok: true,
          projectId: target.projectId,
          projectPath: target.projectPath,
          name: target.name,
          customName: target.customName,
          displayName: target.displayName,
        })
        return
      }
      if (req.method === 'POST' && url.pathname === '/transcripts/import') {
        if (!this.onTranscriptImport) {
          emptyResponse(res, 404)
          return
        }
        try {
          const rawBody = await readRequestBody(req, config.maxBodyBytes)
          const payload = rawBody.trim() ? JSON.parse(rawBody) : {}
          const normalizedPayload = this.normalizeTranscriptImportPayload(payload)
          if (normalizedPayload.openViewer === undefined) {
            normalizedPayload.openViewer = config.transcriptImportOpenViewerByDefault
          }
          const imported = await this.onTranscriptImport(normalizedPayload)
          jsonResponse(res, 200, {
            ok: true,
            projectId: imported.session.projectId,
            sessionId: imported.session.id,
            title: imported.session.title,
            sourceType: imported.session.sourceType,
            openViewer: Boolean(imported.openViewer),
          })
        } catch (error) {
          if (error instanceof Error && error.message === 'REQUEST_BODY_TOO_LARGE') {
            jsonResponse(res, 413, { error: 'request body too large' })
            return
          }
          const message = error instanceof Error ? error.message : 'invalid transcript payload'
          jsonResponse(res, 400, { error: message, requestId: randomUUID() })
        }
        return
      }
      emptyResponse(res, req.method === 'GET' ? 404 : 405)
      return
    }

    if (req.method !== 'POST') {
      emptyResponse(res, 405)
      return
    }

    const provider = PROVIDER_PATHS[url.pathname] || (url.pathname.startsWith('/hooks/') ? 'unknown' : undefined)
    if (!provider) {
      emptyResponse(res, 404)
      return
    }

    const trace = this.beginHookTrace(req, provider, url)

    if (!this.isAuthorized(req, config.token, ['x-agent-hook-token', 'x-ide-electron-token'])) {
      this.finalizeHookTrace(trace, null, undefined, {
        level: 'warn',
        statusCode: 401,
        errorCode: 'unauthorized',
        errorMessage: 'Unauthorized hook request.',
        maxBodyBytes: config.maxBodyBytes,
      })
      emptyResponse(res, 401)
      return
    }

    try {
      const rawBody = await readRequestBody(req, config.maxBodyBytes)
      let payload: unknown = {}
      try {
        payload = rawBody.trim() ? JSON.parse(rawBody) : {}
      } catch (error) {
        this.finalizeHookTrace(trace, null, undefined, {
          level: 'warn',
          statusCode: 400,
          errorCode: 'invalid_hook_payload',
          errorMessage: 'invalid hook payload',
          bodyText: rawBody,
          maxBodyBytes: config.maxBodyBytes,
          parseError: error instanceof Error ? error.message : String(error),
        })
        jsonResponse(res, 400, { error: 'invalid hook payload', requestId: trace.id })
        return
      }
      const fallbackEvent = url.searchParams.get('event') || 'unknown'
      const envelope = normalizeEnvelope(provider, rawBody, payload, fallbackEvent)
      this.pushEvent(envelope)
      this.finalizeHookTrace(trace, envelope, payload, {
        level: 'info',
        statusCode: 204,
        bodyText: rawBody,
        maxBodyBytes: config.maxBodyBytes,
      })
      emptyResponse(res, 204)
    } catch (error) {
      if (error instanceof Error && error.message === 'REQUEST_BODY_TOO_LARGE') {
        this.finalizeHookTrace(trace, null, undefined, {
          level: 'warn',
          statusCode: 413,
          errorCode: 'request_body_too_large',
          errorMessage: 'request body too large',
          maxBodyBytes: config.maxBodyBytes,
          bodyTruncated: true,
          parseError: 'Request body exceeded the configured limit.',
        })
        jsonResponse(res, 413, { error: 'request body too large' })
        return
      }
      this.finalizeHookTrace(trace, null, undefined, {
        level: 'warn',
        statusCode: 400,
        errorCode: 'invalid_hook_payload',
        errorMessage: error instanceof Error ? error.message : 'invalid hook payload',
        maxBodyBytes: config.maxBodyBytes,
      })
      jsonResponse(res, 400, { error: 'invalid hook payload', requestId: trace.id })
    }
  }

  private pushEvent(event: AgentHookEnvelope): void {
    if (this.isLogCaptureEnabled()) {
      this.recentEvents.unshift(event)
      const { recentEventLimit } = this.resolveConfig()
      if (this.recentEvents.length > recentEventLimit) {
        this.recentEvents = this.recentEvents.slice(0, recentEventLimit)
      }
    }
    this.onEvent(event)
  }
}
