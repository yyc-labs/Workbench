import { contextBridge } from 'electron'
import { createCoreInvokeApi } from './invokeApi.core'
import { createGitInvokeApi } from './invokeApi.git'
import { createLearningInvokeApi } from './invokeApi.learning'
import { createProjectFileInvokeApi } from './invokeApi.projectFiles'
import { createRuntimeInvokeApi } from './invokeApi.runtime'
import { createTranscriptInvokeApi } from './invokeApi.transcript'
import { createSubscriptionApi } from './subscriptions'

const api = {
  ...createCoreInvokeApi(),
  ...createGitInvokeApi(),
  ...createProjectFileInvokeApi(),
  ...createTranscriptInvokeApi(),
  ...createLearningInvokeApi(),
  ...createRuntimeInvokeApi(),
  ...createSubscriptionApi(),
}

contextBridge.exposeInMainWorld('electronAPI', api)

export type ElectronAPI = typeof api
