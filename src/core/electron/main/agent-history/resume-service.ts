/**
 * Resume service (plan 20 stage 6, D2).
 *
 * Capability-driven: each provider's resume support comes from its verified
 * capabilities (stage 0/6 real-CLI behavior), never from parameter similarity.
 * Launch reuses the AI Runtime chain (startRuntime) so Windows Native and WSL
 * stay consistent; the resume args are injected as a structured profile
 * (P0-3 ③④: args array, no shell string, sessionId format-checked upstream).
 */
import { detectProjectEnvironment } from '../../../shared/projectEnvironment'
import { projectIdFromPath } from '../../../shared/rules'
import type { AiRuntimeProfile, CliTool } from '../../../shared/types'
import type { AgentHistoryExecutionEnvironment, AgentHistoryResumeResult } from '../../../shared/types/agentHistory'
import type { AgentHistoryCache } from './cache/db'
import type { AgentHistoryProviderRegistry } from './provider-registry'
import type { AgentHistoryLoadConfig } from './scan-service'

export interface AgentHistoryResumeDeps {
  loadConfig: AgentHistoryLoadConfig
  cache: AgentHistoryCache | null
  providers: AgentHistoryProviderRegistry
  runtimeService: {
    startRuntime: (projectId: string, projectPath: string, profile?: AiRuntimeProfile | null, cli?: CliTool, resumeSessionId?: string) => Promise<boolean>
  }
}

/** P0-3 ④: sessionId must survive this whitelist before it touches an argv. */
export function isSafeResumeSessionId(sessionId: string): boolean {
  return /^[A-Za-z0-9._-]{1,128}$/.test(sessionId)
}

/** Per-CLI resume arg shapes (stage 0 measurements; codebuddy defaults to reusing the session id). */
export function resumeArgsFor(cli: string, sessionId: string): string[] {
  if (cli === 'codex') return ['resume', sessionId]
  return ['--resume', sessionId]
}

export function createAgentHistoryResumeService(deps: AgentHistoryResumeDeps) {
  const { loadConfig, cache, providers, runtimeService } = deps
  return {
    async resume(args: { projectId: string; sessionKey: string }): Promise<AgentHistoryResumeResult> {
      const project = loadConfig().projects.find((candidate) => projectIdFromPath(candidate.path) === args.projectId)
      if (!project) return { ok: false, reason: 'SESSION_NOT_FOUND' }
      const row = cache?.listByProject(args.projectId).find((item) => item.sessionKey === args.sessionKey)
      if (!row) return { ok: false, reason: 'SESSION_NOT_FOUND' }
      const view = JSON.parse(row.dataJson) as { sessionId?: string | null; agent?: string }
      const agent = view.agent ?? row.providerId
      const provider = providers.get(agent as 'claude' | 'codex' | 'codebuddy')
      if (!provider || provider.capabilities.nativeResume !== true) return { ok: false, reason: 'RESUME_UNSUPPORTED' }
      if (!view.sessionId || !isSafeResumeSessionId(view.sessionId)) return { ok: false, reason: 'NO_SESSION_ID' }

      const profile: AiRuntimeProfile = {
        id: 'agent-history-resume-' + agent,
        name: agent === 'codex' ? 'Codex Resume' : agent === 'codebuddy' ? 'CodeBuddy Resume' : 'Claude Resume',
        kind: 'native',
        mode: 'inherit',
        cli: agent as CliTool,
        command: agent,
        // Runtime service injects the provider-specific resume arguments from
        // resumeSessionId; keeping them here would append the session twice.
        args: [],
        env: {},
        passProjectPath: false,
      }
      const executionEnvironment: AgentHistoryExecutionEnvironment = detectProjectEnvironment(project.path) === 'ubuntu' ? 'wsl' : 'windows'
      try {
        const ok = await runtimeService.startRuntime(args.projectId, project.path, profile, agent as 'claude' | 'codex' | 'codebuddy', view.sessionId)
        if (!ok) return { ok: false, reason: 'LAUNCH_FAILED' }
        return { ok: true, provider: agent, executionEnvironment }
      } catch {
        return { ok: false, reason: 'LAUNCH_FAILED' }
      }
    },
  }
}
