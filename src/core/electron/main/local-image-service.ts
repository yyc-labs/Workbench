import { promises as fs } from 'node:fs'
import { URL } from 'node:url'
import { toHostAccessiblePath } from './host-path'
import { wslBridge } from './wsl-bridge'

const MAX_IMAGE_BYTES = 8 * 1024 * 1024

function imageMimeFromPath(filePath: string): string {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  if (lower.endsWith('.bmp')) return 'image/bmp'
  if (lower.endsWith('.ico')) return 'image/x-icon'
  if (lower.endsWith('.tif') || lower.endsWith('.tiff')) return 'image/tiff'
  return 'application/octet-stream'
}

function decodeFileUrlPathname(pathname: string): string {
  try {
    return decodeURIComponent(pathname)
  } catch {
    return pathname
  }
}

function normalizeLocalPathForCurrentHost(pathValue: string): string {
  const trimmed = pathValue.trim()
  if (!trimmed) return ''

  if (process.platform === 'win32') {
    return toHostAccessiblePath(trimmed)
  }

  if (/^[A-Za-z]:[\\/]/.test(trimmed)) {
    return wslBridge.toWslPath(trimmed)
  }

  return trimmed
}

function resolveFileUrlToLocalPath(fileUrl: string): string {
  const parsed = new URL(fileUrl)
  const host = parsed.hostname
  const pathname = decodeFileUrlPathname(parsed.pathname || '')

  if (host && host !== 'localhost') {
    const uncPath = `//${host}${pathname}`
    return normalizeLocalPathForCurrentHost(uncPath)
  }

  if (/^\/[A-Za-z]:\//.test(pathname)) {
    return normalizeLocalPathForCurrentHost(pathname.slice(1))
  }

  return normalizeLocalPathForCurrentHost(pathname)
}

function resolveLocalImagePath(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) {
    throw new Error('Image source is empty.')
  }

  if (trimmed.toLowerCase().startsWith('ide-local-image:')) {
    return normalizeLocalPathForCurrentHost(decodeLocalImageUri(trimmed.slice('ide-local-image:'.length)))
  }

  if (trimmed.toLowerCase().startsWith('file://')) {
    return resolveFileUrlToLocalPath(trimmed)
  }

  return normalizeLocalPathForCurrentHost(decodeLocalImageUri(trimmed))
}

function decodeLocalImageUri(encodedPath: string): string {
  try {
    return decodeURIComponent(encodedPath)
  } catch {
    return encodedPath
  }
}

export async function readLocalImageAsDataUrl(source: string): Promise<string> {
  const localPath = resolveLocalImagePath(source)
  if (!localPath) {
    throw new Error('Image source is empty.')
  }

  const stat = await fs.stat(localPath)
  if (stat.size > MAX_IMAGE_BYTES) {
    throw new Error('Image file is too large to preview.')
  }

  const buffer = await fs.readFile(localPath)
  return `data:${imageMimeFromPath(localPath)};base64,${buffer.toString('base64')}`
}
