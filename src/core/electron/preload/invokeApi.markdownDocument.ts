import { ipcRenderer } from 'electron'
import { IPC } from '../main/ipc'

export function createMarkdownDocumentInvokeApi() {
  return {
    selectMarkdownDocument: () => ipcRenderer.invoke(IPC.MARKDOWN_DOCUMENT_SELECT),
    readMarkdownDocument: (filePath: string) => ipcRenderer.invoke(IPC.MARKDOWN_DOCUMENT_READ, filePath),
    writeMarkdownDocument: (filePath: string, content: string, expectedMtimeMs: number) => ipcRenderer.invoke(IPC.MARKDOWN_DOCUMENT_WRITE, filePath, content, expectedMtimeMs),
    listMarkdownDocumentHistory: () => ipcRenderer.invoke(IPC.MARKDOWN_DOCUMENT_HISTORY_LIST),
    removeMarkdownDocumentHistory: (filePath: string) => ipcRenderer.invoke(IPC.MARKDOWN_DOCUMENT_HISTORY_REMOVE, filePath),
    clearMarkdownDocumentHistory: () => ipcRenderer.invoke(IPC.MARKDOWN_DOCUMENT_HISTORY_CLEAR),
    saveMarkdownDocumentPastedImageAs: (dataBase64: string, extension: string, suggestedName?: string) => ipcRenderer.invoke(IPC.MARKDOWN_DOCUMENT_PASTED_IMAGE_SAVE_AS, dataBase64, extension, suggestedName),
    consumePendingMarkdownDocumentOpen: () => ipcRenderer.invoke(IPC.MARKDOWN_DOCUMENT_OPEN_REQUESTED),
    routeMarkdownDocumentOpen: (filePath: string) => ipcRenderer.invoke(IPC.MARKDOWN_DOCUMENT_ROUTE_OPEN, filePath),
  }
}
