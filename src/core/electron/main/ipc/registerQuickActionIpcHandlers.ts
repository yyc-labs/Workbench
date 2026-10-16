import { ipcMain } from 'electron'
import type { QuickActionCreateInput, QuickActionExecuteRequest, QuickActionResult, QuickActionUpdateInput } from '../../../shared/types'
import { IPC } from '../ipc'
import type { RegisterIpcHandlersDependencies } from './registerIpcHandlers.shared'

function parseCreateInput(value: unknown): QuickActionCreateInput | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Partial<QuickActionCreateInput>
  if (typeof input.name !== 'string') return null
  if (!input.action || typeof input.action !== 'object') return null
  return input as QuickActionCreateInput
}

function parseUpdateInput(value: unknown): QuickActionUpdateInput | null {
  if (!value || typeof value !== 'object') return null
  return value as QuickActionUpdateInput
}

function parseExecuteRequest(value: unknown): QuickActionExecuteRequest | null {
  if (!value || typeof value !== 'object') return null
  const request = value as { id?: unknown; spec?: unknown }
  if (typeof request.id === 'string') return { id: request.id }
  if (request.spec && typeof request.spec === 'object') return { spec: request.spec } as QuickActionExecuteRequest
  return null
}

export function registerQuickActionIpcHandlers(deps: RegisterIpcHandlersDependencies): void {
  ipcMain.handle(IPC.QUICK_ACTIONS_LIST, () => {
    return deps.quickActionService.list()
  })

  ipcMain.handle(IPC.QUICK_ACTIONS_CREATE, (_event, payload: unknown) => {
    const input = parseCreateInput(payload)
    if (!input) throw new Error('Invalid quick action payload.')
    return deps.quickActionService.create(input)
  })

  ipcMain.handle(IPC.QUICK_ACTIONS_UPDATE, (_event, payload: unknown) => {
    const request = payload && typeof payload === 'object' ? (payload as { id?: unknown }) : {}
    const id = typeof request.id === 'string' ? request.id : ''
    const input = parseUpdateInput(payload)
    if (!id || !input) throw new Error('Invalid quick action payload.')
    return deps.quickActionService.update(id, input)
  })

  ipcMain.handle(IPC.QUICK_ACTIONS_DELETE, (_event, payload: unknown) => {
    const request = payload && typeof payload === 'object' ? (payload as { id?: unknown }) : {}
    const id = typeof request.id === 'string' ? request.id : ''
    return deps.quickActionService.delete(id)
  })

  ipcMain.handle(IPC.QUICK_ACTIONS_EXECUTE, (_event, payload: unknown): Promise<QuickActionResult> => {
    const request = parseExecuteRequest(payload)
    if (!request) return Promise.resolve({ ok: false, code: 'invalid-spec', error: 'Invalid quick action payload.' })
    return deps.quickActionService.execute(request)
  })

  ipcMain.handle(IPC.QUICK_ACTIONS_CREATE_DESKTOP_SHORTCUT, (_event, payload: unknown) => {
    const request = payload && typeof payload === 'object' ? (payload as { id?: unknown }) : {}
    const id = typeof request.id === 'string' ? request.id : ''
    return deps.quickActionService.createDesktopShortcut(id)
  })

  ipcMain.handle(IPC.QUICK_ACTIONS_REMOVE_DESKTOP_SHORTCUT, (_event, payload: unknown) => {
    const request = payload && typeof payload === 'object' ? (payload as { id?: unknown }) : {}
    const id = typeof request.id === 'string' ? request.id : ''
    return deps.quickActionService.removeDesktopShortcut(id)
  })
}
