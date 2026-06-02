import { wslBridge } from './wsl-bridge'
import type { ClaudeBashrcConfig } from '../../shared/types'

const BASHRC_PATH = '/home/ubuntu/.bashrc'

const DEFAULT_CLAUDE_BASHRC_CONFIG: ClaudeBashrcConfig = {
  anthropicBaseUrl: 'https://api.deepseek.com/anthropic',
  anthropicAuthToken: '',
  anthropicModel: 'deepseek-v4-pro[1m]',
  anthropicDefaultOpusModel: 'deepseek-v4-pro[1m]',
  anthropicDefaultSonnetModel: 'deepseek-v4-pro[1m]',
  anthropicDefaultHaikuModel: 'deepseek-v4-flash',
  claudeCodeSubagentModel: 'deepseek-v4-flash',
  claudeCodeEffortLevel: 'max',
}

const FIELD_TO_ENV = {
  anthropicBaseUrl: 'ANTHROPIC_BASE_URL',
  anthropicAuthToken: 'ANTHROPIC_AUTH_TOKEN',
  anthropicModel: 'ANTHROPIC_MODEL',
  anthropicDefaultOpusModel: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
  anthropicDefaultSonnetModel: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
  anthropicDefaultHaikuModel: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  claudeCodeSubagentModel: 'CLAUDE_CODE_SUBAGENT_MODEL',
  claudeCodeEffortLevel: 'CLAUDE_CODE_EFFORT_LEVEL',
} as const satisfies Record<keyof ClaudeBashrcConfig, string>

type ClaudeBashrcField = keyof ClaudeBashrcConfig

function shellSingleQuote(input: string): string {
  return input.replace(/'/g, `'\\''`)
}

function normalizeValue(value: string | undefined, fallback: string): string {
  const normalized = (value || '').trim()
  return normalized || fallback
}

function matchExportValue(content: string, envName: string): string | null {
  const pattern = new RegExp(`^\\s*export\\s+${envName}=(["'])(.*?)\\1\\s*$`, 'm')
  const match = content.match(pattern)
  return match ? match[2] : null
}

function replaceOrAppendExport(content: string, envName: string, value: string): string {
  const line = `export ${envName}="${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  const pattern = new RegExp(`^\\s*export\\s+${envName}=.*$`, 'm')
  if (pattern.test(content)) {
    return content.replace(pattern, line)
  }
  const suffix = content.endsWith('\n') ? '' : '\n'
  return `${content}${suffix}${line}\n`
}

async function writeRawBashrc(content: string): Promise<void> {
  const escaped = shellSingleQuote(BASHRC_PATH)
  const payloadBase64 = Buffer.from(content, 'utf-8').toString('base64')
  await wslBridge.exec(`printf '%s' '${payloadBase64}' | base64 -d > '${escaped}'`, 15000)
}

async function validateBashrcLoad(expected: ClaudeBashrcConfig): Promise<void> {
  const checkCommand = [
    `source '${shellSingleQuote(BASHRC_PATH)}'`,
    '[ -n "$ANTHROPIC_BASE_URL" ]',
    '[ -n "$ANTHROPIC_MODEL" ]',
    '[ -n "$CLAUDE_CODE_SUBAGENT_MODEL" ]',
    `[ "$ANTHROPIC_BASE_URL" = '${shellSingleQuote(expected.anthropicBaseUrl)}' ]`,
    `[ "$ANTHROPIC_MODEL" = '${shellSingleQuote(expected.anthropicModel)}' ]`,
    `[ "$ANTHROPIC_DEFAULT_OPUS_MODEL" = '${shellSingleQuote(expected.anthropicDefaultOpusModel)}' ]`,
    `[ "$ANTHROPIC_DEFAULT_SONNET_MODEL" = '${shellSingleQuote(expected.anthropicDefaultSonnetModel)}' ]`,
    `[ "$ANTHROPIC_DEFAULT_HAIKU_MODEL" = '${shellSingleQuote(expected.anthropicDefaultHaikuModel)}' ]`,
    `[ "$CLAUDE_CODE_SUBAGENT_MODEL" = '${shellSingleQuote(expected.claudeCodeSubagentModel)}' ]`,
    `[ "$CLAUDE_CODE_EFFORT_LEVEL" = '${shellSingleQuote(expected.claudeCodeEffortLevel)}' ]`,
    'echo OK',
  ].join(' && ')

  await wslBridge.execBashInteractiveLogin(checkCommand, 15000)
}

export function defaultClaudeBashrcConfig(): ClaudeBashrcConfig {
  return { ...DEFAULT_CLAUDE_BASHRC_CONFIG }
}

export function normalizeClaudeBashrcConfig(input: Record<string, unknown>): ClaudeBashrcConfig {
  const defaults = defaultClaudeBashrcConfig()
  return {
    anthropicBaseUrl: normalizeValue(typeof input.anthropicBaseUrl === 'string' ? input.anthropicBaseUrl : undefined, defaults.anthropicBaseUrl),
    anthropicAuthToken: normalizeValue(typeof input.anthropicAuthToken === 'string' ? input.anthropicAuthToken : undefined, defaults.anthropicAuthToken),
    anthropicModel: normalizeValue(typeof input.anthropicModel === 'string' ? input.anthropicModel : undefined, defaults.anthropicModel),
    anthropicDefaultOpusModel: normalizeValue(typeof input.anthropicDefaultOpusModel === 'string' ? input.anthropicDefaultOpusModel : undefined, defaults.anthropicDefaultOpusModel),
    anthropicDefaultSonnetModel: normalizeValue(typeof input.anthropicDefaultSonnetModel === 'string' ? input.anthropicDefaultSonnetModel : undefined, defaults.anthropicDefaultSonnetModel),
    anthropicDefaultHaikuModel: normalizeValue(typeof input.anthropicDefaultHaikuModel === 'string' ? input.anthropicDefaultHaikuModel : undefined, defaults.anthropicDefaultHaikuModel),
    claudeCodeSubagentModel: normalizeValue(typeof input.claudeCodeSubagentModel === 'string' ? input.claudeCodeSubagentModel : undefined, defaults.claudeCodeSubagentModel),
    claudeCodeEffortLevel: normalizeValue(typeof input.claudeCodeEffortLevel === 'string' ? input.claudeCodeEffortLevel : undefined, defaults.claudeCodeEffortLevel),
  }
}

export async function readClaudeBashrcConfig(): Promise<ClaudeBashrcConfig> {
  const escaped = shellSingleQuote(BASHRC_PATH)
  const raw = await wslBridge.exec(`cat '${escaped}'`, 15000)
  const next = defaultClaudeBashrcConfig()

  ;(Object.entries(FIELD_TO_ENV) as Array<[ClaudeBashrcField, string]>).forEach(([field, envName]) => {
    const value = matchExportValue(raw, envName)
    next[field] = normalizeValue(value ?? undefined, next[field])
  })

  return next
}

export async function writeClaudeBashrcConfig(config: ClaudeBashrcConfig): Promise<ClaudeBashrcConfig> {
  const escaped = shellSingleQuote(BASHRC_PATH)
  const raw = await wslBridge.exec(`cat '${escaped}'`, 15000)
  let nextContent = raw
  const normalized = defaultClaudeBashrcConfig()

  ;(Object.entries(FIELD_TO_ENV) as Array<[ClaudeBashrcField, string]>).forEach(([field, envName]) => {
    normalized[field] = normalizeValue(config[field], normalized[field])
    nextContent = replaceOrAppendExport(nextContent, envName, normalized[field])
  })

  await writeRawBashrc(nextContent)
  try {
    await validateBashrcLoad(normalized)
    return normalized
  } catch (error) {
    await writeRawBashrc(raw)
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Saved ~/.bashrc but validation failed and was rolled back: ${message}`)
  }
}
