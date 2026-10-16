import { ipcRenderer } from 'electron'
import type { UpsertSharedDocLinkInput } from '../../shared/types'
import { IPC } from '../main/ipc'

export function createDocLinkLibraryInvokeApi() {
  return {
    listDocLinkLibrary: () => ipcRenderer.invoke(IPC.DOC_LINK_LIBRARY_LIST),
    createDocLinkGroup: (name: string) => ipcRenderer.invoke(IPC.DOC_LINK_LIBRARY_GROUP_CREATE, name),
    renameDocLinkGroup: (groupId: string, name: string) => ipcRenderer.invoke(IPC.DOC_LINK_LIBRARY_GROUP_RENAME, groupId, name),
    removeDocLinkGroup: (groupId: string) => ipcRenderer.invoke(IPC.DOC_LINK_LIBRARY_GROUP_REMOVE, groupId),
    upsertSharedDocLink: (input: UpsertSharedDocLinkInput) => ipcRenderer.invoke(IPC.DOC_LINK_LIBRARY_LINK_UPSERT, input),
    removeSharedDocLink: (linkId: string) => ipcRenderer.invoke(IPC.DOC_LINK_LIBRARY_LINK_REMOVE, linkId),
    reorderSharedDocLinks: (groupId: string, orderedLinkIds: string[]) => ipcRenderer.invoke(IPC.DOC_LINK_LIBRARY_LINK_REORDER, groupId, orderedLinkIds),
    setSharedDocLinkSecret: (linkId: string, secret: string) => ipcRenderer.invoke(IPC.DOC_LINK_LIBRARY_LINK_SECRET_SET, linkId, secret),
    getSharedDocLinkSecret: (linkId: string) => ipcRenderer.invoke(IPC.DOC_LINK_LIBRARY_LINK_SECRET_GET, linkId),
    deleteSharedDocLinkSecret: (linkId: string) => ipcRenderer.invoke(IPC.DOC_LINK_LIBRARY_LINK_SECRET_DELETE, linkId),
  }
}
