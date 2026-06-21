import { spawn } from 'child_process'
import { readFile, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { wslBridge } from './wsl-bridge'
import type { ClaudeBashrcConfig } from '../../shared/types'

const BASHRC_PATH = process.platform === 'win32'
  ? '/home/ubuntu/.bashrc'
  : join(homedir(), '.bashrc')

const DEFAULT_CLAUDE_BASHRC_CONFIG: ClaudeBashrcConfig = {
  anthropicBaseUrl: 'https://api.deepseek.com/anthropic',
  anthropicAuthToken: '',
  anthropicModel: 'deepseek-v4-pro[1m]',
  anthropicDefaultOpusModel: 'deepseek-v4-pro[1m]',
  anthropicDefaultSonnetModel: 'deepseek-v4-pro[1m]',
  anthropicDefaultHaikuModel: 'deepseek-v4-flash',
  claudeCodeSubagentModel: 'deepseek-v4-flash',
}

const FIELD_TO_ENV = {
  anthropicBaseUrl: 'ANTHROPIC_BASE_URL',
  anthropicAuthToken: 'ANTHROPIC_AUTH_TOKEN',
  anthropicModel: 'ANTHROPIC_MODEL',
  anthropicDefaultOpusModel: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
  anthropicDefaultSonnetModel: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
  anthropicDefaultHaikuModel: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  claudeCodeSubagentModel: 'CLAUDE_CODE_SUBAGENT_MODEL',
} as const satisfies Record<keyof ClaudeBashrcConfig, string>

type ClaudeBashrcField = keyof ClaudeBashrcConfig

function ensureShellRuntimeAvailable(): void {
  if (process.platform === 'win32' && !wslBridge.isAvailable()) {
    throw new Error('WSL is not available on this host')
  }
}

function shellSingleQuote(input: string): string {
  return input.replace(/'/g, `'\\''`)
}

function normalizeValue(value: string | undefined, fallback: string): string {
  const normalized = (value || '').trim()
  return normalized || fallback
}

function decodeExportValue(rawValue: string): string {
  const trimmed = rawValue.trim()
  if (!trimmed) return ''

  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
  }

  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1)
  }

  return trimmed.replace(/\s+#.*$/, '').trim()
}

function matchExportValue(content: string, envName: string): string | null {
  const pattern = new RegExp(`^\\s*export\\s+${envName}=(.*)$`, 'm')
  const match = content.match(pattern)
  return match ? decodeExportValue(match[1]) : null
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
  ensureShellRuntimeAvailable()
  if (process.platform === 'win32') {
    const escaped = shellSingleQuote(BASHRC_PATH)
    const payloadBase64 = Buffer.from(content, 'utf-8').toString('base64')
    await wslBridge.exec(`printf '%s' '${payloadBase64}' | base64 -d > '${escaped}'`, 15000)
    return
  }
  await writeFile(BASHRC_PATH, content, 'utf-8')
}

async function readRawBashrc(): Promise<string> {
  ensureShellRuntimeAvailable()
  if (process.platform === 'win32') {
    const escaped = shellSingleQuote(BASHRC_PATH)
    return wslBridge.exec(`cat '${escaped}'`, 15000)
  }
  return readFile(BASHRC_PATH, 'utf-8')
}

async function execBashInteractiveLogin(command: string): Promise<void> {
  if (process.platform === 'win32') {
    await wslBridge.execBashInteractiveLogin(command, 15000)
    return
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn('bash', ['-ilc', command], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => reject(error))
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(stderr.trim() || `bash -ilc exited with code ${code}`))
    })
  })
}

async function validateBashrcLoad(expected: ClaudeBashrcConfig): Promise<void> {
  ensureShellRuntimeAvailable()
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
    'echo OK',
  ].join(' && ')

  await execBashInteractiveLogin(checkCommand)
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
  }
}

export async function readClaudeBashrcConfig(): Promise<ClaudeBashrcConfig> {
  const raw = await readRawBashrc()
  const next = defaultClaudeBashrcConfig()

  ;(Object.entries(FIELD_TO_ENV) as Array<[ClaudeBashrcField, string]>).forEach(([field, envName]) => {
    const value = matchExportValue(raw, envName)
    next[field] = normalizeValue(value ?? undefined, next[field])
  })

  return next
}

export async function writeClaudeBashrcConfig(config: ClaudeBashrcConfig): Promise<ClaudeBashrcConfig> {
  const raw = await readRawBashrc()
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
