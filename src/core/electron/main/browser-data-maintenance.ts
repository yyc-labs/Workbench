import { app } from 'electron'
import { existsSync } from 'fs'
import { rm } from 'fs/promises'
import { join, resolve } from 'path'
import { LEGACY_BROWSER_DATA_CLEANUP_RELATIVE_PATHS } from './browser-data-maintenance-paths'
import { getKnownAppCacheRootPaths } from './cache-location'
import { loadConfig } from './config'
import type {
  BrowserDataCacheRootInfo,
  BrowserDataCleanupResult,
  BrowserDataMaintenanceInfo,
  BrowserDataOperationItemResult,
} from '../../shared/types'

const CACHE_LOCATION_DATA_LOSS_ITEMS = [
  'Cookies',
  'Local Storage',
  'Session Storage',
  'IndexedDB',
  'Preferences',
  'Network',
]

function normalizeForCompare(targetPath: string): string {
  const normalized = resolve(targetPath)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function pathsEqual(left: string, right: string): boolean {
  return normalizeForCompare(left) === normalizeForCompare(right)
}

function pathIsSameOrInside(targetPath: string, parentPath: string): boolean {
  const normalizedTarget = normalizeForCompare(targetPath)
  const normalizedParent = normalizeForCompare(parentPath)
  if (normalizedTarget === normalizedParent) return true
  const separator = process.platform === 'win32' ? '\\' : '/'
  return normalizedTarget.startsWith(`${normalizedParent}${separator}`)
}

function pathsOverlap(left: string, right: string): boolean {
  return pathIsSameOrInside(left, right) || pathIsSameOrInside(right, left)
}

function splitRelativePath(relativePath: string): string[] {
  return relativePath.split(/[\\/]+/).filter(Boolean)
}

function resolveSafeChildPath(rootPath: string, relativePath: string): string | null {
  const targetPath = resolve(rootPath, ...splitRelativePath(relativePath))
  return pathIsSameOrInside(targetPath, rootPath) && !pathsEqual(targetPath, rootPath)
    ? targetPath
    : null
}

function getCurrentBrowserDataPath(): string {
  try {
    return app.getPath('sessionData')
  } catch {
    return app.getPath('userData')
  }
}

function getLegacyBrowserDataDetected(
  rootPath: string,
  currentBrowserDataPath: string
): boolean {
  return LEGACY_BROWSER_DATA_CLEANUP_RELATIVE_PATHS.some((name) => {
    const sourcePath = resolveSafeChildPath(rootPath, name)
    return Boolean(
      sourcePath
      && existsSync(sourcePath)
      && !pathsOverlap(sourcePath, currentBrowserDataPath)
    )
  })
}

function getOldCacheRoots(currentBrowserDataPath: string): BrowserDataCacheRootInfo[] {
  const currentConfig = loadConfig().cacheLocation

  return getKnownAppCacheRootPaths(currentConfig)
    .filter((rootPath) => !pathsOverlap(rootPath, currentBrowserDataPath))
    .map((rootPath) => {
      const browserDataPath = join(rootPath, 'session')
      return {
        rootPath,
        browserDataPath,
        rootExists: existsSync(rootPath),
        browserDataExists: existsSync(browserDataPath),
        browserDataDetected: getLegacyBrowserDataDetected(rootPath, currentBrowserDataPath),
        sourceEqualsTarget: pathsEqual(browserDataPath, currentBrowserDataPath),
      }
    })
    .filter((item) => item.browserDataDetected || item.browserDataExists)
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function selectTargetOldCacheRoots(
  info: BrowserDataMaintenanceInfo,
  rootPath?: string
): BrowserDataCacheRootInfo[] {
  const normalizedRootPath = typeof rootPath === 'string' ? rootPath.trim() : ''
  if (!normalizedRootPath) {
    return info.oldCacheRoots
  }

  return info.oldCacheRoots.filter((item) => pathsEqual(item.rootPath, normalizedRootPath))
}

export function getBrowserDataMaintenanceInfo(): BrowserDataMaintenanceInfo {
  const currentBrowserDataPath = getCurrentBrowserDataPath()
  const oldCacheRoots = getOldCacheRoots(currentBrowserDataPath)
  const primaryOldCacheRoot = oldCacheRoots[0] ?? {
    rootPath: app.getPath('userData'),
    browserDataPath: join(app.getPath('userData'), 'session'),
    rootExists: false,
    browserDataExists: false,
    browserDataDetected: false,
    sourceEqualsTarget: false,
  }

  return {
    currentBrowserDataPath,
    oldCacheRootPath: primaryOldCacheRoot.rootPath,
    oldBrowserDataPath: primaryOldCacheRoot.browserDataPath,
    oldCacheRootPaths: oldCacheRoots.map((item) => item.rootPath),
    oldBrowserDataPaths: oldCacheRoots.map((item) => item.browserDataPath),
    oldCacheRoots,
    oldCacheRootExists: primaryOldCacheRoot.rootExists,
    oldBrowserDataExists: primaryOldCacheRoot.browserDataExists,
    oldBrowserDataDetected: oldCacheRoots.some((item) => item.browserDataDetected),
    sourceEqualsTarget: oldCacheRoots.some((item) => item.sourceEqualsTarget),
    dataLossItems: [...CACHE_LOCATION_DATA_LOSS_ITEMS],
    cleanupItems: [...LEGACY_BROWSER_DATA_CLEANUP_RELATIVE_PATHS],
  }
}

export async function cleanupLegacyBrowserCaches(rootPath?: string): Promise<BrowserDataCleanupResult> {
  const info = getBrowserDataMaintenanceInfo()
  const items: BrowserDataOperationItemResult[] = []
  const targetRoots = selectTargetOldCacheRoots(info, rootPath)

  if (typeof rootPath === 'string' && rootPath.trim() && targetRoots.length === 0) {
    throw new Error('Selected old cache root was not found.')
  }

  for (const root of targetRoots) {
    for (const name of LEGACY_BROWSER_DATA_CLEANUP_RELATIVE_PATHS) {
      const sourcePath = resolveSafeChildPath(root.rootPath, name)
      if (!sourcePath) {
        items.push({
          name,
          rootPath: root.rootPath,
          status: 'failed',
          error: 'Resolved cleanup path is outside the old cache root.',
        })
        continue
      }

      if (pathsOverlap(sourcePath, info.currentBrowserDataPath)) {
        items.push({ name, rootPath: root.rootPath, sourcePath, status: 'skipped-same-path' })
        continue
      }

      if (!existsSync(sourcePath)) {
        items.push({ name, rootPath: root.rootPath, sourcePath, status: 'not-found' })
        continue
      }

      try {
        await rm(sourcePath, { recursive: true, force: true })
        items.push({ name, rootPath: root.rootPath, sourcePath, status: 'deleted' })
      } catch (error) {
        items.push({
          name,
          rootPath: root.rootPath,
          sourcePath,
          status: 'failed',
          error: toErrorMessage(error),
        })
      }
    }

    try {
      await rm(root.rootPath, { recursive: false, force: false })
    } catch {
      // Ignore non-empty or locked roots. The targeted browser data cleanup already ran.
    }
  }

  return {
    info: getBrowserDataMaintenanceInfo(),
    items,
  }
}
