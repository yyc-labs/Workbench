import { ipcMain } from 'electron'
import { IPC } from '../ipc'
import type {
  TranscriptExternalImportPayload,
  TranscriptGatewayImportPayload,
  TranscriptImportPayload,
  TranscriptShareStartPayload,
  TranscriptUpdatePayload,
} from '../../../shared/types'
import {
  requestTranscriptImportViaGateway,
  type RegisterIpcHandlersDependencies,
} from './registerIpcHandlers.shared'

export function registerTranscriptIpcHandlers(
  deps: RegisterIpcHandlersDependencies
): void {
  ipcMain.handle(IPC.TRANSCRIPT_IMPORT, async (_event, payload: TranscriptImportPayload) => {
    return deps.transcriptService.importTranscript(payload)
  })

  ipcMain.handle(
    IPC.TRANSCRIPT_IMPORT_EXTERNAL,
    async (_event, payload: TranscriptExternalImportPayload) => {
      const imported = await deps.transcriptService.importExternalTranscript(payload)
      deps.emitTranscriptImported(imported)
      return imported
    }
  )

  ipcMain.handle(
    IPC.TRANSCRIPT_IMPORT_VIA_GATEWAY,
    async (_event, payload: TranscriptGatewayImportPayload) => {
      return requestTranscriptImportViaGateway(payload)
    }
  )

  ipcMain.handle(IPC.TRANSCRIPT_LIST, async (_event, projectId: string) => {
    return deps.transcriptService.listProjectTranscripts(projectId)
  })

  ipcMain.handle(IPC.TRANSCRIPT_LIST_ALL, async () => {
    return deps.transcriptService.listAllTranscripts()
  })

  ipcMain.handle(IPC.TRANSCRIPT_GET, async (_event, projectId: string, transcriptId: string) => {
    return deps.transcriptService.getTranscript(projectId, transcriptId)
  })

  ipcMain.handle(IPC.TRANSCRIPT_UPDATE, async (_event, payload: TranscriptUpdatePayload) => {
    return deps.transcriptService.updateTranscript(payload)
  })

  ipcMain.handle(IPC.TRANSCRIPT_DELETE, async (_event, projectId: string, transcriptId: string) => {
    return deps.transcriptService.deleteTranscript(projectId, transcriptId)
  })

  ipcMain.handle(IPC.TRANSCRIPT_SHARE_START, async (_event, payload: TranscriptShareStartPayload) => {
    return deps.transcriptShareService.start(payload)
  })

  ipcMain.handle(IPC.TRANSCRIPT_SHARE_STOP, (_event, token: string) => {
    return deps.transcriptShareService.stop(token)
  })

  ipcMain.handle(IPC.TRANSCRIPT_SHARE_LIST, () => {
    return deps.transcriptShareService.list()
  })
}
