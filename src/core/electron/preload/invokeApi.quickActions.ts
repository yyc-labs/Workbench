import { ipcRenderer } from 'electron'
import type { QuickAction, QuickActionCreateInput, QuickActionResult, QuickActionUpdateInput, QuickActionView } from '../../shared/types'
import { IPC } from '../main/ipc'

export function createQuickActionsInvokeApi() {
  return {
    listQuickActions: () => ipcRenderer.invoke(IPC.QUICK_ACTIONS_LIST) as Promise<QuickActionView[]>,

    createQuickAction: (input: QuickActionCreateInput) => ipcRenderer.invoke(IPC.QUICK_ACTIONS_CREATE, input) as Promise<QuickAction>,

    updateQuickAction: (id: string, input: QuickActionUpdateInput) => ipcRenderer.invoke(IPC.QUICK_ACTIONS_UPDATE, { id, ...input }) as Promise<QuickAction>,

    deleteQuickAction: (id: string) => ipcRenderer.invoke(IPC.QUICK_ACTIONS_DELETE, { id }) as Promise<boolean>,

    executeQuickAction: (request: { id: string } | { spec: QuickActionCreateInput['action'] }) => ipcRenderer.invoke(IPC.QUICK_ACTIONS_EXECUTE, request) as Promise<QuickActionResult>,

    createQuickActionDesktopShortcut: (id: string) => ipcRenderer.invoke(IPC.QUICK_ACTIONS_CREATE_DESKTOP_SHORTCUT, { id }) as Promise<{ shortcutPath: string }>,

    removeQuickActionDesktopShortcut: (id: string) => ipcRenderer.invoke(IPC.QUICK_ACTIONS_REMOVE_DESKTOP_SHORTCUT, { id }) as Promise<boolean>,
  }
}
