import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { basename, dirname, join, resolve } from 'path'
import type {
  AppCacheLocationConfig,
  AppCacheLocationInfo,
  AppCacheLocationMode,
} from '../../shared/types'

const CACHE_LOCATION_HISTORY_FILE = 'cache-location-history.json'
const CACHE_LOCATION_HISTORY_VERSION = 1
const MAX_CACHE_LOCATION_HISTORY_PATHS = 50

let appliedCacheLocationInfo: AppCacheLocationInfo | null = null

function normalizeMode(value: unknown): AppCacheLocationMode {
  return value === 'install' || value === 'custom' ? value : 'default'
}

function normalizeCustomPath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? resolve(trimmed) : undefined
}

function normalizeCacheLocation(
  value: AppCacheLocationConfig | undefined
): AppCacheLocationConfig {
  const mode = normalizeMode(value?.mode)
  const customPath = normalizeCustomPath(value?.customPath)
  if (mode === 'custom') {
    return { mode, customPath }
  }
  return { mode }
}

function normalizeForCompare(targetPath: string): string {
  const normalized = resolve(targetPath)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function pathsEqual(left: string, right: string): boolean {
  return normalizeForCompare(left) === normalizeForCompare(right)
}

function normalizeCacheRootPath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? resolve(trimmed) : null
}

function dedupeCacheRootPaths(values: unknown[]): string[] {
  const seen = new Set<string>()
  const paths: string[] = []

  for (const value of values) {
    const targetPath = normalizeCacheRootPath(value)
    if (!targetPath) continue

    const key = normalizeForCompare(targetPath)
    if (seen.has(key)) continue

    seen.add(key)
    paths.push(targetPath)
  }

  return paths
}

function getCacheLocationHistoryPath(): string {
  return join(app.getPath('userData'), CACHE_LOCATION_HISTORY_FILE)
}

function readCacheLocationHistoryPaths(): string[] {
  try {
    const raw = readFileSync(getCacheLocationHistoryPath(), 'utf-8')
    const parsed = JSON.parse(raw) as { paths?: unknown }
    return dedupeCacheRootPaths(Array.isArray(parsed.paths) ? parsed.paths : [])
      .slice(0, MAX_CACHE_LOCATION_HISTORY_PATHS)
  } catch {
    return []
  }
}

function writeCacheLocationHistoryPaths(paths: string[]): void {
  try {
    const normalizedPaths = dedupeCacheRootPaths(paths).slice(0, MAX_CACHE_LOCATION_HISTORY_PATHS)
    const historyPath = getCacheLocationHistoryPath()
    const historyDir = dirname(historyPath)

    if (!existsSync(historyDir)) {
      mkdirSync(historyDir, { recursive: true })
    }

    writeFileSync(
      historyPath,
      JSON.stringify({
        version: CACHE_LOCATION_HISTORY_VERSION,
        updatedAt: new Date().toISOString(),
        paths: normalizedPaths,
      }, null, 2),
      'utf-8'
    )
  } catch (error) {
    console.warn('[cache-location] Failed to write cache location history.', error)
  }
}

function rememberAppCacheRootPaths(paths: unknown[]): void {
  const nextPaths = dedupeCacheRootPaths(paths)
  if (nextPaths.length === 0) return

  writeCacheLocationHistoryPaths([
    ...nextPaths,
    ...readCacheLocationHistoryPaths(),
  ])
}

function getDefaultCachePath(): string {
  const userDataName = basename(app.getPath('userData')) || app.getName() || 'ide-electron'
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA
    if (localAppData && localAppData.trim()) {
      return join(localAppData.trim(), userDataName)
    }
  }
  return join(app.getPath('userData'), 'cache')
}

function getInstallCachePath(): string {
  const appDirectory = app.isPackaged
    ? dirname(app.getPath('exe'))
    : process.cwd()
  return join(appDirectory, 'cache')
}

function resolveConfiguredPath(
  config: AppCacheLocationConfig,
  defaultPath: string,
  installPath: string
): string {
  if (config.mode === 'install') return installPath
  if (config.mode === 'custom' && config.customPath) return config.customPath
  return defaultPath
}

function resolveCacheLocationPaths(value: AppCacheLocationConfig | undefined): {
  config: AppCacheLocationConfig
  defaultPath: string
  installPath: string
  configuredPath: string
} {
  const config = normalizeCacheLocation(value)
  const defaultPath = getDefaultCachePath()
  const installPath = getInstallCachePath()
  const configuredPath = resolveConfiguredPath(config, defaultPath, installPath)

  return {
    config,
    defaultPath,
    installPath,
    configuredPath,
  }
}

function ensureWritableDirectory(targetPath: string): { ok: true } | { ok: false; reason: string } {
  try {
    if (!existsSync(targetPath)) {
      mkdirSync(targetPath, { recursive: true })
    }
    const testPath = join(
      targetPath,
      `.ide-electron-cache-write-test-${process.pid}-${Date.now()}`
    )
    writeFileSync(testPath, '', 'utf-8')
    unlinkSync(testPath)
    return { ok: true }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { ok: false, reason }
  }
}

function resolveWritableCachePath(
  configuredPath: string,
  defaultPath: string
): { path: string; usedFallback: boolean; fallbackReason?: string } {
  const targetCheck = ensureWritableDirectory(configuredPath)
  if (targetCheck.ok) {
    return {
      path: configuredPath,
      usedFallback: false,
    }
  }

  const fallbackReason = targetCheck.reason
  if (!pathsEqual(configuredPath, defaultPath)) {
    const defaultCheck = ensureWritableDirectory(defaultPath)
    if (defaultCheck.ok) {
      return {
        path: defaultPath,
        usedFallback: true,
        fallbackReason,
      }
    }
  }

  const legacyPath = join(app.getPath('userData'), 'session')
  if (!pathsEqual(configuredPath, legacyPath)) {
    const legacyCheck = ensureWritableDirectory(legacyPath)
    if (legacyCheck.ok) {
      return {
        path: legacyPath,
        usedFallback: true,
        fallbackReason,
      }
    }
  }

  return {
    path: legacyPath,
    usedFallback: true,
    fallbackReason,
  }
}

export function describeAppCacheLocation(
  value: AppCacheLocationConfig | undefined
): AppCacheLocationInfo {
  const { config, defaultPath, installPath, configuredPath } = resolveCacheLocationPaths(value)
  const nextPath = resolveWritableCachePath(configuredPath, defaultPath)
  const activePath = (() => {
    try {
      return app.getPath('sessionData')
    } catch {
      return nextPath.path
    }
  })()

  return {
    mode: config.mode,
    defaultPath,
    installPath,
    customPath: config.customPath,
    configuredPath,
    activePath,
    nextActivePath: nextPath.path,
    restartRequired: !pathsEqual(activePath, nextPath.path),
    usedFallback: nextPath.usedFallback,
    fallbackReason: nextPath.fallbackReason,
  }
}

export function rememberAppCacheLocation(value: AppCacheLocationConfig | undefined): void {
  const { configuredPath } = resolveCacheLocationPaths(value)
  rememberAppCacheRootPaths([configuredPath])
}

export function getKnownAppCacheRootPaths(
  value: AppCacheLocationConfig | undefined
): string[] {
  const { configuredPath } = resolveCacheLocationPaths(value)
  const activePath = (() => {
    try {
      return app.getPath('sessionData')
    } catch {
      return undefined
    }
  })()

  return dedupeCacheRootPaths([
    configuredPath,
    activePath,
    ...readCacheLocationHistoryPaths(),
    app.getPath('userData'),
  ])
}

export function applyAppCacheLocation(
  value: AppCacheLocationConfig | undefined
): AppCacheLocationInfo {
  const initialInfo = describeAppCacheLocation(value)
  const activePath = initialInfo.nextActivePath

  app.setPath('sessionData', activePath)

  appliedCacheLocationInfo = {
    ...initialInfo,
    activePath,
    nextActivePath: activePath,
    restartRequired: false,
  }

  rememberAppCacheRootPaths([initialInfo.configuredPath, activePath])

  if (initialInfo.usedFallback) {
    console.warn(
      `[cache-location] Failed to use configured cache path "${initialInfo.configuredPath}". ` +
      `Using "${activePath}" instead. ${initialInfo.fallbackReason ?? ''}`
    )
  }

  return appliedCacheLocationInfo
}
