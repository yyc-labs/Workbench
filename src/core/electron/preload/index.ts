import { contextBridge } from 'electron'
import type { ElectronApi } from '../../shared/electronApi'
import { createAgentLogsInvokeApi } from './invokeApi.agentLogs'
import { createAiGatewayInvokeApi } from './invokeApi.aiGateway'
import { createBrowserAiInvokeApi } from './invokeApi.browserAi'
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
  ...createBrowserAiInvokeApi(),
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
