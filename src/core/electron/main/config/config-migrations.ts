import { CURRENT_CONFIG_SCHEMA_VERSION } from '../../../shared/configSchema'

type ConfigDocument = Record<string, unknown>

export interface MigratedConfigDocument {
  document: ConfigDocument
  migrated: boolean
  version: number
}

function asConfigDocument(value: unknown): ConfigDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  return { ...(value as ConfigDocument) }
}

/**
 * Keep migrations pure so historical config fixtures can be tested without Electron.
 * Unknown fields remain intact and are normalized by the existing domain normalizers.
 */
export function migrateConfigDocument(value: unknown): MigratedConfigDocument {
  const source = asConfigDocument(value)
  const rawVersion = Number(source.configVersion)
  const version = Number.isInteger(rawVersion) && rawVersion > 0 ? rawVersion : 0

  return {
    document: {
      ...source,
      configVersion: CURRENT_CONFIG_SCHEMA_VERSION,
    },
    migrated: version !== CURRENT_CONFIG_SCHEMA_VERSION,
    version: CURRENT_CONFIG_SCHEMA_VERSION,
  }
}
