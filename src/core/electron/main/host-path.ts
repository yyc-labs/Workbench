import { wslBridge } from './wsl-bridge'

function normalizePathValue(pathValue: string): string {
  return pathValue.trim().replace(/\\/g, '/')
}

export function isWslUncPath(pathValue: string): boolean {
  const normalized = normalizePathValue(pathValue)
  return /^\/\/(?:wsl\.localhost|wsl\$)\//i.test(normalized)
}

export function isWindowsDrivePath(pathValue: string): boolean {
  const normalized = normalizePathValue(pathValue)
  return /^[a-z]:\//i.test(normalized)
}

export function isWindowsMountedPosixPath(pathValue: string): boolean {
  const normalized = normalizePathValue(pathValue)
  return /^\/mnt\/[a-z](?:\/|$)/i.test(normalized)
}

export function normalizeWindowsHostPath(pathValue: string, defaultDistro?: string): string {
  const trimmed = pathValue.trim()
  if (!trimmed) return pathValue

  const normalized = normalizePathValue(trimmed)

  if (isWindowsMountedPosixPath(normalized)) {
    return wslBridge.toWindowsPath(normalized)
  }

  const wslUncMatch = normalized.match(/^\/\/(wsl\.localhost|wsl\$)\/([^/]+)\/?(.*)$/i)
  if (wslUncMatch) {
    const authority = wslUncMatch[1]
    const distro = wslUncMatch[2]
    const rest = wslUncMatch[3]
      ? `\\${wslUncMatch[3].replace(/\//g, '\\')}`
      : ''
    return `\\\\${authority}\\${distro}${rest}`
  }

  if (normalized.startsWith('/') && defaultDistro) {
    return `\\\\wsl.localhost\\${defaultDistro}${normalized.replace(/\//g, '\\')}`
  }

  if (isWindowsDrivePath(normalized)) {
    return normalized.replace(/\//g, '\\')
  }

  if (normalized.startsWith('//')) {
    return `\\\\${normalized.slice(2).replace(/\//g, '\\')}`
  }

  return trimmed
}

export function toHostAccessiblePath(pathValue: string, defaultDistro?: string): string {
  if (process.platform !== 'win32') return pathValue
  return normalizeWindowsHostPath(pathValue, defaultDistro)
}
