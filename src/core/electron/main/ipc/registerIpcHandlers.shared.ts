import type { BrowserWindow } from 'electron'
import http from 'http'
import { loadConfig } from '../config'
import { toProjectFileServiceErrorMessage } from '../project-file-service'
import type { AgentLogService } from '../agent-logs/agent-log-service'
import type { AiCommitService } from '../ai-commit/ai-commit-service'
import type { AiGatewayService } from '../ai-gateway/gateway-service'
import type { AgentHookGateway } from '../hooks/agent-hook-gateway'
import type { GitService } from '../git/git-service'
import type { LearningService } from '../learning/learningService'
import type { RuntimeService } from '../runtime/runtime-service'
import type { ProcessManager } from '../runner'
import type { TranscriptService } from '../transcript/transcriptService'
import type { TranscriptShareService } from '../transcript/transcriptShareService'
import type {
  Capability,
  TranscriptCaptureInitialText,
  TranscriptImportedEvent,
  TranscriptGatewayImportPayload,
} from '../../../shared/types'

export type RuntimeStateChangedPayload = {
  reason: string
  projectId?: string
  sessionName?: string
}

export type RegisterIpcHandlersDependencies = {
  getMainWindow: () => BrowserWindow | null
  getProcessManager: () => ProcessManager | null
  getCapability: () => Capability | null
  emitRuntimeStateChanged: (payload: RuntimeStateChangedPayload) => void
  emitTranscriptImported: (payload: TranscriptImportedEvent) => void
  consumeTranscriptCaptureInitialText: () => Promise<TranscriptCaptureInitialText>
  agentLogService: AgentLogService
  aiCommitService: AiCommitService
  aiGatewayService: AiGatewayService
  agentHookGateway: AgentHookGateway
  gitService: GitService
  runtimeService: RuntimeService
  learningService: LearningService
  transcriptService: TranscriptService
  transcriptShareService: TranscriptShareService
}

type GitRequestWithRepoRoot = {
  repoRoot?: unknown
}

export type TranscriptGatewayImportResult = {
  ok: boolean
  projectId: string
  sessionId: string
  title: string
  sourceType: string
  openViewer: boolean
}

export function getBootDistro(deps: RegisterIpcHandlersDependencies): string {
  return deps.getCapability()?.wslDistro || 'Ubuntu'
}

export async function withProjectFileErrors<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action()
  } catch (error) {
    throw new Error(toProjectFileServiceErrorMessage(error))
  }
}

export function normalizeGitRequest<T extends GitRequestWithRepoRoot>(request: T): T {
  return {
    ...request,
    repoRoot: typeof request?.repoRoot === 'string' ? request.repoRoot : '',
  }
}

export async function requestTranscriptImportViaGateway(
  payload: TranscriptGatewayImportPayload
): Promise<TranscriptGatewayImportResult> {
  const agentHooks = loadConfig().agentHooks || {}
  const transcriptImport = agentHooks.transcriptImport || {}
  const enabled = transcriptImport.enabled ?? true
  if (!enabled) {
    throw new Error('Transcript import API is disabled.')
  }

  const host = (
    agentHooks.host && agentHooks.host !== '127.0.0.1'
      ? agentHooks.host
      : '127.0.0.1'
  ) || '127.0.0.1'
  const port = Number.isFinite(agentHooks.port) ? Number(agentHooks.port) : 17373
  const body = JSON.stringify({
    projectId: payload.projectId,
    rawText: payload.rawText,
    title: payload.title,
    sourceType: payload.sourceType ?? 'manual-markdown',
    sourceLabel: payload.sourceLabel,
    processId: payload.processId,
    capturedAt: payload.capturedAt,
    openViewer: payload.openViewer,
  })

  return new Promise<TranscriptGatewayImportResult>((resolve, reject) => {
    const req = http.request(
      {
        host,
        port,
        path: '/transcripts/import',
        method: 'POST',
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-length': Buffer.byteLength(body),
          ...(transcriptImport.token
            ? { 'x-ide-electron-transcript-token': transcriptImport.token }
            : {}),
        },
      },
      (res) => {
        let responseBody = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          responseBody += chunk
        })
        res.on('end', () => {
          const statusCode = res.statusCode ?? 500
          try {
            const parsed = responseBody.trim() ? JSON.parse(responseBody) : {}
            if (statusCode >= 200 && statusCode < 300) {
              resolve(parsed as TranscriptGatewayImportResult)
              return
            }
            reject(
              new Error(
                typeof parsed?.error === 'string'
                  ? parsed.error
                  : `Transcript import API request failed with status ${statusCode}.`
              )
            )
          } catch {
            reject(
              new Error(
                `Transcript import API request failed with status ${statusCode}.`
              )
            )
          }
        })
      }
    )

    req.on('error', (error) => {
      reject(error)
    })

    req.write(body)
    req.end()
  })
}
