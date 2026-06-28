import type {
  AiEnvironmentConfig,
  RuntimeEntrypointConfig,
  RuntimeEntrypointTarget,
  RuntimeEntrypointWslPrefix,
} from './types'

export const RUNTIME_ENTRYPOINT_WSL_PREFIXES = ['~/', '$HOME/', '${HOME}/', '/'] as const

const DEFAULT_WSL_PREFIX: RuntimeEntrypointWslPrefix = '~/'

function cleanPathValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function isRuntimeEntrypointWslPrefix(value: unknown): value is RuntimeEntrypointWslPrefix {
  return RUNTIME_ENTRYPOINT_WSL_PREFIXES.includes(value as RuntimeEntrypointWslPrefix)
}

export function isLikelyWslEntrypointPath(pathValue?: string): boolean {
  const normalized = pathValue?.trim() || ''
  if (!normalized) return false
  return normalized.startsWith('/')
    || normalized.startsWith('~/')
    || normalized === '~'
    || normalized === '$HOME'
    || normalized.startsWith('$HOME/')
    || normalized === '${HOME}'
    || normalized.startsWith('${HOME}/')
}

export function isClearlyWindowsEntrypointPath(pathValue?: string): boolean {
  const normalized = pathValue?.trim() || ''
  if (!normalized) return false
  return /^[A-Za-z]:[\\/]/.test(normalized) || /^\\\\/.test(normalized)
}

export function splitWslEntrypointPath(pathValue?: string): {
  prefix: RuntimeEntrypointWslPrefix
  relativePath: string
} {
  const normalized = pathValue?.trim() || ''
  if (normalized === '~') return { prefix: '~/', relativePath: '' }
  if (normalized.startsWith('~/')) return { prefix: '~/', relativePath: normalized.slice(2) }
  if (normalized === '$HOME') return { prefix: '$HOME/', relativePath: '' }
  if (normalized.startsWith('$HOME/')) return { prefix: '$HOME/', relativePath: normalized.slice(6) }
  if (normalized === '${HOME}') return { prefix: '${HOME}/', relativePath: '' }
  if (normalized.startsWith('${HOME}/')) return { prefix: '${HOME}/', relativePath: normalized.slice(8) }
  if (normalized.startsWith('/')) return { prefix: '/', relativePath: normalized.replace(/^\/+/, '') }
  return { prefix: DEFAULT_WSL_PREFIX, relativePath: normalized.replace(/^\/+/, '') }
}

export function composeWslEntrypointPath(
  prefix: RuntimeEntrypointWslPrefix,
  relativePath: string,
): string {
  const normalizedRelativePath = relativePath.trim().replace(/^\/+/, '')
  if (!normalizedRelativePath) return ''
  return prefix === '/'
    ? `/${normalizedRelativePath}`
    : `${prefix}${normalizedRelativePath}`
}

export function createRuntimeEntrypointConfigFromPath(
  pathValue: string | undefined,
  target?: RuntimeEntrypointTarget,
): RuntimeEntrypointConfig | undefined {
  const path = cleanPathValue(pathValue)
  if (!path) return undefined
  const resolvedTarget = target ?? (isLikelyWslEntrypointPath(path) ? 'wsl' : 'native')
  if (resolvedTarget === 'wsl') {
    const parts = splitWslEntrypointPath(path)
    return {
      target: 'wsl',
      path,
      wslPrefix: parts.prefix,
      wslRelativePath: parts.relativePath,
    }
  }
  return {
    target: 'native',
    path,
  }
}

export function createWslRuntimeEntrypointConfig(
  prefix: RuntimeEntrypointWslPrefix,
  relativePath: string,
): RuntimeEntrypointConfig | undefined {
  const path = composeWslEntrypointPath(prefix, relativePath)
  if (!path) return undefined
  return {
    target: 'wsl',
    path,
    wslPrefix: prefix,
    wslRelativePath: relativePath.trim().replace(/^\/+/, ''),
  }
}

export function normalizeRuntimeEntrypointConfig(
  value: RuntimeEntrypointConfig | unknown,
  fallbackPath?: string,
): RuntimeEntrypointConfig | undefined {
  if (!value || typeof value !== 'object') {
    return createRuntimeEntrypointConfigFromPath(fallbackPath)
  }

  const raw = value as Partial<RuntimeEntrypointConfig>
  const rawTarget = raw.target === 'wsl' || raw.target === 'native' ? raw.target : undefined
  const fallback = cleanPathValue(fallbackPath)
  const rawPath = cleanPathValue(raw.path)
  const rawPrefix = isRuntimeEntrypointWslPrefix(raw.wslPrefix) ? raw.wslPrefix : undefined
  const rawRelativePath = cleanPathValue(raw.wslRelativePath)
  const target = rawTarget ?? (isLikelyWslEntrypointPath(rawPath || fallback) ? 'wsl' : 'native')

  if (target === 'wsl') {
    const pathParts = splitWslEntrypointPath(rawPath || fallback)
    const prefix = rawPrefix ?? pathParts.prefix
    const relativePath = rawRelativePath || pathParts.relativePath
    const path = rawPath || composeWslEntrypointPath(prefix, relativePath) || fallback
    if (!path) return undefined
    const normalizedParts = splitWslEntrypointPath(path)
    return {
      target: 'wsl',
      path,
      wslPrefix: prefix,
      wslRelativePath: relativePath || normalizedParts.relativePath,
    }
  }

  const path = rawPath || fallback
  if (!path) return undefined
  return {
    target: 'native',
    path,
  }
}

export function composeRuntimeEntrypointConfig(config?: RuntimeEntrypointConfig): string {
  if (!config) return ''
  if (config.path.trim()) return config.path.trim()
  if (config.target === 'wsl' && config.wslPrefix && config.wslRelativePath) {
    return composeWslEntrypointPath(config.wslPrefix, config.wslRelativePath)
  }
  return ''
}

export function dedupeRuntimeEntrypointConfigs(
  entries: Array<RuntimeEntrypointConfig | undefined>,
): RuntimeEntrypointConfig[] {
  const result: RuntimeEntrypointConfig[] = []
  const seen = new Set<string>()
  for (const entry of entries) {
    if (!entry) continue
    const path = composeRuntimeEntrypointConfig(entry)
    if (!path) continue
    const normalized = normalizeRuntimeEntrypointConfig({ ...entry, path })
    if (!normalized) continue
    const key = `${normalized.target}:${path}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(normalized)
  }
  return result
}

export function normalizeRuntimeEntrypointHistoryEntries(
  entries: unknown,
  legacyHistory: unknown,
  primary?: RuntimeEntrypointConfig | string,
): RuntimeEntrypointConfig[] | undefined {
  const normalizedEntries: Array<RuntimeEntrypointConfig | undefined> = []
  if (typeof primary === 'string') {
    normalizedEntries.push(createRuntimeEntrypointConfigFromPath(primary))
  } else if (primary) {
    normalizedEntries.push(normalizeRuntimeEntrypointConfig(primary))
  }

  if (Array.isArray(entries)) {
    normalizedEntries.push(...entries.map((item) => {
      if (typeof item === 'string') return createRuntimeEntrypointConfigFromPath(item)
      return normalizeRuntimeEntrypointConfig(item)
    }))
  }

  if (Array.isArray(legacyHistory)) {
    normalizedEntries.push(...legacyHistory.map((item) => (
      typeof item === 'string' ? createRuntimeEntrypointConfigFromPath(item) : undefined
    )))
  }

  const deduped = dedupeRuntimeEntrypointConfigs(normalizedEntries)
  return deduped.length > 0 ? deduped : undefined
}

export function runtimeEntrypointConfigsToHistory(entries?: RuntimeEntrypointConfig[]): string[] | undefined {
  const history = Array.from(new Set(
    (entries ?? [])
      .map((entry) => composeRuntimeEntrypointConfig(entry))
      .map((item) => item.trim())
      .filter(Boolean),
  ))
  return history.length > 0 ? history : undefined
}

export function getRuntimeEntrypointTarget(
  config?: Pick<AiEnvironmentConfig, 'runtimeEntrypointConfig' | 'runtimeEntrypoint'>,
): RuntimeEntrypointTarget {
  const entrypointConfig = normalizeRuntimeEntrypointConfig(
    config?.runtimeEntrypointConfig,
    config?.runtimeEntrypoint,
  )
  return entrypointConfig?.target ?? 'native'
}

export function shouldUseWslForRuntimeEntrypoint(
  config?: Pick<AiEnvironmentConfig, 'runtimeEntrypointConfig' | 'runtimeEntrypoint'>,
): boolean {
  return getRuntimeEntrypointTarget(config) === 'wsl'
}
