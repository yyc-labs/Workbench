import { basename } from 'path'
import type {
  AppLocale,
  AgentHookEnvelope,
  AgentHookFeishuNotifyEvent,
  AgentHookGatewayConfig,
} from '../../../shared/types'
import {
  resolveMainLocale,
  toFeishuLocaleTag,
  translateMain,
  type MainLocale,
} from '../mainI18n'

type FeishuNotifierOptions = {
  getConfig: () => AgentHookGatewayConfig | undefined
  getLocale: () => AppLocale | undefined
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

function getProjectName(cwd: string | undefined, locale: MainLocale): string {
  if (!cwd) return translateMain(locale, 'feishu.unknownProject')
  const trimmed = cwd.replace(/[\\/]+$/, '')
  return basename(trimmed) || trimmed
}

function formatEventTime(timestamp: number, locale: MainLocale): string {
  return new Date(timestamp).toLocaleString(locale, {
    hour12: false,
  })
}

function eventStatusLabel(event: AgentHookEnvelope, locale: MainLocale): string {
  if (event.canonicalEvent === 'permission-request') return translateMain(locale, 'feishu.waitingApproval')
  if (event.canonicalEvent === 'session-end') return translateMain(locale, 'feishu.sessionEnded')
  return translateMain(locale, 'feishu.completed')
}

function buildInteractiveCard(event: AgentHookEnvelope, locale: MainLocale): Record<string, unknown> {
  const provider = providerLabel(event.provider)
  const projectName = getProjectName(event.cwd, locale)
  const session = shortId(event.sessionId)
  const turn = shortId(event.turnId)
  const time = formatEventTime(event.receivedAt, locale)
  const status = eventStatusLabel(event, locale)
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
          content: `**${translateMain(locale, 'feishu.agentLabel')}**\n${provider}`,
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
                content: `**${translateMain(locale, 'feishu.eventLabel')}**\n${escapeCardText(event.providerEvent)}`,
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
                content: `**${translateMain(locale, 'feishu.timeLabel')}**\n${escapeCardText(time)}`,
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
                  content: `**${translateMain(locale, 'feishu.toolLabel')}**\n${toolName}`,
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
                  content: `**${translateMain(locale, 'feishu.permissionModeLabel')}**\n${permissionMode}`,
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
          content: `**${translateMain(locale, 'feishu.directoryLabel')}**\n\`${escapeCardText(event.cwd)}\``,
        },
      },
      {
        tag: 'note',
        elements: [
          {
            tag: 'plain_text',
            content: `${translateMain(locale, 'feishu.sessionLabel')} ${session}  |  ${translateMain(locale, 'feishu.turnLabel')} ${turn}`,
          },
        ],
      },
    ],
  }
}

function buildPostMessage(event: AgentHookEnvelope, locale: MainLocale): Record<string, unknown> {
  const provider = providerLabel(event.provider)
  const projectName = getProjectName(event.cwd, locale)
  const session = shortId(event.sessionId)
  const turn = shortId(event.turnId)
  const time = formatEventTime(event.receivedAt, locale)
  const status = eventStatusLabel(event, locale)
  const content: Array<Array<{ tag: 'text'; text: string }>> = [
    [{ tag: 'text', text: `${translateMain(locale, 'feishu.agentLabel')}: ${provider}` }],
    [{ tag: 'text', text: `${translateMain(locale, 'feishu.eventLabel')}: ${event.providerEvent}` }],
    [{ tag: 'text', text: `${translateMain(locale, 'feishu.timeLabel')}: ${time}` }],
    [{ tag: 'text', text: `${translateMain(locale, 'feishu.directoryLabel')}: ${event.cwd || '-'}` }],
  ]

  if (event.toolName) {
    content.push([{ tag: 'text', text: `${translateMain(locale, 'feishu.toolLabel')}: ${event.toolName}` }])
  }
  if (event.permissionMode) {
    content.push([{ tag: 'text', text: `${translateMain(locale, 'feishu.permissionModeLabel')}: ${event.permissionMode}` }])
  }
  content.push([{
    tag: 'text',
    text: `${translateMain(locale, 'feishu.sessionLabel')}: ${session}   ${translateMain(locale, 'feishu.turnLabel')}: ${turn}`,
  }])

  return {
    [toFeishuLocaleTag(locale)]: {
      title: `${projectName} ${status}`,
      content,
    },
  }
}

function buildPlainText(event: AgentHookEnvelope, locale: MainLocale): string {
  const provider = providerLabel(event.provider)
  const projectName = getProjectName(event.cwd, locale)
  const parts = [
    `${projectName} ${eventStatusLabel(event, locale)}`,
    `${translateMain(locale, 'feishu.agentLabel')}: ${provider}`,
    `${translateMain(locale, 'feishu.eventLabel')}: ${event.providerEvent}`,
    `${translateMain(locale, 'feishu.timeLabel')}: ${formatEventTime(event.receivedAt, locale)}`,
  ]
  if (event.cwd) parts.push(`${translateMain(locale, 'feishu.directoryLabel')}: ${event.cwd}`)
  if (event.toolName) parts.push(`${translateMain(locale, 'feishu.toolLabel')}: ${event.toolName}`)
  if (event.permissionMode) parts.push(`${translateMain(locale, 'feishu.permissionModeLabel')}: ${event.permissionMode}`)
  if (event.sessionId) parts.push(`${translateMain(locale, 'feishu.sessionLabel')}: ${shortId(event.sessionId)}`)
  if (event.turnId) parts.push(`${translateMain(locale, 'feishu.turnLabel')}: ${shortId(event.turnId)}`)
  return parts.join('\n')
}

export class FeishuNotifier {
  private readonly getConfig: FeishuNotifierOptions['getConfig']
  private readonly getLocale: FeishuNotifierOptions['getLocale']
  private cachedTenantToken: CachedTenantToken | null = null
  private readonly sentEventIds = new Set<string>()
  private readonly pendingEventIds = new Set<string>()

  constructor(options: FeishuNotifierOptions) {
    this.getConfig = options.getConfig
    this.getLocale = options.getLocale
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
    const locale = resolveMainLocale(
      this.getLocale(),
      Intl.DateTimeFormat().resolvedOptions().locale
    )

    try {
      await this.sendMessage({
        tenantAccessToken,
        receiveId,
        receiveIdType,
        msgType: 'interactive',
        content: buildInteractiveCard(event, locale),
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
        content: buildPostMessage(event, locale),
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
      content: { text: buildPlainText(event, locale) },
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
