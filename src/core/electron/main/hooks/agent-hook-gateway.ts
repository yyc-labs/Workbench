import { createHash, randomUUID } from 'crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import type {
  AgentHookCanonicalEvent,
  AgentHookEnvelope,
  AgentHookGatewayConfig,
  AgentHookGatewayStatus,
  AgentHookProvider,
} from '../../../shared/types'

type AgentHookGatewayOptions = {
  getConfig: () => AgentHookGatewayConfig | undefined
  onEvent: (event: AgentHookEnvelope) => void
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
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
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

function stableEventId(provider: AgentHookProvider, providerEvent: string, rawBody: string): string {
  const digest = createHash('sha256')
    .update(provider)
    .update('\0')
    .update(providerEvent)
    .update('\0')
    .update(rawBody)
    .digest('hex')
    .slice(0, 24)
  return `${Date.now().toString(36)}-${digest}`
}

function inferProviderEvent(payload: unknown, fallback: string): string {
  const object = getObject(payload)
  if (!object) return fallback
  const nestedPayload = getObject(object.payload) || {}

  return getString(object.eventName)
    || getString(object.event_name)
    || getString(object.hookEventName)
    || getString(object.hook_event_name)
    || getString(object.hook_event)
    || getString(object.event)
    || getString(nestedPayload.eventName)
    || getString(nestedPayload.event_name)
    || getString(nestedPayload.hookEventName)
    || getString(nestedPayload.hook_event_name)
    || getString(nestedPayload.hook_event)
    || getString(nestedPayload.event)
    || fallback
}

function toCanonicalEvent(providerEvent: string): AgentHookCanonicalEvent {
  if (EVENT_ALIASES[providerEvent]) return EVENT_ALIASES[providerEvent]

  const compact = providerEvent.replace(/[-_\s]+/g, '').toLowerCase()
  const matched = Object.entries(EVENT_ALIASES).find(([eventName]) => (
    eventName.toLowerCase() === compact
  ))
  return matched?.[1] || 'unknown'
}

function normalizeEnvelope(
  provider: AgentHookProvider,
  rawBody: string,
  payload: unknown,
  fallbackEvent: string,
): AgentHookEnvelope {
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
    eventId: getString(object.eventId)
      || getString(object.event_id)
      || getString(nestedPayload.eventId)
      || getString(nestedPayload.event_id)
      || stableEventId(provider, providerEvent, rawBody),
    receivedAt: Date.now(),
    sessionId: getString(object.sessionId)
      || getString(object.session_id)
      || getString(nestedPayload.sessionId)
      || getString(nestedPayload.session_id)
      || getNestedString(object, ['session', 'id']),
    turnId: getString(object.turnId)
      || getString(object.turn_id)
      || getString(nestedPayload.turnId)
      || getString(nestedPayload.turn_id)
      || getNestedString(object, ['turn', 'id']),
    cwd: getString(object.cwd)
      || getString(object.currentWorkingDirectory)
      || getString(object.current_working_directory)
      || getString(nestedPayload.cwd)
      || getString(nestedPayload.currentWorkingDirectory)
      || getString(nestedPayload.current_working_directory)
      || getNestedString(object, ['workspace', 'cwd']),
    toolName: getString(object.toolName)
      || getString(object.tool_name)
      || getString(nestedPayload.toolName)
      || getString(nestedPayload.tool_name)
      || getString(toolObject.name)
      || getString(toolObject.type),
    agentId: getString(object.agentId)
      || getString(object.agent_id)
      || getString(nestedPayload.agentId)
      || getString(nestedPayload.agent_id)
      || getString(agentObject.id),
    agentType: getString(object.agentType)
      || getString(object.agent_type)
      || getString(nestedPayload.agentType)
      || getString(nestedPayload.agent_type)
      || getString(agentObject.type),
    permissionMode: getString(object.permissionMode)
      || getString(object.permission_mode)
      || getString(nestedPayload.permissionMode)
      || getString(nestedPayload.permission_mode),
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

export class AgentHookGateway {
  private readonly getConfig: AgentHookGatewayOptions['getConfig']
  private readonly onEvent: AgentHookGatewayOptions['onEvent']
  private server: Server | null = null
  private recentEvents: AgentHookEnvelope[] = []
  private running = false
  private error: string | undefined
  private activeHost = DEFAULT_HOST
  private activePort = DEFAULT_PORT

  constructor(options: AgentHookGatewayOptions) {
    this.getConfig = options.getConfig
    this.onEvent = options.onEvent
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
    return new Promise((resolve) => {
      server.close(() => resolve())
    })
  }

  getRecentEvents(): AgentHookEnvelope[] {
    return this.recentEvents.slice()
  }

  getStatus(): AgentHookGatewayStatus {
    const config = this.resolveConfig()
    const host = this.server ? this.activeHost : config.host
    const port = this.server ? this.activePort : config.port
    return {
      enabled: config.enabled,
      running: this.running,
      host,
      port,
      url: `http://${host}:${port}`,
      tokenConfigured: Boolean(config.token),
      recentEventCount: this.recentEvents.length,
      error: this.error,
    }
  }

  private resolveConfig(): Required<AgentHookGatewayConfig> {
    const config = this.getConfig() || {}
    const configuredHost = config.host || DEFAULT_HOST
    return {
      enabled: config.enabled ?? true,
      host: configuredHost === '127.0.0.1' ? DEFAULT_HOST : configuredHost,
      port: Number.isFinite(config.port) ? Number(config.port) : DEFAULT_PORT,
      token: config.token || '',
      maxBodyBytes: Number.isFinite(config.maxBodyBytes)
        ? Number(config.maxBodyBytes)
        : DEFAULT_MAX_BODY_BYTES,
      recentEventLimit: Number.isFinite(config.recentEventLimit)
        ? Number(config.recentEventLimit)
        : DEFAULT_RECENT_EVENT_LIMIT,
    }
  }

  private isAuthorized(req: IncomingMessage, token: string): boolean {
    if (!token) return true
    const header = req.headers['x-agent-hook-token']
    const received = Array.isArray(header) ? header[0] : header
    return received === token
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', 'http://localhost')
    const config = this.resolveConfig()

    if (req.method === 'GET' && url.pathname === '/health') {
      jsonResponse(res, 200, this.getStatus())
      return
    }

    if (req.method !== 'POST') {
      emptyResponse(res, 405)
      return
    }

    const provider = PROVIDER_PATHS[url.pathname]
      || (url.pathname.startsWith('/hooks/') ? 'unknown' : undefined)
    if (!provider) {
      emptyResponse(res, 404)
      return
    }

    if (!this.isAuthorized(req, config.token)) {
      emptyResponse(res, 401)
      return
    }

    try {
      const rawBody = await readRequestBody(req, config.maxBodyBytes)
      const payload = rawBody.trim() ? JSON.parse(rawBody) : {}
      const fallbackEvent = url.searchParams.get('event') || 'unknown'
      const envelope = normalizeEnvelope(provider, rawBody, payload, fallbackEvent)
      this.pushEvent(envelope)
      emptyResponse(res, 204)
    } catch (error) {
      if (error instanceof Error && error.message === 'REQUEST_BODY_TOO_LARGE') {
        jsonResponse(res, 413, { error: 'request body too large' })
        return
      }
      jsonResponse(res, 400, { error: 'invalid hook payload', requestId: randomUUID() })
    }
  }

  private pushEvent(event: AgentHookEnvelope): void {
    this.recentEvents.unshift(event)
    const { recentEventLimit } = this.resolveConfig()
    if (this.recentEvents.length > recentEventLimit) {
      this.recentEvents = this.recentEvents.slice(0, recentEventLimit)
    }
    this.onEvent(event)
  }
}
