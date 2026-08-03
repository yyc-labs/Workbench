import { app } from 'electron'
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { LegacyUserDataMigrationInfo, LegacyUserDataMigrationResult } from '../../shared/types'

const LEGACY_APP_NAMES = ['ide-electron', 'IDE Electron']
const MIGRATION_MARKER_FILE = '.workbench-legacy-migration.json'
const MIGRATION_MARKER_VERSION = 2

const TRANSIENT_NAMES = new Set(['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnGraphiteCache', 'Crashpad', 'Session Storage', 'SingletonCookie', 'SingletonLock', 'SingletonSocket', 'lockfile'])

function isTransientName(name: string): boolean {
  return TRANSIENT_NAMES.has(name) || name.startsWith('Singleton')
}

async function copyLegacyEntries(sourcePath: string, targetPath: string): Promise<number> {
  let copiedCount = 0
  const entries = await readdir(sourcePath, { withFileTypes: true })

  for (const entry of entries) {
    if (isTransientName(entry.name)) continue

    const sourceEntryPath = join(sourcePath, entry.name)
    const targetEntryPath = join(targetPath, entry.name)

    if (entry.isDirectory()) {
      try {
        const targetInfo = await stat(targetEntryPath)
        if (!targetInfo.isDirectory()) continue
      } catch {
        await mkdir(targetEntryPath, { recursive: true })
      }
      copiedCount += await copyLegacyEntries(sourceEntryPath, targetEntryPath)
      continue
    }

    if (entry.isFile()) {
      await copyFile(sourceEntryPath, targetEntryPath)
      copiedCount += 1
    }
  }

  return copiedCount
}

async function hasMigrationMarker(targetPath: string): Promise<boolean> {
  try {
    const marker = JSON.parse(await readFile(join(targetPath, MIGRATION_MARKER_FILE), 'utf-8')) as { version?: unknown }
    return marker.version === MIGRATION_MARKER_VERSION
  } catch {
    return false
  }
}

async function findLegacyUserDataPath(): Promise<string | null> {
  for (const appName of LEGACY_APP_NAMES) {
    const candidatePath = join(app.getPath('appData'), appName)
    try {
      const sourceInfo = await stat(candidatePath)
      if (sourceInfo.isDirectory()) return candidatePath
    } catch {
      // Try the next legacy directory name.
    }
  }
  return null
}

function getMigrationTargetPath(): string {
  return app.getPath('userData')
}

function getMigrationMarkerPath(targetPath: string): string {
  return join(targetPath, MIGRATION_MARKER_FILE)
}

export async function getLegacyUserDataMigrationInfo(): Promise<LegacyUserDataMigrationInfo> {
  const targetPath = getMigrationTargetPath()
  const legacyPath = await findLegacyUserDataPath()
  const sourcePath = legacyPath ?? join(app.getPath('appData'), LEGACY_APP_NAMES[0])
  return {
    sourcePath,
    targetPath,
    sourceExists: Boolean(legacyPath),
    migrationCompleted: await hasMigrationMarker(targetPath),
  }
}

export async function migrateLegacyUserData(): Promise<LegacyUserDataMigrationResult> {
  const targetPath = app.getPath('userData')
  const sourcePath = await findLegacyUserDataPath()
  if (!sourcePath) {
    return { ok: false, sourcePath: join(app.getPath('appData'), LEGACY_APP_NAMES[0]), targetPath, copiedCount: 0, error: 'Legacy user data directory was not found.' }
  }
  if (sourcePath.toLowerCase() === targetPath.toLowerCase()) {
    return { ok: false, sourcePath, targetPath, copiedCount: 0, error: 'Legacy and current user data directories are the same.' }
  }

  try {
    if (await hasMigrationMarker(targetPath)) {
      return { ok: false, sourcePath, targetPath, copiedCount: 0, error: 'Legacy user data has already been migrated.' }
    }
    await mkdir(targetPath, { recursive: true })
    const copiedCount = await copyLegacyEntries(sourcePath, targetPath)
    await writeFile(getMigrationMarkerPath(targetPath), JSON.stringify({ version: MIGRATION_MARKER_VERSION, sourcePath, migratedAt: new Date().toISOString(), copiedCount }, null, 2), 'utf-8')
    return { ok: true, sourcePath, targetPath, copiedCount }
  } catch (error) {
    console.warn('[migration] Failed to migrate legacy user data.', error)
    return { ok: false, sourcePath, targetPath, copiedCount: 0, error: error instanceof Error ? error.message : String(error) }
  }
}
