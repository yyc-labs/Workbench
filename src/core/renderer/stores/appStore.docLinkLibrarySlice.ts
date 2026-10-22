import type { StateCreator } from 'zustand'
import type { SharedDocLink, UpsertSharedDocLinkInput } from '../../shared/types'
import type { AppState } from './appStore.types'

export type DocLinkLibrarySlice = Pick<
  AppState,
  | 'sharedDocLinkGroups'
  | 'sharedDocLinks'
  | 'docLinkLibraryLoaded'
  | 'docLinkLibraryError'
  | 'loadDocLinkLibrary'
  | 'createDocLinkGroup'
  | 'renameDocLinkGroup'
  | 'removeDocLinkGroup'
  | 'upsertSharedDocLink'
  | 'removeSharedDocLink'
  | 'reorderSharedDocLinks'
  | 'setSharedDocLinkSecret'
  | 'clearSharedDocLinkSecret'
  | 'getSharedDocLinkSecret'
>

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 库状态镜像：数据本体在主进程，store 只做读缓存与写后同步（所有写 action 以主进程返回的最新文件更新）。 */
export const createDocLinkLibraryActionsSlice: StateCreator<AppState, [], [], DocLinkLibrarySlice> = (set, get) => ({
  sharedDocLinkGroups: [],
  sharedDocLinks: [],
  docLinkLibraryLoaded: false,
  docLinkLibraryError: null,
  loadDocLinkLibrary: async () => {
    try {
      const file = await window.electronAPI.listDocLinkLibrary()
      set({ sharedDocLinkGroups: file.groups, sharedDocLinks: file.links, docLinkLibraryLoaded: true, docLinkLibraryError: null })
    } catch (error) {
      // 失败 = 空库可用，不阻塞任何页面
      set({ docLinkLibraryError: errorMessage(error) })
    }
  },
  createDocLinkGroup: async (name) => {
    try {
      const file = await window.electronAPI.createDocLinkGroup(name)
      set({ sharedDocLinkGroups: file.groups, sharedDocLinks: file.links, docLinkLibraryError: null })
    } catch (error) {
      set({ docLinkLibraryError: errorMessage(error) })
    }
  },
  renameDocLinkGroup: async (groupId, name) => {
    try {
      const file = await window.electronAPI.renameDocLinkGroup(groupId, name)
      set({ sharedDocLinkGroups: file.groups, sharedDocLinks: file.links, docLinkLibraryError: null })
    } catch (error) {
      set({ docLinkLibraryError: errorMessage(error) })
    }
  },
  removeDocLinkGroup: async (groupId) => {
    try {
      const file = await window.electronAPI.removeDocLinkGroup(groupId)
      set({ sharedDocLinkGroups: file.groups, sharedDocLinks: file.links, docLinkLibraryError: null })
    } catch (error) {
      set({ docLinkLibraryError: errorMessage(error) })
    }
  },
  upsertSharedDocLink: async (input: UpsertSharedDocLinkInput) => {
    try {
      const file = await window.electronAPI.upsertSharedDocLink(input)
      set({ sharedDocLinkGroups: file.groups, sharedDocLinks: file.links, docLinkLibraryError: null })
      return file
    } catch (error) {
      set({ docLinkLibraryError: errorMessage(error) })
      return null
    }
  },
  removeSharedDocLink: async (linkId) => {
    try {
      const file = await window.electronAPI.removeSharedDocLink(linkId)
      set({ sharedDocLinkGroups: file.groups, sharedDocLinks: file.links, docLinkLibraryError: null })
    } catch (error) {
      set({ docLinkLibraryError: errorMessage(error) })
    }
  },
  reorderSharedDocLinks: async (groupId, orderedLinkIds) => {
    // 乐观重排（镜像主进程 reorderLinks 语义：ordered 优先 + 未列出的组内项追加尾部，槽位集合不变），
    // 先让列表即时到位供 FLIP 连续播放，IPC 返回后再以主进程文件覆盖纠正；失败回滚重载。
    set((state) => {
      const inGroup = state.sharedDocLinks.filter((link) => link.groupId === groupId)
      const ordered = orderedLinkIds.map((id) => inGroup.find((link) => link.id === id)).filter((link): link is SharedDocLink => Boolean(link))
      const orderedIds = new Set(ordered.map((link) => link.id))
      const nextInGroup = [...ordered, ...inGroup.filter((link) => !orderedIds.has(link.id))]
      const nextIds = new Set(nextInGroup.map((link) => link.id))
      let cursor = 0
      const sharedDocLinks = state.sharedDocLinks.map((link) => (link.groupId === groupId && nextIds.has(link.id) ? nextInGroup[cursor++] : link))
      return { sharedDocLinks }
    })
    try {
      const file = await window.electronAPI.reorderSharedDocLinks(groupId, orderedLinkIds)
      set({ sharedDocLinkGroups: file.groups, sharedDocLinks: file.links, docLinkLibraryError: null })
    } catch (error) {
      set({ docLinkLibraryError: errorMessage(error) })
      await get().loadDocLinkLibrary()
    }
  },
  setSharedDocLinkSecret: async (linkId, secret) => {
    try {
      await window.electronAPI.setSharedDocLinkSecret(linkId, secret)
      set({ docLinkLibraryError: null })
    } catch (error) {
      set({ docLinkLibraryError: errorMessage(error) })
    }
  },
  clearSharedDocLinkSecret: async (linkId) => {
    try {
      await window.electronAPI.deleteSharedDocLinkSecret(linkId)
      set({ docLinkLibraryError: null })
    } catch (error) {
      set({ docLinkLibraryError: errorMessage(error) })
    }
  },
  /** 薄封装：直接返回明文（或 null），不入 store；供「复制密码」与 SSH 打开使用。 */
  getSharedDocLinkSecret: async (linkId) => {
    const result = await window.electronAPI.getSharedDocLinkSecret(linkId)
    return result.secret ?? null
  },
})
