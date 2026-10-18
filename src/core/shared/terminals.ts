import { parseRunTaskProcessKey } from './runTasks'

/**
 * 项目终端坞（code 工作区底部面板）的进程 key 解析与 tab 标题推导。
 *
 * 进程 key 约定（与主进程一致）：
 * - `<projectId>`：主 dev 进程（primary）
 * - `<projectId>::toolbox`：AI Commit 工具箱进程
 * - `<projectId>::run::<taskId>`：运行任务（scheduler 拥有生命周期）
 * - `<projectId>::script::<n>`：脚本终端
 * - `<projectId>::float::<n>`：交互 shell 浮动终端实例
 *
 * 本文件为纯函数，可被 renderer / main / 测试共用，不得引入 electron 或 store 依赖。
 */

export type TerminalProcessKind = 'primary' | 'run' | 'script' | 'float' | 'toolbox'

export interface ParsedTerminalProcessKey {
  /** 裸 projectId（script/float 的 processId 即完整 key，拆回裸 id） */
  projectId: string
  kind: TerminalProcessKind
  /** run: taskId；script/float: 序号（十进制字符串） */
  token?: string
}

/** 解析进程 key；无法识别返回 null。 */
export function parseTerminalProcessKey(processKey: string): ParsedTerminalProcessKey | null {
  if (!processKey) return null
  const markerIndex = processKey.indexOf('::')
  if (markerIndex < 0) {
    // 不含 `::` 的裸 projectId 即主进程 key。
    return { projectId: processKey, kind: 'primary' }
  }
  const projectId = processKey.slice(0, markerIndex)
  if (!projectId) return null
  const rest = processKey.slice(markerIndex + 2)
  if (rest === 'toolbox') return { projectId, kind: 'toolbox' }

  // run 分支复用 parseRunTaskProcessKey 的 taskId 语义，但拍平到顶层（避免两套类型）。
  const runParsed = parseRunTaskProcessKey(processKey)
  if (runParsed) {
    return { projectId: runParsed.projectId, kind: 'run', token: runParsed.taskId }
  }

  const scriptMatch = /^script::(\d+)$/.exec(rest)
  if (scriptMatch) return { projectId, kind: 'script', token: scriptMatch[1] }

  const floatMatch = /^float::(\d+)$/.exec(rest)
  if (floatMatch) return { projectId, kind: 'float', token: floatMatch[1] }

  return null
}

export interface TerminalTitleInput {
  kind: TerminalProcessKind
  /** 项目显示名（projectDisplayName）；无则 null */
  projectName: string | null
  /** run: 任务配置名 */
  taskName?: string | null
  /** run: taskId（任务配置缺失时的回落） */
  taskId?: string | null
  /** float: 实例 title（instance.title） */
  instanceTitle?: string | null
  /** 坞 titles 覆盖（D1：float 不使用） */
  override?: string | null
  /** 已本地化的序号名：脚本 #n / 终端 #n，由调用方注入 */
  ordinalLabel: string
}

/** 优先级：override → float 实例 title → run 任务名/taskId → 项目名 → 序号名。空串按缺失处理。 */
export function resolveTerminalTabTitle(input: TerminalTitleInput): string {
  const override = input.override?.trim()
  if (override) return override

  if (input.kind === 'float') {
    const instanceTitle = input.instanceTitle?.trim()
    if (instanceTitle) return instanceTitle
  }

  if (input.kind === 'run') {
    const taskName = input.taskName?.trim()
    if (taskName) return taskName
    const taskId = input.taskId?.trim()
    if (taskId) return taskId
  }

  const projectName = input.projectName?.trim()
  if (projectName && input.kind !== 'script') return projectName

  return input.ordinalLabel
}

/** lastOpened 降序；无 lastOpened 排最后；同值保持原数组稳定序。 */
export function sortProjectsByRecency<T extends { lastOpened?: number }>(projects: readonly T[]): T[] {
  const lastOpenedOf = (project: T): number => (typeof project.lastOpened === 'number' && Number.isFinite(project.lastOpened) ? project.lastOpened : Number.NEGATIVE_INFINITY)
  return [...projects].sort((a, b) => {
    const aLast = lastOpenedOf(a)
    const bLast = lastOpenedOf(b)
    if (aLast === bLast) return 0
    return aLast > bLast ? -1 : 1
  })
}

/** 名称/自定义名/路径不区分大小写包含匹配；空 query 返回 true。 */
export function matchProjectQuery(project: { name?: string; customName?: string; path: string }, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return true
  const name = project.name?.toLowerCase() ?? ''
  const customName = project.customName?.toLowerCase() ?? ''
  const path = project.path.toLowerCase()
  return name.includes(normalizedQuery) || customName.includes(normalizedQuery) || path.includes(normalizedQuery)
}
