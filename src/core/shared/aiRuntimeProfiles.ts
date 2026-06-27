import type { AiRuntimeProfile, CliTool, ProjectInfo, SavedProject } from './types'

export const DEFAULT_AI_RUNTIME_PROFILE_CLAUDE_ID = 'native-claude'
export const DEFAULT_AI_RUNTIME_PROFILE_CODEX_ID = 'native-codex'

export function defaultAiRuntimeProfiles(): AiRuntimeProfile[] {
  return [
    {
      id: DEFAULT_AI_RUNTIME_PROFILE_CLAUDE_ID,
      name: 'Claude',
      kind: 'native',
      mode: 'inherit',
      cli: 'claude',
      command: 'claude',
      args: [],
      env: {},
      passProjectPath: false,
    },
    {
      id: DEFAULT_AI_RUNTIME_PROFILE_CODEX_ID,
      name: 'Codex',
      kind: 'native',
      mode: 'inherit',
      cli: 'codex',
      command: 'codex',
      args: [],
      env: {},
      passProjectPath: false,
    },
  ]
}

export function isCliTool(value: unknown): value is CliTool {
  return value === 'claude' || value === 'codex'
}

export function defaultAiRuntimeProfileIdForCli(cli?: CliTool): string {
  return cli === 'codex'
    ? DEFAULT_AI_RUNTIME_PROFILE_CODEX_ID
    : DEFAULT_AI_RUNTIME_PROFILE_CLAUDE_ID
}

export function isDefaultAiRuntimeCliProfile(profile?: AiRuntimeProfile | null): boolean {
  if (!profile) return false
  const idMatches = profile.id === DEFAULT_AI_RUNTIME_PROFILE_CLAUDE_ID
    || profile.id === DEFAULT_AI_RUNTIME_PROFILE_CODEX_ID
  const expectedCli = profile.id === DEFAULT_AI_RUNTIME_PROFILE_CODEX_ID ? 'codex' : 'claude'
  const command = profile.command?.trim() || profile.cli || expectedCli
  return idMatches
    && (profile.mode === undefined || profile.mode === 'inherit')
    && profile.kind === 'native'
    && profile.cli === expectedCli
    && command === expectedCli
    && (profile.args ?? []).length === 0
}

export function getAiRuntimeProfileCli(
  profile?: AiRuntimeProfile | null,
  fallback: CliTool = 'claude',
): CliTool {
  if (isCliTool(profile?.cli)) return profile.cli
  const command = profile?.command?.trim().split(/\s+/)[0]
  if (isCliTool(command)) return command
  return fallback === 'codex' ? 'codex' : 'claude'
}

export function getAiRuntimeProfileCommand(
  profile?: AiRuntimeProfile | null,
  fallback: CliTool = 'claude',
): string {
  const command = profile?.command?.trim()
  if (command) return command
  const cli = getAiRuntimeProfileCli(profile, fallback)
  return cli === 'codex' ? 'codex' : 'claude'
}

export function getAiRuntimeProfileLabel(
  profile?: AiRuntimeProfile | null,
  fallbackCli: CliTool = 'claude',
): string {
  const name = profile?.name?.trim()
  if (name) return name
  return getAiRuntimeProfileCli(profile, fallbackCli) === 'codex' ? 'Codex' : 'Claude'
}

export function resolveAiRuntimeProfile(
  profiles: AiRuntimeProfile[] | undefined,
  profileId?: string,
  fallbackCli?: CliTool,
): AiRuntimeProfile {
  const defaults = defaultAiRuntimeProfiles()
  const list = profiles && profiles.length > 0 ? profiles : defaults
  const normalizedProfileId = profileId?.trim()
  if (normalizedProfileId) {
    const matched = list.find((profile) => profile.id === normalizedProfileId)
    if (matched) return matched
  }
  const defaultId = defaultAiRuntimeProfileIdForCli(fallbackCli)
  return list.find((profile) => profile.id === defaultId)
    ?? list[0]
    ?? defaults[0]!
}

export function resolveProjectAiRuntimeProfileId(
  project: Pick<ProjectInfo | SavedProject, 'aiRuntimeProfileId' | 'cli'>,
  activeProfileId?: string,
): string {
  const explicit = project.aiRuntimeProfileId?.trim()
  if (explicit) return explicit
  if (project.cli) return defaultAiRuntimeProfileIdForCli(project.cli)
  const active = activeProfileId?.trim()
  if (active) return active
  return defaultAiRuntimeProfileIdForCli()
}

export function slugAiRuntimeProfileName(value: string, fallback = 'ai'): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 18)
  return slug || fallback
}
