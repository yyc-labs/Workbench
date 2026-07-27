import { contextBridge } from 'electron'
import type { ElectronApi } from '../../shared/electronApi'
import { createAgentLogsInvokeApi } from './invokeApi.agentLogs'
import { createAiGatewayInvokeApi } from './invokeApi.aiGateway'
import { createAiConnectionInvokeApi } from './invokeApi.aiConnection'
import { createBrowserAiInvokeApi } from './invokeApi.browserAi'
import { createBrowserScreenshotInvokeApi } from './invokeApi.browserScreenshot'
import { createCoreInvokeApi } from './invokeApi.core'
import { createGitInvokeApi } from './invokeApi.git'
import { createLearningInvokeApi } from './invokeApi.learning'
import { createSkillInvokeApi } from './invokeApi.skill'
import { createProjectFileInvokeApi } from './invokeApi.projectFiles'
import { createRuntimeInvokeApi } from './invokeApi.runtime'
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
  ...createTranscriptInvokeApi(),
  ...createLearningInvokeApi(),
  ...createSkillInvokeApi(),
  ...createRuntimeInvokeApi(),
  ...createSubscriptionApi(),
} satisfies ElectronApi

contextBridge.exposeInMainWorld('electronAPI', api)

export type ElectronAPI = ElectronApi
