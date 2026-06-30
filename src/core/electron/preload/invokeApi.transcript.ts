import { ipcRenderer } from 'electron'
import { IPC } from '../main/ipc'
import type {
  TranscriptImportedEvent,
  TranscriptExternalImportPayload,
  TranscriptGatewayImportPayload,
  TranscriptSession,
  TranscriptSessionSummary,
  TranscriptShareListResult,
  TranscriptShareStartPayload,
  TranscriptShareStartResult,
  TranscriptImportPayload,
  TranscriptUpdatePayload,
} from '../../shared/types'

export function createTranscriptInvokeApi() {
  return {
    importTranscript: (payload: TranscriptImportPayload) =>
      ipcRenderer.invoke(IPC.TRANSCRIPT_IMPORT, payload) as Promise<TranscriptSession>,

    importExternalTranscript: (payload: TranscriptExternalImportPayload) =>
      ipcRenderer.invoke(IPC.TRANSCRIPT_IMPORT_EXTERNAL, payload) as Promise<TranscriptImportedEvent>,

    importTranscriptViaGateway: (payload: TranscriptGatewayImportPayload) =>
      ipcRenderer.invoke(IPC.TRANSCRIPT_IMPORT_VIA_GATEWAY, payload) as Promise<{
        ok: boolean
        projectId: string
        sessionId: string
        title: string
        sourceType: string
        openViewer: boolean
      }>,

    listProjectTranscripts: (projectId: string) =>
      ipcRenderer.invoke(IPC.TRANSCRIPT_LIST, projectId) as Promise<TranscriptSessionSummary[]>,

    listAllTranscripts: () =>
      ipcRenderer.invoke(IPC.TRANSCRIPT_LIST_ALL) as Promise<
        Array<{ projectId: string; summaries: TranscriptSessionSummary[] }>
      >,

    getTranscript: (projectId: string, transcriptId: string) =>
      ipcRenderer.invoke(IPC.TRANSCRIPT_GET, projectId, transcriptId) as Promise<TranscriptSession | null>,

    updateTranscript: (payload: TranscriptUpdatePayload) =>
      ipcRenderer.invoke(IPC.TRANSCRIPT_UPDATE, payload) as Promise<TranscriptSession>,

    deleteTranscript: (projectId: string, transcriptId: string) =>
      ipcRenderer.invoke(IPC.TRANSCRIPT_DELETE, projectId, transcriptId) as Promise<boolean>,

    startTranscriptShare: (payload: TranscriptShareStartPayload) =>
      ipcRenderer.invoke(IPC.TRANSCRIPT_SHARE_START, payload) as Promise<TranscriptShareStartResult>,

    stopTranscriptShare: (token: string) =>
      ipcRenderer.invoke(IPC.TRANSCRIPT_SHARE_STOP, token) as Promise<TranscriptShareListResult>,

    listTranscriptShares: () =>
      ipcRenderer.invoke(IPC.TRANSCRIPT_SHARE_LIST) as Promise<TranscriptShareListResult>,
  }
}
