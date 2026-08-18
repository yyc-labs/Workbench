import { ipcMain } from 'electron'
import { IPC } from '../ipc'
import { MarkdownDocumentService } from '../markdown-document/markdownDocumentService'
import type { MarkdownDocumentOpenRequestStore } from '../markdown-document/markdownDocumentOpenRequest'

export function registerMarkdownDocumentIpcHandlers(service: MarkdownDocumentService, openRequestStore: MarkdownDocumentOpenRequestStore): void {
  ipcMain.handle(IPC.MARKDOWN_DOCUMENT_SELECT, () => service.select())
  ipcMain.handle(IPC.MARKDOWN_DOCUMENT_READ, (_event, filePath: string) => service.read(filePath))
  ipcMain.handle(IPC.MARKDOWN_DOCUMENT_WRITE, (_event, filePath: string, content: string, expectedMtimeMs: number) => service.write(filePath, content, expectedMtimeMs))
  ipcMain.handle(IPC.MARKDOWN_DOCUMENT_HISTORY_LIST, () => service.listHistory())
  ipcMain.handle(IPC.MARKDOWN_DOCUMENT_HISTORY_REMOVE, (_event, filePath: string) => service.removeHistory(filePath))
  ipcMain.handle(IPC.MARKDOWN_DOCUMENT_HISTORY_CLEAR, () => service.clearHistory())
  ipcMain.handle(IPC.MARKDOWN_DOCUMENT_PASTED_IMAGE_SAVE_AS, (_event, dataBase64: string, extension: string, suggestedName?: string) => service.savePastedImageAs(dataBase64, extension, suggestedName))
  ipcMain.handle(IPC.MARKDOWN_DOCUMENT_OPEN_REQUESTED, () => openRequestStore.consume())
}
