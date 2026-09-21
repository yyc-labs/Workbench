import type { editor as MonacoEditor } from 'monaco-editor'

// 模块级 Monaco Model 缓存：
// - 撤销栈挂在 Model 上，缓存提升到模块级后，编辑器卸载/重挂载不再丢失撤销历史。
// - 缓存 key 包含项目路径，避免不同项目的同名相对路径互相串用 Model。
// - 通过引用计数保护挂载中编辑器正在使用的 Model 不被 LRU 驱逐。
const MAX_CACHED_MODELS = 12

const MODULE_CACHE_INMEMORY_KEY = '__inmemory__'

type MonacoApi = typeof import('monaco-editor')

const moduleModelCache = new Map<string, MonacoEditor.ITextModel>()
const activeModelKeyCounts = new Map<string, number>()

export function normalizeMonacoCachePath(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\\/g, '/')
}

export function toMonacoModelCacheKey(projectPath: string | null | undefined, filePath: string | null | undefined): string {
  const normalizedFile = normalizeMonacoCachePath(filePath)
  if (!normalizedFile) return MODULE_CACHE_INMEMORY_KEY
  const normalizedProject = normalizeMonacoCachePath(projectPath)
  return normalizedProject ? `${normalizedProject}::${normalizedFile}` : normalizedFile
}

export function createMonacoModelUri(projectPath: string | null | undefined, filePath: string | null | undefined): string {
  const normalizedFile = normalizeMonacoCachePath(filePath).replace(/^\/+/, '')
  if (!normalizedFile) {
    return `inmemory://model/${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  }
  // WSL UNC 路径（\\wsl.localhost\...）规范化后会以 // 开头，必须剥掉前导斜杠，
  // 否则拼出的 file:// URI path 以 // 开头，触发 Monaco UriError。
  const normalizedProject = normalizeMonacoCachePath(projectPath).replace(/^\/+/, '').replace(/\/+$/, '')
  // URI 带上项目命名空间，保证跨项目同名文件也拥有唯一 Model URI。
  return normalizedProject ? `file:///${normalizedProject}/${normalizedFile}` : `file:///${normalizedFile}`
}

export interface MonacoModelLease {
  model: MonacoEditor.ITextModel
  /** false 表示无文件路径的临时模型，不入模块缓存，由调用方自行 dispose。 */
  cached: boolean
}

export function getOrCreateMonacoModel(monaco: MonacoApi, projectPath: string | null | undefined, filePath: string | null | undefined, value: string, language: string): MonacoModelLease {
  const key = toMonacoModelCacheKey(projectPath, filePath)
  if (key === MODULE_CACHE_INMEMORY_KEY) {
    const uri = monaco.Uri.parse(createMonacoModelUri(projectPath, filePath))
    return { model: monaco.editor.createModel(value, language, uri), cached: false }
  }

  const cachedModel = moduleModelCache.get(key)
  if (cachedModel) {
    if (!cachedModel.isDisposed()) {
      // LRU touch：移到末尾。
      moduleModelCache.delete(key)
      moduleModelCache.set(key, cachedModel)
      return { model: cachedModel, cached: true }
    }
    moduleModelCache.delete(key)
  }

  const uri = monaco.Uri.parse(createMonacoModelUri(projectPath, filePath))
  const existingModel = monaco.editor.getModel(uri)
  const model = existingModel ?? monaco.editor.createModel(value, language, uri)
  moduleModelCache.set(key, model)
  evictStaleMonacoModels(key)
  return { model, cached: true }
}

function evictStaleMonacoModels(activeKey: string): void {
  let rotateGuard = moduleModelCache.size
  while (moduleModelCache.size > MAX_CACHED_MODELS && rotateGuard > 0) {
    rotateGuard -= 1
    const oldestEntry = moduleModelCache.entries().next()
    if (oldestEntry.done) break
    const [oldestKey, oldestModel] = oldestEntry.value
    // 活跃 Model 跳过驱逐，移到末尾继续找更旧的未使用模型。
    if (oldestKey === activeKey || activeModelKeyCounts.has(oldestKey)) {
      moduleModelCache.delete(oldestKey)
      moduleModelCache.set(oldestKey, oldestModel)
      continue
    }
    moduleModelCache.delete(oldestKey)
    oldestModel.dispose()
  }
}

export function acquireMonacoModelCacheKey(key: string): void {
  if (key === MODULE_CACHE_INMEMORY_KEY) return
  activeModelKeyCounts.set(key, (activeModelKeyCounts.get(key) ?? 0) + 1)
}

export function releaseMonacoModelCacheKey(key: string): void {
  if (key === MODULE_CACHE_INMEMORY_KEY) return
  const nextCount = (activeModelKeyCounts.get(key) ?? 0) - 1
  if (nextCount <= 0) {
    activeModelKeyCounts.delete(key)
  } else {
    activeModelKeyCounts.set(key, nextCount)
  }
}
