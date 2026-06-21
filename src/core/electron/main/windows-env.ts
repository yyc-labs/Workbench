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

function psEscape(value: string): string {
  return value.replace(/'/g, "''")
}

function buildSetScript(config: ClaudeBashrcConfig): string {
  const lines = (Object.entries(FIELD_TO_ENV) as Array<[keyof ClaudeBashrcConfig, string]>)
    .map(([field, envName]) => {
      const value = psEscape(config[field] ?? '')
      return `[System.Environment]::SetEnvironmentVariable('${envName}', '${value}', 'User')`
    })

  // Broadcast WM_SETTINGCHANGE without Add-Type C# compilation overhead
  lines.push(
    `Start-Process 'rundll32.exe' -ArgumentList 'user32.dll,UpdatePerUserSystemParameters' -Wait -WindowStyle Hidden`,
  )

  return lines.join('\n')
}

export function applyWindowsUserEnvToCurrentProcess(config: ClaudeBashrcConfig): ClaudeBashrcConfig {
  const applied: ClaudeBashrcConfig = { ...config }

  for (const [field, envName] of Object.entries(FIELD_TO_ENV) as Array<[keyof ClaudeBashrcConfig, string]>) {
    const value = config[field] ?? ''
    process.env[envName] = value
    applied[field] = value
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
