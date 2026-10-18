import type { ManagedProcessSnapshot, ProjectInfo } from '../../shared/types'
import type { RunTaskConfigFile, RunTaskProgressEvent } from '../../shared/runTasks'
import { parseTerminalProcessKey, resolveTerminalTabTitle, sortProjectsByRecency, type TerminalProcessKind } from '../../shared/terminals'

/**
 * 终端集合面板（Ctrl+J）数据聚合：把主进程进程清单按项目分组为「项目 tab + 项目内终端」两级模型。
 *
 * 纯函数：不依赖 store / electron，输入全部由调用方（Layer/组件）注入，便于单测。
 * 进程 key 约定见 shared/terminals.ts（primary / run / script / float / toolbox）。
 */

/** 与 store.processes 状态条目一致的最小结构。 */
export interface CollectionProcessStatus {
  status?: string
}

export interface CollectionTerminalItem {
  processKey: string
  kind: TerminalProcessKind
  title: string
  /** 归一化状态：running / ready / stopped / failed / starting 等，直接驱动状态点。 */
  status: string
  /** run 任务的 dev url（有则列表提示）。 */
  url?: string
  /** run 任务的警告文案（有则列表提示）。 */
  warning?: string
}

export interface CollectionProjectGroup {
  projectId: string
  /** 项目显示名；项目已从列表删除时回落进程 key。 */
  projectName: string
  /** 当前路由项目（项目内 Ctrl+J 的聚焦目标）。 */
  isRouteProject: boolean
  /** 该项目运行中的终端数。 */
  runningCount: number
  terminals: CollectionTerminalItem[]
}

export interface TerminalCollectionModel {
  groups: CollectionProjectGroup[]
  /** 建议激活的项目 tab：路由项目优先，否则第一个分组。 */
  activeProjectId: string | null
}

export interface BuildTerminalCollectionModelInput {
  /** 主进程进程清单（terminal:list-all）。 */
  inventory: readonly ManagedProcessSnapshot[]
  projects: readonly ProjectInfo[]
  /** 当前路由项目 id（/project/:projectId），无则 undefined。 */
  routeProjectId?: string
  /** 是否展示 ::toolbox 进程（默认隐藏）。 */
  showToolbox?: boolean
  /** store.processes 状态表。 */
  processes?: Record<string, CollectionProcessStatus>
  /** run 任务进度表：projectId → taskId → state。 */
  runTaskStates?: Record<string, Record<string, RunTaskProgressEvent['tasks'][string]>>
  /** run 任务配置表：projectId → config。 */
  runTaskConfigs?: Record<string, RunTaskConfigFile | null>
  /** 用户自定义 title 覆盖表：projectId → processKey → title。 */
  titles?: Record<string, Record<string, string>>
  /** 序号兜底名本地化注入（script/float 无覆盖 title 时使用）；缺省用中文默认值。 */
  ordinalLabels?: { script?: (token: string) => string; terminal?: (token: string) => string }
  /** 启动中乐观占位（主进程清单尚未收录的 `::float::` 终端），合并为 starting 状态项。 */
  pendingTerminals?: readonly { processKey: string; projectId: string; title: string }[]
}

function isRunningStatus(status: string): boolean {
  return status === 'running' || status === 'ready' || status === 'stopping'
}

/** 坞内一致的 kind 排序：run → primary → float → script → toolbox。 */
const KIND_ORDER: Record<TerminalProcessKind, number> = {
  run: 0,
  primary: 1,
  float: 2,
  script: 3,
  toolbox: 4,
}

export function buildTerminalCollectionModel(input: BuildTerminalCollectionModelInput): TerminalCollectionModel {
  const showToolbox = input.showToolbox === true
  const projectsById = new Map(input.projects.map((project) => [project.id, project]))

  // 1) 进程清单按项目分组（解析失败的 key 丢弃；toolbox 按过滤器）。
  const grouped = new Map<string, ManagedProcessSnapshot[]>()
  for (const snapshot of input.inventory) {
    const parsed = parseTerminalProcessKey(snapshot.processId)
    if (!parsed) continue
    if (parsed.kind === 'toolbox' && !showToolbox) continue
    const bucket = grouped.get(parsed.projectId)
    if (bucket) bucket.push(snapshot)
    else grouped.set(parsed.projectId, [snapshot])
  }

  // 2) 项目 tab 集合 = 有终端的项目 + 路由项目（无终端也显示，空态引导新建）+ 启动中占位项目。
  const projectIds = new Set<string>(grouped.keys())
  if (input.routeProjectId) projectIds.add(input.routeProjectId)
  const pendingByProject = new Map<string, { processKey: string; projectId: string; title: string }[]>()
  for (const pending of input.pendingTerminals ?? []) {
    // 清单已收录（轮询追上但 store 尚未清理）时不重复占位。
    if (grouped.get(pending.projectId)?.some((snapshot) => snapshot.processId === pending.processKey)) continue
    const bucket = pendingByProject.get(pending.projectId)
    if (bucket) bucket.push(pending)
    else pendingByProject.set(pending.projectId, [pending])
    projectIds.add(pending.projectId)
  }

  const groups: CollectionProjectGroup[] = []
  for (const projectId of projectIds) {
    const project = projectsById.get(projectId)
    const snapshots = grouped.get(projectId) ?? []
    const processes = input.processes ?? {}
    const taskStates = input.runTaskStates?.[projectId] ?? {}
    const taskConfigs = input.runTaskConfigs?.[projectId]?.tasks ?? []
    const titles = input.titles?.[projectId] ?? {}
    const projectName = project?.customName?.trim() || project?.name?.trim() || projectId

    const terminals: CollectionTerminalItem[] = snapshots
      .map((snapshot) => {
        const parsed = parseTerminalProcessKey(snapshot.processId)
        // 分组时已解析成功，这里理论上非空。
        if (!parsed) return null
        const kind = parsed.kind
        const token = parsed.token ?? '1'
        const ordinalLabel = kind === 'script' ? (input.ordinalLabels?.script ?? ((n: string) => `脚本 #${n}`))(token) : (input.ordinalLabels?.terminal ?? ((n: string) => `终端 #${n}`))(token)
        const taskConfig = kind === 'run' && parsed.token ? taskConfigs.find((task) => task.id === parsed.token) : undefined
        const taskState = kind === 'run' && parsed.token ? taskStates[parsed.token] : undefined
        const title = resolveTerminalTabTitle({
          kind,
          projectName,
          taskName: taskConfig?.name ?? null,
          taskId: parsed.token ?? null,
          override: titles[snapshot.processId] ?? null,
          ordinalLabel,
        })
        const status = kind === 'run' ? (taskState?.state ?? 'stopped') : (processes[snapshot.processId]?.status ?? 'running')
        return {
          processKey: snapshot.processId,
          kind,
          title,
          status,
          ...(taskState?.url ? { url: taskState.url } : {}),
          ...(taskState?.warning ? { warning: taskState.warning } : {}),
        }
      })
      .filter((item): item is CollectionTerminalItem => item !== null)
      .sort((a, b) => {
        const kindDiff = KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
        if (kindDiff !== 0) return kindDiff
        const aStart = snapshots.find((snapshot) => snapshot.processId === a.processKey)?.startTime ?? Number.MAX_SAFE_INTEGER
        const bStart = snapshots.find((snapshot) => snapshot.processId === b.processKey)?.startTime ?? Number.MAX_SAFE_INTEGER
        return aStart - bStart
      })

    // 启动中占位排在该组末尾（最新创建）。
    const pendingItems: CollectionTerminalItem[] = (pendingByProject.get(projectId) ?? []).map((pending) => ({
      processKey: pending.processKey,
      kind: 'float' as const,
      title: pending.title,
      status: 'starting',
    }))
    const allTerminals = [...terminals, ...pendingItems]

    groups.push({
      projectId,
      projectName,
      isRouteProject: projectId === input.routeProjectId,
      runningCount: allTerminals.filter((terminal) => isRunningStatus(terminal.status)).length,
      terminals: allTerminals,
    })
  }

  // 3) 排序：路由项目置顶，其余按最近打开降序（无 lastOpened 排最后，稳定序）。
  const byRecency = new Map(sortProjectsByRecency(input.projects).map((project, index) => [project.id, index]))
  groups.sort((a, b) => {
    if (a.isRouteProject !== b.isRouteProject) return a.isRouteProject ? -1 : 1
    const aRecency = byRecency.get(a.projectId) ?? Number.MAX_SAFE_INTEGER
    const bRecency = byRecency.get(b.projectId) ?? Number.MAX_SAFE_INTEGER
    return aRecency - bRecency
  })

  // 4) 同名终端（同项目多 float / primary 与 float 同名）附加序号区分。
  for (const group of groups) {
    const seen = new Map<string, number>()
    for (const terminal of group.terminals) {
      const count = (seen.get(terminal.title) ?? 0) + 1
      seen.set(terminal.title, count)
      if (count > 1) terminal.title = `${terminal.title} ${count}`
    }
  }

  const routeGroup = groups.find((group) => group.isRouteProject)
  const activeProjectId = routeGroup?.projectId ?? groups[0]?.projectId ?? null

  return { groups, activeProjectId }
}
