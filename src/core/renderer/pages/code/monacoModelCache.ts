import type { editor as MonacoEditor } from 'monaco-editor'

// 模块级 Monaco Model 缓存：
// - 撤销栈挂在 Model 上，缓存提升到模块级后，编辑器卸载/重挂载不再丢失撤销历史。
// - 缓存 key 包含项目路径，避免不同项目的同名相对路径互相串用 Model。
// - 通过引用计数保护挂载中编辑器正在使用的 Model 不被 LRU 驱逐。
// - undo 栈随 model dispose 丢失，上限权衡常驻内存与撤销栈保留。
const MAX_CACHED_MODELS = 24

const MODULE_CACHE_INMEMORY_KEY = '__inmemory__'

type MonacoApi = typeof import('monaco-editor')

const moduleModelCache = new Map<string, MonacoEditor.ITextModel>()
const activeModelKeyCounts = new Map<string, number>()
// 模块级编辑器视图状态存档：key 与 model 缓存一致（projectPath::filePath）。
// 撤销栈在 model 上，视图状态在 editor 上；editor 随挂载 dispose 后光标/滚动/选区丢失，
// 此处按 key 存档，重挂载后 restore。仅本会话有效（刷新即失效），
// 与 ProjectCodeSession.cursorPositions 持久化机制分工见 06-monaco-编辑器-plan-detail.md §1.7。
const monacoViewStates = new Map<string, MonacoEditor.ICodeEditorViewState>()

export function saveMonacoViewState(key: string, state: MonacoEditor.ICodeEditorViewState | null): void {
  if (key === MODULE_CACHE_INMEMORY_KEY || !state) return
  monacoViewStates.set(key, state)
}

export function getMonacoViewState(key: string): MonacoEditor.ICodeEditorViewState | null {
  if (key === MODULE_CACHE_INMEMORY_KEY) return null
  return monacoViewStates.get(key) ?? null
}

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
    // 驱逐留痕：undo 栈随 model dispose 丢失，便于回归观察 LRU 行为。
    console.warn('[model-cache] evict+dispose', oldestKey)
    moduleModelCache.delete(oldestKey)
    oldestModel.dispose()
    monacoViewStates.delete(oldestKey)
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
