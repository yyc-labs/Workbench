import { contextBridge } from 'electron'
import type { ElectronApi } from '../../shared/electronApi'
import { createAgentLogsInvokeApi } from './invokeApi.agentLogs'
import { createAiConnectionInvokeApi } from './invokeApi.aiConnection'
import { createAiGatewayInvokeApi } from './invokeApi.aiGateway'
import { createBrowserAiInvokeApi } from './invokeApi.browserAi'
import { createBrowserScreenshotInvokeApi } from './invokeApi.browserScreenshot'
import { createCoreInvokeApi } from './invokeApi.core'
import { createDocLinkLibraryInvokeApi } from './invokeApi.docLinkLibrary'
import { createGitInvokeApi } from './invokeApi.git'
import { createLearningInvokeApi } from './invokeApi.learning'
import { createMarkdownDocumentInvokeApi } from './invokeApi.markdownDocument'
import { createProcessPortsInvokeApi } from './invokeApi.processPorts'
import { createProjectFileInvokeApi } from './invokeApi.projectFiles'
import { createQuickActionsInvokeApi } from './invokeApi.quickActions'
import { createRunTaskInvokeApi } from './invokeApi.runTasks'
import { createRuntimeInvokeApi } from './invokeApi.runtime'
import { createSkillInvokeApi } from './invokeApi.skill'
import { createTranscriptInvokeApi } from './invokeApi.transcript'
import { createSubscriptionApi } from './subscriptions'

const api = {
  ...createCoreInvokeApi(),
  ...createAgentLogsInvokeApi(),
  ...createAiGatewayInvokeApi(),
  ...createAiConnectionInvokeApi(),
  ...createBrowserAiInvokeApi(),
  ...createBrowserScreenshotInvokeApi(),
  ...createGitInvokeApi(),
  ...createProjectFileInvokeApi(),
  ...createQuickActionsInvokeApi(),
  ...createProcessPortsInvokeApi(),
  ...createRunTaskInvokeApi(),
  ...createTranscriptInvokeApi(),
  ...createLearningInvokeApi(),
  ...createSkillInvokeApi(),
  ...createRuntimeInvokeApi(),
  ...createSubscriptionApi(),
  ...createMarkdownDocumentInvokeApi(),
  ...createDocLinkLibraryInvokeApi(),
} satisfies ElectronApi

contextBridge.exposeInMainWorld('electronAPI', api)

export type ElectronAPI = ElectronApi
