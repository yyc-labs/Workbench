import type { AiExecutionMode } from '../../../../shared/types'

export type RuntimePanelProject = {
  id: string
  name: string
  path: string
}

export type RuntimeDiagnosticsState = {
  mode: AiExecutionMode
  providerLabel: string
  supported: boolean
  availableModes: AiExecutionMode[]
  issues: string[]
  hasWsl: boolean
  hasTmux: boolean
  launcherScriptExists?: boolean
  launcherScriptExecutable?: boolean
}

export type ManagedProcessRow = {
  key: string
  label: string
  processId: string
  actionKey: string
  loading: boolean
  disabled: boolean
}

export type SessionInventoryRow = {
  key: string
  label: string
  sessionName: string
  closeBy: 'session' | 'process'
  managedProcessId?: string
  actionKey: string | null
  loading: boolean
  disabled: boolean
}

export type SessionInventoryGroup = {
  key: 'active' | 'inactive'
  label: string
  items: SessionInventoryRow[]
}
