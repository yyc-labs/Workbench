import { createHash } from 'crypto'
import { basename } from 'path'
import type { AiRuntimeProfile, CliTool } from '../../../shared/types'
import {
  getAiRuntimeProfileCli,
  getAiRuntimeProfileCommand,
  isDefaultAiRuntimeCliProfile,
  slugAiRuntimeProfileName,
} from '../../../shared/aiRuntimeProfiles'

export function quoteBashSingle(input: string): string {
  return input.replace(/'/g, "'\\''")
}

export function quoteShellArg(input: string): string {
  return `'${quoteBashSingle(input)}'`
}

export function quoteWindowsShellArg(input: string): string {
  if (!/[\s"'`&|<>^]/.test(input)) return input
  return `"${input.replace(/"/g, '\\"')}"`
}

function normalizeProfileArgs(profile?: AiRuntimeProfile | null): string[] {
  return (profile?.args ?? [])
    .map((item) => item.trim())
    .filter(Boolean)
}

export function buildProfileCommandLine(
  profile: AiRuntimeProfile | undefined,
  fallbackCli: CliTool,
  resolvedProjectPath?: string,
  quoteArg: (input: string) => string = quoteShellArg,
): string {
  const command = getAiRuntimeProfileCommand(profile, fallbackCli)
  const args = normalizeProfileArgs(profile)
  if (profile?.kind === 'custom' && profile.passProjectPath && resolvedProjectPath) {
    args.push(resolvedProjectPath)
  }
  if (args.length === 0) return command
  return [command, ...args.map(quoteArg)].join(' ')
}

export function buildRuntimeProfileEnv(input: {
  profile?: AiRuntimeProfile
  fallbackCli: CliTool
  projectPath: string
  resolvedProjectPath: string
  sessionName: string
  commandLine: string
}): Record<string, string> {
  const profile = input.profile
  const cli = getAiRuntimeProfileCli(profile, input.fallbackCli)
  return {
    ...(profile?.env ?? {}),
    AI_CLI: cli,
    AI_RUNTIME_CLI: cli,
    YYC_AI_RUNTIME_CLI: cli,
    AI_RUNTIME_PROFILE_ID: profile?.id ?? `legacy-${cli}`,
    YYC_AI_RUNTIME_PROFILE_ID: profile?.id ?? `legacy-${cli}`,
    AI_RUNTIME_PROFILE_NAME: profile?.name ?? cli,
    YYC_AI_RUNTIME_PROFILE_NAME: profile?.name ?? cli,
    AI_RUNTIME_PROFILE_KIND: profile?.kind ?? 'native',
    YYC_AI_RUNTIME_PROFILE_KIND: profile?.kind ?? 'native',
    AI_RUNTIME_COMMAND: input.commandLine,
    YYC_AI_RUNTIME_COMMAND: input.commandLine,
    AI_RUNTIME_PROJECT_PATH: input.resolvedProjectPath,
    YYC_AI_RUNTIME_PROJECT_PATH: input.resolvedProjectPath,
    AI_RUNTIME_HOST_PROJECT_PATH: input.projectPath,
    YYC_AI_RUNTIME_HOST_PROJECT_PATH: input.projectPath,
    AI_RUNTIME_SESSION_NAME: input.sessionName,
    YYC_AI_RUNTIME_SESSION_NAME: input.sessionName,
  }
}

export function buildEnvPrefix(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${quoteShellArg(value)}`)
    .join(' ')
}

export function buildProfileAwareSessionName(
  projectPath: string,
  profile: AiRuntimeProfile | undefined,
  fallbackCli: CliTool,
  legacyBuilder: (projectPath: string, cli?: CliTool) => string,
  hashPath: string = projectPath,
): string {
  const cli = getAiRuntimeProfileCli(profile, fallbackCli)
  if (!profile || isDefaultAiRuntimeCliProfile(profile)) {
    return legacyBuilder(projectPath, cli)
  }

  const profileSlug = slugAiRuntimeProfileName(profile.name || profile.id)
  const hash = createHash('md5')
    .update(`${profile.id}:${hashPath}`)
    .digest('hex')
    .slice(0, 6)
  return `${basename(projectPath)}-${profileSlug}-${hash}`
}
