export const CURRENT_CONFIG_SCHEMA_VERSION = 1

export type ConfigRecoveryReason = 'invalid-json' | 'read-failed'

export interface ConfigRecoveryInfo {
  recovered: boolean
  reason?: ConfigRecoveryReason
  backupPath?: string
  occurredAt?: number
  message?: string
}
