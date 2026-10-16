import { ipcMain } from 'electron'
import type { UpsertSharedDocLinkInput } from '../../../shared/types'
import type { DocLinkLibraryService } from '../doc-link-library/docLinkLibraryService'
import { IPC } from '../ipc'

export function registerDocLinkLibraryIpcHandlers(service: DocLinkLibraryService): void {
  ipcMain.handle(IPC.DOC_LINK_LIBRARY_LIST, () => service.list())
  ipcMain.handle(IPC.DOC_LINK_LIBRARY_GROUP_CREATE, (_event, name: string) => service.createGroup(name))
  ipcMain.handle(IPC.DOC_LINK_LIBRARY_GROUP_RENAME, (_event, groupId: string, name: string) => service.renameGroup(groupId, name))
  ipcMain.handle(IPC.DOC_LINK_LIBRARY_GROUP_REMOVE, (_event, groupId: string) => service.removeGroup(groupId))
  ipcMain.handle(IPC.DOC_LINK_LIBRARY_LINK_UPSERT, (_event, input: UpsertSharedDocLinkInput) => service.upsertLink(input))
  ipcMain.handle(IPC.DOC_LINK_LIBRARY_LINK_REMOVE, (_event, linkId: string) => service.removeLink(linkId))
  ipcMain.handle(IPC.DOC_LINK_LIBRARY_LINK_REORDER, (_event, groupId: string, orderedLinkIds: string[]) => service.reorderLinks(groupId, orderedLinkIds))
  ipcMain.handle(IPC.DOC_LINK_LIBRARY_LINK_SECRET_SET, (_event, linkId: string, secret: string) => service.setLinkSecret(linkId, secret))
  ipcMain.handle(IPC.DOC_LINK_LIBRARY_LINK_SECRET_GET, async (_event, linkId: string) => ({ secret: await service.getLinkSecret(linkId) }))
  ipcMain.handle(IPC.DOC_LINK_LIBRARY_LINK_SECRET_DELETE, (_event, linkId: string) => service.deleteLinkSecret(linkId))
}
