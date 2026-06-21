import { exec } from 'child_process'
import type { ClaudeBashrcConfig } from '../../shared/types'

const FIELD_TO_ENV: Record<keyof ClaudeBashrcConfig, string> = {
  anthropicBaseUrl: 'ANTHROPIC_BASE_URL',
  anthropicAuthToken: 'ANTHROPIC_AUTH_TOKEN',
  anthropicModel: 'ANTHROPIC_MODEL',
  anthropicDefaultOpusModel: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
  anthropicDefaultSonnetModel: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
  anthropicDefaultHaikuModel: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  claudeCodeSubagentModel: 'CLAUDE_CODE_SUBAGENT_MODEL',
}

/**
 * Every env var name this module has ever managed (past + present).
 * Used to clean up orphaned entries when fields are removed from
 * ClaudeBashrcConfig — without this list, old vars linger in the
 * Windows registry forever.
 */
const ALL_KNOWN_ENV_NAMES: ReadonlySet<string> = new Set([
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'CLAUDE_CODE_SUBAGENT_MODEL',
  // Previously managed — kept here so orphaned registry entries
  // from older versions are cleaned up on next save.
  'CLAUDE_CODE_EFFORT_LEVEL',
])

function psEscape(value: string): string {
  return value.replace(/'/g, "''")
}

function buildSetScript(config: ClaudeBashrcConfig): string {
  const managedNames = new Set(Object.values(FIELD_TO_ENV))
  const lines: string[] = []

  // Set currently-managed vars.
  for (const [field, envName] of Object.entries(FIELD_TO_ENV) as Array<[keyof ClaudeBashrcConfig, string]>) {
    const value = psEscape(config[field] ?? '')
    lines.push(`[System.Environment]::SetEnvironmentVariable('${envName}', '${value}', 'User')`)
  }

  // Delete orphaned env vars that this module once managed but are no
  // longer part of ClaudeBashrcConfig.
  for (const envName of ALL_KNOWN_ENV_NAMES) {
    if (!managedNames.has(envName)) {
      lines.push(`[System.Environment]::SetEnvironmentVariable('${envName}', $null, 'User')`)
    }
  }

  // Broadcast WM_SETTINGCHANGE without Add-Type C# compilation overhead
  lines.push(
    `Start-Process 'rundll32.exe' -ArgumentList 'user32.dll,UpdatePerUserSystemParameters' -Wait -WindowStyle Hidden`,
  )

  return lines.join('\n')
}

export function applyWindowsUserEnvToCurrentProcess(config: ClaudeBashrcConfig): ClaudeBashrcConfig {
  const applied: ClaudeBashrcConfig = { ...config }
  const managedNames = new Set(Object.values(FIELD_TO_ENV))

  for (const [field, envName] of Object.entries(FIELD_TO_ENV) as Array<[keyof ClaudeBashrcConfig, string]>) {
    const value = config[field] ?? ''
    process.env[envName] = value
    applied[field] = value
  }

  // Remove orphaned env vars that this module once managed but are no
  // longer part of ClaudeBashrcConfig — prevents stale values from
  // leaking into child processes spawned with process.env.
  for (const envName of ALL_KNOWN_ENV_NAMES) {
    if (!managedNames.has(envName)) {
      delete process.env[envName]
    }
  }

  return applied
}

export function writeWindowsUserEnv(config: ClaudeBashrcConfig): Promise<void> {
  if (process.platform !== 'win32') return Promise.resolve()

  const script = buildSetScript(config)

  return new Promise((resolve, reject) => {
    const child = exec('powershell.exe -NonInteractive -NoProfile -', {
      timeout: 15000,
      windowsHide: true,
    }, (error) => {
      if (error) reject(error)
      else resolve()
    })
    child.stdin?.write(script)
    child.stdin?.end()
  })
}
