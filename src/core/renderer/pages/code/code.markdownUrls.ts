import { defaultUrlTransform } from 'react-markdown'

export function isWindowsAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value)
}

export function toFileUrlFromAbsolutePath(absolutePath: string): string {
  const normalized = absolutePath.trim().replace(/\\/g, '/')
  if (!normalized) return ''
  if (normalized.startsWith('//')) {
    return `file:${encodeURI(normalized)}`
  }
  if (/^[A-Za-z]:\//.test(normalized)) {
    return `file:///${encodeURI(normalized)}`
  }
  if (normalized.startsWith('/')) {
    return `file://${encodeURI(normalized)}`
  }
  return ''
}

function decodeUrlComponentSafely(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function decodeMarkdownUrlPathSafely(value: string): string {
  return decodeUrlComponentSafely(value)
}

function normalizeFileUrl(value: string): string {
  try {
    const parsed = new URL(value)
    if (parsed.protocol === 'file:') {
      return parsed.toString()
    }
  } catch {
    return value
  }
  return value
}

export function normalizeAbsoluteMarkdownFileUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  if (trimmed.toLowerCase().startsWith('file:')) {
    return normalizeFileUrl(trimmed)
  }

  const decoded = decodeUrlComponentSafely(trimmed)
  if (isWindowsAbsolutePath(decoded)) {
    return toFileUrlFromAbsolutePath(decoded) || decoded
  }

  if (isWindowsAbsolutePath(trimmed)) {
    return toFileUrlFromAbsolutePath(trimmed) || trimmed
  }

  if (decoded !== trimmed && isWindowsAbsolutePath(decoded)) {
    return toFileUrlFromAbsolutePath(decoded) || decoded
  }

  return null
}

export function transformMarkdownUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return ''

  if (trimmed.toLowerCase().startsWith('transcript-ref://')) {
    return trimmed
  }

  const absoluteFileUrl = normalizeAbsoluteMarkdownFileUrl(trimmed)
  if (absoluteFileUrl) {
    return absoluteFileUrl
  }

  return defaultUrlTransform(trimmed)
}
