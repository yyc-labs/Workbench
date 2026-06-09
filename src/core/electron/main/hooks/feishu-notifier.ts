import { basename } from 'path'
import type {
  AgentHookEnvelope,
  AgentHookFeishuNotifyEvent,
  AgentHookGatewayConfig,
} from '../../../shared/types'

type FeishuNotifierOptions = {
  getConfig: () => AgentHookGatewayConfig | undefined
}

type CachedTenantToken = {
  accessToken: string
  expiresAt: number
}

const TOKEN_ENDPOINT = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal'
const MESSAGE_ENDPOINT = 'https://open.feishu.cn/open-apis/im/v1/messages'
const TOKEN_REFRESH_BUFFER_MS = 60_000
const DEFAULT_NOTIFY_ON: AgentHookFeishuNotifyEvent[] = ['stop', 'permission-request']

function normalizeNotifyOn(
  notifyOn: AgentHookFeishuNotifyEvent[] | undefined
): AgentHookFeishuNotifyEvent[] {
  const normalized = new Set<AgentHookFeishuNotifyEvent>()
  for (const eventName of notifyOn || []) {
    if (
      eventName === 'stop'
      || eventName === 'session-end'
      || eventName === 'permission-request'
    ) {
      normalized.add(eventName)
    }
  }

  if (normalized.size <= 0) {
    DEFAULT_NOTIFY_ON.forEach((eventName) => normalized.add(eventName))
  } else {
    normalized.add('permission-request')
  }

  return Array.from(normalized)
}

function getFeishuConfig(config: AgentHookGatewayConfig | undefined) {
  const feishu = config?.feishu
  return {
    enabled: Boolean(feishu?.enabled),
    appId: feishu?.appId?.trim() || '',
    appSecret: feishu?.appSecret?.trim() || '',
    receiveId: feishu?.receiveId?.trim() || '',
    receiveIdType: feishu?.receiveIdType || 'open_id',
    notifyOn: normalizeNotifyOn(feishu?.notifyOn),
  }
}

function shouldNotifyEvent(event: AgentHookEnvelope, notifyOn: AgentHookFeishuNotifyEvent[]): boolean {
  if (event.canonicalEvent === 'stop' && notifyOn.includes('stop')) return true
  if (event.canonicalEvent === 'session-end' && notifyOn.includes('session-end')) return true
  if (event.canonicalEvent === 'permission-request' && notifyOn.includes('permission-request')) return true
  return false
}

function providerLabel(provider: AgentHookEnvelope['provider']): string {
  if (provider === 'codex-cli') return 'Codex CLI'
  if (provider === 'claude-code') return 'Claude Code'
  return 'AI Agent'
}

function shortId(value: string | undefined): string {
  if (!value) return '-'
  return value.length > 12 ? value.slice(-12) : value
}

function escapeCardText(value: string | undefined): string {
  return (value || '-').replace(/[`<>]/g, ' ')
}

function getProjectName(cwd: string | undefined): string {
  if (!cwd) return 'Unknown Project'
  const trimmed = cwd.replace(/[\\/]+$/, '')
  return basename(trimmed) || trimmed
}

function formatEventTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', {
    hour12: false,
  })
}

function eventStatusLabel(event: AgentHookEnvelope): string {
  if (event.canonicalEvent === 'permission-request') return '等待确认'
  if (event.canonicalEvent === 'session-end') return '会话结束'
  return '已完成'
}

function buildInteractiveCard(event: AgentHookEnvelope): Record<string, unknown> {
  const provider = providerLabel(event.provider)
  const projectName = getProjectName(event.cwd)
  const session = shortId(event.sessionId)
  const turn = shortId(event.turnId)
  const time = formatEventTime(event.receivedAt)
  const status = eventStatusLabel(event)
  const toolName = escapeCardText(event.toolName)
  const permissionMode = escapeCardText(event.permissionMode)
  const showPermissionDetails = event.canonicalEvent === 'permission-request' || Boolean(event.toolName || event.permissionMode)

  return {
    header: {
      title: {
        tag: 'plain_text',
        content: `${projectName} ${status}`,
      },
      template: 'green',
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**Agent**\n${provider}`,
        },
      },
      {
        tag: 'column_set',
        flex_mode: 'stretch',
        columns: [
          {
            tag: 'column',
            width: 'weighted',
            weight: 1,
            elements: [
              {
                tag: 'markdown',
                content: `**事件**\n${escapeCardText(event.providerEvent)}`,
              },
            ],
          },
          {
            tag: 'column',
            width: 'weighted',
            weight: 1,
            elements: [
              {
                tag: 'markdown',
                content: `**时间**\n${escapeCardText(time)}`,
              },
            ],
          },
        ],
      },
      ...(showPermissionDetails
        ? [{
          tag: 'column_set',
          flex_mode: 'stretch',
          columns: [
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'markdown',
                  content: `**工具**\n${toolName}`,
                },
              ],
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'markdown',
                  content: `**权限模式**\n${permissionMode}`,
                },
              ],
            },
          ],
        }]
        : []),
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**目录**\n\`${escapeCardText(event.cwd)}\``,
        },
      },
      {
        tag: 'note',
        elements: [
          {
            tag: 'plain_text',
            content: `session ${session}  |  turn ${turn}`,
          },
        ],
      },
    ],
  }
}

function buildPostMessage(event: AgentHookEnvelope): Record<string, unknown> {
  const provider = providerLabel(event.provider)
  const projectName = getProjectName(event.cwd)
  const session = shortId(event.sessionId)
  const turn = shortId(event.turnId)
  const time = formatEventTime(event.receivedAt)
  const status = eventStatusLabel(event)
  const content: Array<Array<{ tag: 'text'; text: string }>> = [
    [{ tag: 'text', text: `Agent: ${provider}` }],
    [{ tag: 'text', text: `事件: ${event.providerEvent}` }],
    [{ tag: 'text', text: `时间: ${time}` }],
    [{ tag: 'text', text: `目录: ${event.cwd || '-'}` }],
  ]

  if (event.toolName) content.push([{ tag: 'text', text: `工具: ${event.toolName}` }])
  if (event.permissionMode) content.push([{ tag: 'text', text: `权限模式: ${event.permissionMode}` }])
  content.push([{ tag: 'text', text: `Session: ${session}   Turn: ${turn}` }])

  return {
    zh_cn: {
      title: `${projectName} ${status}`,
      content,
    },
  }
}

function buildPlainText(event: AgentHookEnvelope): string {
  const provider = providerLabel(event.provider)
  const projectName = getProjectName(event.cwd)
  const parts = [
    `${projectName} ${eventStatusLabel(event)}`,
    `Agent: ${provider}`,
    `事件: ${event.providerEvent}`,
    `时间: ${formatEventTime(event.receivedAt)}`,
  ]
  if (event.cwd) parts.push(`目录: ${event.cwd}`)
  if (event.toolName) parts.push(`工具: ${event.toolName}`)
  if (event.permissionMode) parts.push(`权限模式: ${event.permissionMode}`)
  if (event.sessionId) parts.push(`Session: ${shortId(event.sessionId)}`)
  if (event.turnId) parts.push(`Turn: ${shortId(event.turnId)}`)
  return parts.join('\n')
}

export class FeishuNotifier {
  private readonly getConfig: FeishuNotifierOptions['getConfig']
  private cachedTenantToken: CachedTenantToken | null = null
  private readonly sentEventIds = new Set<string>()
  private readonly pendingEventIds = new Set<string>()

  constructor(options: FeishuNotifierOptions) {
    this.getConfig = options.getConfig
  }

  async notifyIfNeeded(event: AgentHookEnvelope): Promise<void> {
    const config = getFeishuConfig(this.getConfig())
    if (!config.enabled || !shouldNotifyEvent(event, config.notifyOn)) return
    if (!config.appId || !config.appSecret || !config.receiveId) return
    if (this.sentEventIds.has(event.eventId)) return
    if (this.pendingEventIds.has(event.eventId)) return

    this.pendingEventIds.add(event.eventId)
    try {
      const tenantAccessToken = await this.getTenantAccessToken(config.appId, config.appSecret)
      await this.sendCompletionMessage(tenantAccessToken, config.receiveId, config.receiveIdType, event)
      this.sentEventIds.add(event.eventId)
      if (this.sentEventIds.size > 500) {
        const first = this.sentEventIds.values().next().value
        if (typeof first === 'string') this.sentEventIds.delete(first)
      }
    } finally {
      this.pendingEventIds.delete(event.eventId)
    }
  }

  private async getTenantAccessToken(appId: string, appSecret: string): Promise<string> {
    const cached = this.cachedTenantToken
    if (cached && cached.expiresAt > Date.now() + TOKEN_REFRESH_BUFFER_MS) {
      return cached.accessToken
    }

    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        app_id: appId,
        app_secret: appSecret,
      }),
    })
    if (!response.ok) {
      throw new Error(`Feishu token request failed: HTTP ${response.status}`)
    }

    const payload = await response.json() as {
      code?: number
      msg?: string
      tenant_access_token?: string
      expire?: number
    }
    if (payload.code !== 0 || !payload.tenant_access_token) {
      throw new Error(`Feishu token request failed: ${payload.msg || 'unknown error'}`)
    }

    this.cachedTenantToken = {
      accessToken: payload.tenant_access_token,
      expiresAt: Date.now() + Math.max(0, Number(payload.expire || 0) * 1000),
    }
    return payload.tenant_access_token
  }

  private async sendCompletionMessage(
    tenantAccessToken: string,
    receiveId: string,
    receiveIdType: 'open_id' | 'user_id' | 'union_id' | 'email' | 'chat_id',
    event: AgentHookEnvelope
  ): Promise<void> {
    try {
      await this.sendMessage({
        tenantAccessToken,
        receiveId,
        receiveIdType,
        msgType: 'interactive',
        content: buildInteractiveCard(event),
      })
      return
    } catch {
      // Fall through to a simpler, widely-supported message format.
    }

    try {
      await this.sendMessage({
        tenantAccessToken,
        receiveId,
        receiveIdType,
        msgType: 'post',
        content: buildPostMessage(event),
      })
      return
    } catch {
      // Final fallback is plain text.
    }

    await this.sendMessage({
      tenantAccessToken,
      receiveId,
      receiveIdType,
      msgType: 'text',
      content: { text: buildPlainText(event) },
    })
  }

  private async sendMessage(input: {
    tenantAccessToken: string
    receiveId: string
    receiveIdType: 'open_id' | 'user_id' | 'union_id' | 'email' | 'chat_id'
    msgType: 'interactive' | 'post' | 'text'
    content: Record<string, unknown>
  }): Promise<void> {
    const response = await fetch(
      `${MESSAGE_ENDPOINT}?receive_id_type=${encodeURIComponent(input.receiveIdType)}`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${input.tenantAccessToken}`,
          'content-type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({
          receive_id: input.receiveId,
          msg_type: input.msgType,
          content: JSON.stringify(input.content),
        }),
      }
    )
    if (!response.ok) {
      throw new Error(`Feishu message request failed: HTTP ${response.status}`)
    }

    const payload = await response.json() as {
      code?: number
      msg?: string
    }
    if (payload.code !== 0) {
      throw new Error(`Feishu message request failed: ${payload.msg || 'unknown error'}`)
    }
  }
}
