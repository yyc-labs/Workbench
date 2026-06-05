import type { editor as MonacoEditor } from 'monaco-editor'

const MAX_CACHED_MODELS = 8

export function createMonacoModelUri(filePath: string | null): string {
  if (filePath && filePath.trim()) {
    const normalized = filePath.replace(/\\/g, '/')
    return `file:///${normalized.replace(/^\/+/, '')}`
  }
  return `inmemory://model/${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function toMonacoModelCacheKey(filePath: string | null): string {
  const normalized = filePath?.trim().replace(/\\/g, '/')
  return normalized && normalized.length > 0 ? normalized : '__inmemory__'
}

export function touchMonacoModelCacheEntry(
  cache: Map<string, MonacoEditor.ITextModel>,
  key: string,
  model: MonacoEditor.ITextModel
): void {
  if (cache.has(key)) {
    cache.delete(key)
  }
  cache.set(key, model)
}

export function evictStaleMonacoModels(
  cache: Map<string, MonacoEditor.ITextModel>,
  activeKey: string
): void {
  while (cache.size > MAX_CACHED_MODELS) {
    const oldestEntry = cache.entries().next()
    if (oldestEntry.done) break
    const [oldestKey, oldestModel] = oldestEntry.value
    if (oldestKey === activeKey) {
      cache.delete(oldestKey)
      cache.set(oldestKey, oldestModel)
      continue
    }
    cache.delete(oldestKey)
    oldestModel.dispose()
  }
}
