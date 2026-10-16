import type { BrowserWindow } from 'electron'
import http from 'http'
import type { RunTaskProgressEvent } from '../../../shared/runTasks'
import type { BrowserScreenshotViewerPayload, Capability, TranscriptCaptureInitialText, TranscriptGatewayImportPayload, TranscriptImportedEvent } from '../../../shared/types'
import type { AgentLogService } from '../agent-logs/agent-log-service'
import type { AiCommitService } from '../ai-commit/ai-commit-service'
import type { AiConnectionService } from '../ai-connection/ai-connection-service'
import type { AiGatewayService } from '../ai-gateway/gateway-service'
import type { BrowserAiService } from '../browser-ai/browserAiService'
import { loadConfig } from '../config'
import type { DocLinkLibraryService } from '../doc-link-library/docLinkLibraryService'
import type { GitService } from '../git/git-service'
import type { AgentHookGateway } from '../hooks/agent-hook-gateway'
import type { LearningService } from '../learning/learningService'
import type { MarkdownDocumentOpenRequestStore } from '../markdown-document/markdownDocumentOpenRequest'
import type { MarkdownDocumentService } from '../markdown-document/markdownDocumentService'
import type { ProcessPortService } from '../process-ports/process-port-service'
import { toProjectFileServiceErrorMessage } from '../project-file-service'
import type { QuickActionService } from '../quick-actions/quickActionService'
import type { RunTaskService } from '../run-tasks/run-task-service'
import type { ProcessManager } from '../runner'
import type { RuntimeService } from '../runtime/runtime-service'
import type { PreviewPageCaptureService } from '../screenshot/previewCaptureService'
import type { BrowserScreenshotService } from '../screenshot/screenshotService'
import type { SkillService } from '../skill/skillService'
import type { TranscriptService } from '../transcript/transcriptService'
import type { TranscriptShareService } from '../transcript/transcriptShareService'

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
  aiConnectionService: AiConnectionService
  aiGatewayService: AiGatewayService
  browserAiService: BrowserAiService
  browserScreenshotService: BrowserScreenshotService
  previewPageCaptureService: PreviewPageCaptureService
  openBrowserScreenshotViewer: (payload: BrowserScreenshotViewerPayload) => Promise<boolean>
  getBrowserScreenshotViewerData: () => BrowserScreenshotViewerPayload | null
  toggleBrowserScreenshotWindow: () => Promise<boolean>
  markBrowserScreenshotViewerReady: (senderId: number) => Promise<boolean>
  openAppViewWindow: (viewPath: string) => Promise<boolean>
  hasAppViewWindow: (viewPath: string) => Promise<boolean>
  agentHookGateway: AgentHookGateway
  gitService: GitService
  runtimeService: RuntimeService
  processPortService: ProcessPortService
  runTaskService: RunTaskService
  emitRunTaskProgress: (event: RunTaskProgressEvent) => void
  learningService: LearningService
  skillService: SkillService
  transcriptService: TranscriptService
  transcriptShareService: TranscriptShareService
  markdownDocumentService: MarkdownDocumentService
  markdownDocumentOpenRequestStore: MarkdownDocumentOpenRequestStore
  routeMarkdownDocumentOpen: (markdownPath: string) => void
  docLinkLibraryService: DocLinkLibraryService
  quickActionService: QuickActionService
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

export async function requestTranscriptImportViaGateway(payload: TranscriptGatewayImportPayload): Promise<TranscriptGatewayImportResult> {
  const agentHooks = loadConfig().agentHooks || {}
  const transcriptImport = agentHooks.transcriptImport || {}
  const enabled = transcriptImport.enabled ?? true
  if (!enabled) {
    throw new Error('Transcript import API is disabled.')
  }

  const configuredHost = agentHooks.host && agentHooks.host !== '127.0.0.1' ? agentHooks.host : '127.0.0.1'
  // 通配监听（0.0.0.0 / ::）只用于绑定，内部出站连接用 127.0.0.1。
  const host = configuredHost === '0.0.0.0' || configuredHost === '::' || configuredHost === '[::]' ? '127.0.0.1' : configuredHost
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
          ...(transcriptImport.token ? { 'x-workbench-transcript-token': transcriptImport.token } : {}),
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
            reject(new Error(typeof parsed?.error === 'string' ? parsed.error : `Transcript import API request failed with status ${statusCode}.`))
          } catch {
            reject(new Error(`Transcript import API request failed with status ${statusCode}.`))
          }
        })
      },
    )

    req.on('error', (error) => {
      reject(error)
    })

    req.write(body)
    req.end()
  })
}
