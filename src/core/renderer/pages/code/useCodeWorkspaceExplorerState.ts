import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { normalizeRememberedDirectories } from '../../../shared/rememberedDirectories'
import type { ProjectFileContentSearchResponse, ProjectFileNode, ProjectFileNodeKind } from '../../../shared/types'
import { contentSearchScopeKey, parseContentSearchScopeGlobs } from './code.contentSearchScope'
import { canRestoreChild, collectDescendantPaths, collectEffectivelyExpanded, collectRememberedChildrenOf, collectRestorableExpanded, isRestoreParentActive, mergeRememberedInit } from './code.expandedDirectories'
import { collectParentDirectories } from './code.helpers'
import { collectTopLevelDirectories, expandTreePath, findDirectoryNode, mergeKnownFilePaths, replaceDirectoryNodes, sortProjectNodes } from './code.tree'
import { type DirectoryLoadReason, type RootLoadReason, shouldRefreshLoadedDirectory, shouldRefreshRootOnSidebarReveal } from './code.treeRefresh'
import type { FileSearchLineTarget, FileTreeState } from './code.types'

export type ContentSearchScopePreset = {
  id: string
  label: string
  hint: string
  scopeInput: string
  title: string
}

const CONTENT_SEARCH_ROOT_SCOPE_CANDIDATES = ['src', 'app', 'packages', 'docs', 'test', 'tests', 'spec', 'scripts']
// 文件搜索行号后缀：`path:2032` 或 `path:2032-2087`，冒号前必须有非空路径。
const FILE_SEARCH_LINE_TARGET_RE = /^(.+):(\d+)(?:-(\d+))?$/

export function parseFileSearchLineTarget(query: string): { lineTarget: FileSearchLineTarget | null; searchQuery: string } {
  const normalized = query.trim()
  const match = FILE_SEARCH_LINE_TARGET_RE.exec(normalized)
  if (!match) return { lineTarget: null, searchQuery: normalized }

  const startLine = Number.parseInt(match[2], 10)
  const endLine = match[3] ? Number.parseInt(match[3], 10) : startLine
  if (!Number.isFinite(startLine) || startLine < 1) return { lineTarget: null, searchQuery: normalized }
  return {
    lineTarget: { startLine: Math.min(startLine, endLine), endLine: Math.max(startLine, endLine) },
    searchQuery: match[1].trim(),
  }
}
const CONTENT_SEARCH_ROOT_SCOPE_LABELS: Record<string, string> = {
  src: 'Source',
  app: 'App',
  packages: 'Packages',
  docs: 'Docs',
  test: 'Tests',
  tests: 'Tests',
  spec: 'Specs',
  scripts: 'Scripts',
}

type LoadTreeOptions = {
  reason?: RootLoadReason
}

type LoadDirectoryOptions = {
  force?: boolean
  reason?: DirectoryLoadReason
  suppressError?: boolean
}

function directoryFromRelativePath(relativePath: string | null | undefined): string {
  const normalized = (relativePath ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (!normalized) return ''
  const index = normalized.lastIndexOf('/')
  if (index <= 0) return ''
  return normalized.slice(0, index)
}

function fileNameFromRelativePath(relativePath: string | null | undefined): string {
  const normalized = (relativePath ?? '').replace(/\\/g, '/')
  const segments = normalized.split('/')
  return segments[segments.length - 1] || normalized
}

function extensionFromRelativePath(relativePath: string | null | undefined): string {
  const fileName = fileNameFromRelativePath(relativePath)
  const dotIndex = fileName.lastIndexOf('.')
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) return ''
  return fileName.slice(dotIndex + 1).toLowerCase()
}

function expandParentDirectories(previous: Set<string>, relativePath: string): Set<string> {
  const next = new Set(previous)
  let changed = false
  for (const parent of collectParentDirectories(relativePath)) {
    if (next.has(parent)) continue
    next.add(parent)
    changed = true
  }
  return changed ? next : previous
}

function directoryRefreshDepth(relativePath: string): number {
  return relativePath.split('/').filter(Boolean).length
}

function sortDirectoryPathsForRefresh(paths: Iterable<string>): string[] {
  return Array.from(new Set(paths))
    .map((item) => item.trim())
    .filter(Boolean)
    .sort((left, right) => directoryRefreshDepth(left) - directoryRefreshDepth(right) || left.localeCompare(right))
}

type UseCodeWorkspaceExplorerStateOptions = {
  activePane: 'code' | 'aicommit'
  activeRelativePath: string | null
  contentSearchScopeInput: string
  projectPath: string
  /** 设置页可配置的文件树自动加载上限；变化时解除既有 block 并重新决策。 */
  treeAutoLoadFileLimit?: number
  treeAutoLoadPaused?: boolean
  /**
   * Store 中的 remembered 展开集合（project.codeSession.expandedDirectories）。
   * 仅作 hook 初值来源：快照缺失时回退 store（D30 三态），之后 state 为权威。
   */
  rememberedDirectories?: string[]
  /** 持久化 remembered 集合（经 setProjectCodeSession → 主进程协调器统一防抖落盘） */
  onPersistRememberedDirectories?: (paths: string[]) => void
}

type TreeSnapshot = {
  nodes: ProjectFileNode[]
  /** 只存 remembered（D25）：存 active 会用陈旧 active 覆盖 Store 完整 remembered */
  rememberedDirectories: Set<string>
  lastRootLoadedAtMs: number | null
  savedAtMs: number
}

// 同会话内的树快照（仅内存，不落盘）：转录页等路由往返会整棵重挂载 CodeWorkspacePanel，
// 树状态全部归零；快照让返回时即时呈现上次的树，而不是重新走 rg 决策空窗。
// 新鲜度由 refreshRootIfStale（sidebar reveal 15s TTL）与手动刷新兜底。
const TREE_SNAPSHOT_TTL_MS = 5 * 60_000
const TREE_SNAPSHOT_CACHE_LIMIT = 8
const treeSnapshotCacheByProjectPath = new Map<string, TreeSnapshot>()

function readTreeSnapshot(projectPath: string): TreeSnapshot | null {
  const snapshot = treeSnapshotCacheByProjectPath.get(projectPath)
  if (!snapshot) return null
  if (Date.now() - snapshot.savedAtMs > TREE_SNAPSHOT_TTL_MS) {
    treeSnapshotCacheByProjectPath.delete(projectPath)
    return null
  }
  return snapshot
}

function saveTreeSnapshot(projectPath: string, snapshot: TreeSnapshot): void {
  if (treeSnapshotCacheByProjectPath.has(projectPath)) {
    treeSnapshotCacheByProjectPath.delete(projectPath)
  }
  treeSnapshotCacheByProjectPath.set(projectPath, snapshot)
  while (treeSnapshotCacheByProjectPath.size > TREE_SNAPSHOT_CACHE_LIMIT) {
    const oldestKey = treeSnapshotCacheByProjectPath.keys().next().value
    if (oldestKey === undefined) break
    treeSnapshotCacheByProjectPath.delete(oldestKey)
  }
}

function createInitialTreeState(projectPath: string): FileTreeState {
  const snapshot = readTreeSnapshot(projectPath)
  if (snapshot && snapshot.nodes.length > 0) {
    return {
      status: 'ready',
      nodes: snapshot.nodes,
      error: null,
      knownFilePaths: mergeKnownFilePaths(new Set(), snapshot.nodes),
      loadingDirectories: new Set(),
      isRefreshingRoot: false,
      lastRootLoadedAtMs: snapshot.lastRootLoadedAtMs,
      lastRootRefreshStartedAtMs: null,
      autoLoadBlocked: false,
      autoLoadFileCountSample: 0,
      autoLoadLimit: 0,
    }
  }
  return {
    status: 'idle',
    nodes: [],
    error: null,
    knownFilePaths: new Set(),
    loadingDirectories: new Set(),
    isRefreshingRoot: false,
    lastRootLoadedAtMs: null,
    lastRootRefreshStartedAtMs: null,
    autoLoadBlocked: false,
    autoLoadFileCountSample: 0,
    autoLoadLimit: 0,
  }
}

export function useCodeWorkspaceExplorerState({ activePane, activeRelativePath, contentSearchScopeInput, projectPath, treeAutoLoadFileLimit, treeAutoLoadPaused = false, rememberedDirectories: rememberedDirectoriesProp, onPersistRememberedDirectories }: UseCodeWorkspaceExplorerStateOptions) {
  const [tree, setTree] = useState<FileTreeState>(() => createInitialTreeState(projectPath))
  // remembered 初始化三态（D30）：快照字段缺失才回退 store；明确为空则空即权威；非法条目逐条剔除。
  const initialRememberedDirectories = mergeRememberedInit(readTreeSnapshot(projectPath)?.rememberedDirectories, rememberedDirectoriesProp)
  const [rememberedDirectories, setRememberedDirectories] = useState<Set<string>>(() => new Set(initialRememberedDirectories ?? []))
  // active 初值 = collectRestorableExpanded(remembered)（D20/D25 + 顶层断裂兜底）：
  // 快照不存 active，remount 时重新派生。
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(() => new Set(collectRestorableExpanded(new Set(initialRememberedDirectories ?? []))))
  const [fileSearchQuery, setFileSearchQuery] = useState('')
  const [searchResultNodes, setSearchResultNodes] = useState<ProjectFileNode[]>([])
  const [fileSearchRefreshRequest, setFileSearchRefreshRequest] = useState(0)
  const [isSearchingFiles, setIsSearchingFiles] = useState(false)
  const [fileSearchError, setFileSearchError] = useState<string | null>(null)
  const [contentSearchQuery, setContentSearchQuery] = useState('')
  const [contentSearchCaseSensitive, setContentSearchCaseSensitive] = useState(false)
  const [isContentSearchAdvancedOpen, setIsContentSearchAdvancedOpen] = useState(false)
  const [contentSearchResult, setContentSearchResult] = useState<ProjectFileContentSearchResponse>({
    files: [],
    totalMatches: 0,
    limited: false,
  })
  const [expandedDirectoryRefreshRequest, setExpandedDirectoryRefreshRequest] = useState(0)
  const [isSearchingContent, setIsSearchingContent] = useState(false)
  const [contentSearchError, setContentSearchError] = useState<string | null>(null)

  const treeLoadRequestSeqRef = useRef(0)
  const searchRequestSeqRef = useRef(0)
  const contentSearchRequestSeqRef = useRef(0)
  const treeStateRef = useRef<FileTreeState>(tree)
  const treeNodesRef = useRef<ProjectFileNode[]>([])
  const expandedDirectoriesRef = useRef<Set<string>>(new Set())
  const rememberedDirectoriesRef = useRef<Set<string>>(new Set(initialRememberedDirectories ?? []))
  /** 文件 reveal 的临时展开（仅运行时，不持久化、不触发记忆恢复；折叠/刷新/项目切换时清除） */
  const temporaryRevealRef = useRef<Set<string>>(new Set())
  const pendingExpandedDirectoryRefreshRef = useRef<string[]>([])
  const directoryLoadGenerationRef = useRef(0)
  const directoryLoadPromisesRef = useRef<Map<string, Promise<boolean>>>(new Map())
  const directoryLoadedAtMsRef = useRef<Map<string, number>>(new Map())

  treeStateRef.current = tree

  useEffect(() => {
    treeNodesRef.current = tree.nodes
  }, [tree.nodes])

  useEffect(() => {
    expandedDirectoriesRef.current = expandedDirectories
  }, [expandedDirectories])

  useEffect(() => {
    rememberedDirectoriesRef.current = rememberedDirectories
  }, [rememberedDirectories])

  // active 统一提交入口：setState 与 ref 同步，保证恢复链在同一异步任务内读到最新 active（D26/D31）。
  const commitExpandedDirectories = useCallback((next: Set<string>) => {
    expandedDirectoriesRef.current = next
    setExpandedDirectories(next)
  }, [])

  // remembered 持久化提交：归一化后经 store action 交主进程协调器（本期不新建 renderer 定时器）。
  const persistRememberedDirectories = useCallback(
    (next: Set<string>) => {
      onPersistRememberedDirectories?.(normalizeRememberedDirectories(Array.from(next)) ?? [])
    },
    [onPersistRememberedDirectories],
  )

  const loadDirectory = useCallback(
    async (directoryRelativePath: string | null, options: LoadDirectoryOptions = {}): Promise<boolean> => {
      const loadingKey = directoryRelativePath ?? ''
      const reason = options.reason ?? 'initial-open'
      if (directoryRelativePath) {
        const targetNode = findDirectoryNode(treeNodesRef.current, directoryRelativePath)
        const shouldRefresh = shouldRefreshLoadedDirectory({
          force: options.force,
          isLoaded: Boolean(targetNode?.isLoaded),
          lastLoadedAtMs: directoryLoadedAtMsRef.current.get(loadingKey) ?? null,
          reason,
        })
        if (!shouldRefresh) return true
      }

      const existingLoad = directoryLoadPromisesRef.current.get(loadingKey)
      if (existingLoad) return existingLoad

      const loadGeneration = directoryLoadGenerationRef.current
      const loadPromise = (async () => {
        setTree((prev) => {
          if (directoryRelativePath) {
            const targetNode = findDirectoryNode(prev.nodes, directoryRelativePath)
            const shouldRefresh = shouldRefreshLoadedDirectory({
              force: options.force,
              isLoaded: Boolean(targetNode?.isLoaded),
              lastLoadedAtMs: directoryLoadedAtMsRef.current.get(loadingKey) ?? null,
              reason,
            })
            if (!shouldRefresh) return prev
          }
          if (prev.loadingDirectories.has(loadingKey)) return prev
          const nextLoadingDirectories = new Set(prev.loadingDirectories)
          nextLoadingDirectories.add(loadingKey)
          return {
            ...prev,
            loadingDirectories: nextLoadingDirectories,
          }
        })

        try {
          const result = await window.electronAPI.listProjectDirectoryFiles(projectPath, directoryRelativePath)
          const sortedNodes = sortProjectNodes(result.nodes)
          if (directoryLoadGenerationRef.current !== loadGeneration) return false
          directoryLoadedAtMsRef.current.set(loadingKey, Date.now())
          setTree((prev) => {
            const nextLoadingDirectories = new Set(prev.loadingDirectories)
            nextLoadingDirectories.delete(loadingKey)
            const nodes = replaceDirectoryNodes(prev.nodes, result.directoryRelativePath, sortedNodes)
            return {
              ...prev,
              status: 'ready',
              nodes,
              error: null,
              knownFilePaths: mergeKnownFilePaths(prev.knownFilePaths, nodes),
              loadingDirectories: nextLoadingDirectories,
              autoLoadBlocked: false,
            }
          })
          return true
        } catch (error) {
          if (directoryLoadGenerationRef.current !== loadGeneration) return false
          setTree((prev) => {
            const nextLoadingDirectories = new Set(prev.loadingDirectories)
            nextLoadingDirectories.delete(loadingKey)
            if (options.suppressError) {
              return {
                ...prev,
                loadingDirectories: nextLoadingDirectories,
              }
            }
            return {
              ...prev,
              status: prev.nodes.length > 0 ? 'ready' : 'error',
              error: error instanceof Error ? error.message : String(error),
              loadingDirectories: nextLoadingDirectories,
            }
          })
          return false
        }
      })()

      directoryLoadPromisesRef.current.set(loadingKey, loadPromise)
      try {
        return await loadPromise
      } finally {
        if (directoryLoadPromisesRef.current.get(loadingKey) === loadPromise) {
          directoryLoadPromisesRef.current.delete(loadingKey)
        }
      }
    },
    [projectPath],
  )

  /**
   * 逐级恢复（D20/D26/D31）：从 parentPath 的 remembered 直接子出发，
   * 代次匹配 + 父仍 active + 子在 remembered 三者皆真才展开并加载，加载完成再递归下一级。
   * 代次过期（项目切换/手动刷新 bump）或父被用户折叠 → 停该分支；
   * 目录不存在/被排除 → loadDirectory(suppressError) 静默跳过，不写回清理（D23）。
   */
  const restoreReachableChildren = useCallback(
    async (parentPath: string): Promise<void> => {
      if (!isRestoreParentActive(parentPath, expandedDirectoriesRef.current)) return
      const generation = directoryLoadGenerationRef.current
      // 恢复种子：remembered 直接子 + 顶层断裂兜底补全的祖先（存量数据中这些路径不在
      // remembered 但 active 已展开，不加载就无法继续往下恢复记忆后代）。
      const restorableSet = new Set(collectRestorableExpanded(rememberedDirectoriesRef.current))
      const patchedAncestors = new Set(Array.from(restorableSet).filter((path) => !rememberedDirectoriesRef.current.has(path)))
      const children = Array.from(new Set([...collectRememberedChildrenOf(parentPath, rememberedDirectoriesRef.current), ...collectRememberedChildrenOf(parentPath, patchedAncestors)])).sort((left, right) => left.localeCompare(right))
      for (const childPath of children) {
        const decision = canRestoreChild({
          generationMatch: directoryLoadGenerationRef.current === generation,
          parentActive: isRestoreParentActive(parentPath, expandedDirectoriesRef.current),
          childInRemembered: rememberedDirectoriesRef.current.has(childPath) || patchedAncestors.has(childPath),
        })
        if (!decision) {
          if (directoryLoadGenerationRef.current !== generation) return
          if (!isRestoreParentActive(parentPath, expandedDirectoriesRef.current)) return
          continue
        }
        commitExpandedDirectories(new Set(expandedDirectoriesRef.current).add(childPath))
        const loaded = await loadDirectory(childPath, { suppressError: true })
        if (!loaded) continue
        await restoreReachableChildren(childPath)
      }
    },
    [commitExpandedDirectories, loadDirectory],
  )

  /**
   * 用户点击展开/折叠（§7.3 三职责之一）：
   * - expand：remembered.add（reveal 转正：temporaryReveal 丢弃该路径）；active.add + 加载；
   *   加载完成 → restoreReachableChildren 带出记忆后代。
   * - collapse：remembered 只删父条目（后代记忆保留）；active 去掉该路径及全部后代；
   *   temporaryReveal 同样清理；提交持久化。
   */
  const toggleDirectory = useCallback(
    async (relativePath: string) => {
      const path = relativePath.trim()
      if (!path) return
      const rememberedNow = rememberedDirectoriesRef.current
      if (expandedDirectoriesRef.current.has(path)) {
        if (rememberedNow.has(path)) {
          const nextRemembered = new Set(rememberedNow)
          nextRemembered.delete(path)
          rememberedDirectoriesRef.current = nextRemembered
          setRememberedDirectories(nextRemembered)
          persistRememberedDirectories(nextRemembered)
        }
        const nextActive = new Set(expandedDirectoriesRef.current)
        nextActive.delete(path)
        for (const descendant of collectDescendantPaths(path, expandedDirectoriesRef.current)) {
          nextActive.delete(descendant)
        }
        commitExpandedDirectories(nextActive)
        temporaryRevealRef.current.delete(path)
        for (const descendant of collectDescendantPaths(path, temporaryRevealRef.current)) {
          temporaryRevealRef.current.delete(descendant)
        }
        return
      }

      const nextRemembered = new Set(rememberedNow)
      nextRemembered.add(path)
      // 父级约束可达性：path 的祖先若因 reveal 临时展开（active 中但未记忆），
      // 随本次展开一并转正——否则恢复时 effectivelyExpanded 会因顶层祖先缺失整体失效。
      for (const ancestor of collectParentDirectories(path)) {
        if (expandedDirectoriesRef.current.has(ancestor)) nextRemembered.add(ancestor)
      }
      rememberedDirectoriesRef.current = nextRemembered
      setRememberedDirectories(nextRemembered)
      persistRememberedDirectories(nextRemembered)
      temporaryRevealRef.current.delete(path)
      commitExpandedDirectories(new Set(expandedDirectoriesRef.current).add(path))
      const loaded = await loadDirectory(path)
      if (loaded) {
        await restoreReachableChildren(path)
      }
    },
    [commitExpandedDirectories, loadDirectory, persistRememberedDirectories, restoreReachableChildren],
  )

  const loadTree = useCallback(
    async (_options: LoadTreeOptions = {}) => {
      const reason = _options.reason ?? 'initial-load'
      const isManualRefresh = reason === 'manual-refresh'
      const requestSeq = treeLoadRequestSeqRef.current + 1
      treeLoadRequestSeqRef.current = requestSeq
      const refreshStartedAtMs = Date.now()
      const currentTree = treeStateRef.current
      const hasLoadedRoot = currentTree.status === 'ready' || currentTree.lastRootLoadedAtMs != null
      const shouldResetDirectoryLoads = !hasLoadedRoot || isManualRefresh
      // 手动刷新重放集合从 remembered 有效展开收集（D29 方案 A），不再收集 active（含 temporaryReveal）。
      const expandedDirectoriesToRefresh = isManualRefresh ? sortDirectoryPathsForRefresh(collectRestorableExpanded(rememberedDirectoriesRef.current)) : []

      if (shouldResetDirectoryLoads) {
        directoryLoadGenerationRef.current += 1
        directoryLoadPromisesRef.current.clear()
        directoryLoadedAtMsRef.current.clear()
      }

      setTree((prev) => {
        if (hasLoadedRoot) {
          return {
            ...prev,
            error: null,
            loadingDirectories: shouldResetDirectoryLoads ? new Set() : new Set(prev.loadingDirectories),
            isRefreshingRoot: true,
            lastRootRefreshStartedAtMs: refreshStartedAtMs,
          }
        }

        return {
          status: 'loading',
          nodes: [],
          error: null,
          knownFilePaths: new Set(),
          loadingDirectories: new Set(),
          isRefreshingRoot: true,
          lastRootLoadedAtMs: null,
          lastRootRefreshStartedAtMs: refreshStartedAtMs,
          autoLoadBlocked: false,
          autoLoadFileCountSample: 0,
          autoLoadLimit: 0,
        }
      })
      if (!hasLoadedRoot) {
        commitExpandedDirectories(new Set())
      }
      if (isManualRefresh) {
        // 方案 A（D29）：刷新 = 清空临时展开 + active 重置为 remembered 有效展开，
        // 由下方 pendingExpandedDirectoryRefreshRef 重放链路逐级加载。
        temporaryRevealRef.current.clear()
        commitExpandedDirectories(new Set(collectRestorableExpanded(rememberedDirectoriesRef.current)))
      }
      setFileSearchError(null)

      try {
        const result = await window.electronAPI.listProjectFiles(projectPath, isManualRefresh ? { invalidateCache: true } : undefined)
        const sortedNodes = sortProjectNodes(result.nodes)
        if (treeLoadRequestSeqRef.current !== requestSeq) return
        const loadedAtMs = Date.now()
        setTree((prev) => {
          const mergedNodes = replaceDirectoryNodes(prev.nodes, null, sortedNodes, {
            preserveLoadedDescendants: !isManualRefresh,
          })
          return {
            ...prev,
            status: 'ready',
            nodes: mergedNodes,
            error: null,
            knownFilePaths: mergeKnownFilePaths(new Set(), mergedNodes),
            loadingDirectories: hasLoadedRoot && !shouldResetDirectoryLoads ? new Set(prev.loadingDirectories) : new Set(),
            isRefreshingRoot: false,
            lastRootLoadedAtMs: loadedAtMs,
            lastRootRefreshStartedAtMs: refreshStartedAtMs,
            autoLoadBlocked: false,
          }
        })
        if (isManualRefresh && expandedDirectoriesToRefresh.length > 0) {
          pendingExpandedDirectoryRefreshRef.current = expandedDirectoriesToRefresh
          setExpandedDirectoryRefreshRequest((prev) => prev + 1)
        }
        if (isManualRefresh) {
          setFileSearchRefreshRequest((prev) => prev + 1)
        } else {
          // 初始加载（含项目切换后首次加载）完成：从根执行 remembered 恢复（D31 根节点父级恒真）。
          void restoreReachableChildren('')
        }
      } catch (error) {
        if (treeLoadRequestSeqRef.current !== requestSeq) return
        setTree((prev) => {
          if (prev.nodes.length > 0) {
            return {
              ...prev,
              status: 'ready',
              error: error instanceof Error ? error.message : String(error),
              loadingDirectories: hasLoadedRoot && !shouldResetDirectoryLoads ? new Set(prev.loadingDirectories) : new Set(),
              isRefreshingRoot: false,
              lastRootRefreshStartedAtMs: refreshStartedAtMs,
            }
          }

          return {
            status: 'error',
            nodes: [],
            error: error instanceof Error ? error.message : String(error),
            knownFilePaths: new Set(),
            loadingDirectories: new Set(),
            isRefreshingRoot: false,
            lastRootLoadedAtMs: null,
            lastRootRefreshStartedAtMs: refreshStartedAtMs,
            autoLoadBlocked: false,
            autoLoadFileCountSample: 0,
            autoLoadLimit: 0,
          }
        })
        if (!hasLoadedRoot) {
          setSearchResultNodes([])
        }
      }
    },
    [commitExpandedDirectories, projectPath, restoreReachableChildren],
  )

  useEffect(() => {
    if (expandedDirectoryRefreshRequest <= 0) return
    if (tree.status !== 'ready' || tree.isRefreshingRoot) return

    const directoriesToRefresh = pendingExpandedDirectoryRefreshRef.current
    if (directoriesToRefresh.length <= 0) return

    let cancelled = false
    void (async () => {
      for (const directoryRelativePath of directoriesToRefresh) {
        if (cancelled) return
        if (!expandedDirectoriesRef.current.has(directoryRelativePath)) continue
        await loadDirectory(directoryRelativePath, {
          force: true,
          reason: 'manual-refresh',
          suppressError: true,
        })
      }

      if (!cancelled && pendingExpandedDirectoryRefreshRef.current === directoriesToRefresh) {
        pendingExpandedDirectoryRefreshRef.current = []
      }
    })()

    return () => {
      cancelled = true
    }
  }, [expandedDirectoryRefreshRequest, loadDirectory, tree.isRefreshingRoot, tree.status])

  const refreshRootIfStale = useCallback(() => {
    if (
      !shouldRefreshRootOnSidebarReveal({
        autoLoadBlocked: tree.autoLoadBlocked,
        hasLoadedRoot: tree.status === 'ready' || tree.lastRootLoadedAtMs != null,
        isRefreshingRoot: tree.isRefreshingRoot,
        lastRootLoadedAtMs: tree.lastRootLoadedAtMs,
        lastRootRefreshStartedAtMs: tree.lastRootRefreshStartedAtMs,
      })
    ) {
      return
    }

    void loadTree({ reason: 'sidebar-reveal' })
  }, [loadTree, tree.autoLoadBlocked, tree.isRefreshingRoot, tree.lastRootLoadedAtMs, tree.lastRootRefreshStartedAtMs, tree.nodes.length])

  const blockTreeAutoLoad = useCallback(
    (fileCountSample: number, limit: number) => {
      directoryLoadGenerationRef.current += 1
      directoryLoadPromisesRef.current.clear()
      setTree({
        status: 'idle',
        nodes: [],
        error: null,
        knownFilePaths: new Set(),
        loadingDirectories: new Set(),
        isRefreshingRoot: false,
        lastRootLoadedAtMs: null,
        lastRootRefreshStartedAtMs: null,
        autoLoadBlocked: true,
        autoLoadFileCountSample: fileCountSample,
        autoLoadLimit: limit,
      })
      commitExpandedDirectories(new Set())
      temporaryRevealRef.current.clear()
      setFileSearchError(null)
      setSearchResultNodes([])
      directoryLoadedAtMsRef.current.clear()
    },
    [commitExpandedDirectories],
  )

  const ensureTreePathLoaded = useCallback(
    async (relativePath: string) => {
      await expandTreePath(relativePath, collectParentDirectories(relativePath), {
        loadDirectory: (directoryRelativePath) => loadDirectory(directoryRelativePath, { reason: 'locate-path' }),
        setExpandedDirectories,
        onRevealDirectory: (directoryRelativePath) => {
          // reveal 临时展开：不在 remembered 中的祖先记入 temporaryReveal（不持久化、刷新即清）。
          if (!rememberedDirectoriesRef.current.has(directoryRelativePath)) {
            temporaryRevealRef.current.add(directoryRelativePath)
          }
        },
      })
    },
    [loadDirectory],
  )

  const markFilePathKnown = useCallback(
    (relativePath: string) => {
      const normalizedPath = relativePath.trim()
      if (!normalizedPath) return

      const nextActive = expandParentDirectories(expandedDirectoriesRef.current, normalizedPath)
      if (nextActive !== expandedDirectoriesRef.current) {
        for (const parent of collectParentDirectories(normalizedPath)) {
          if (!rememberedDirectoriesRef.current.has(parent)) {
            temporaryRevealRef.current.add(parent)
          }
        }
        commitExpandedDirectories(nextActive)
      }
      setTree((prev) => {
        if (prev.knownFilePaths.has(normalizedPath)) return prev
        return {
          ...prev,
          knownFilePaths: new Set(prev.knownFilePaths).add(normalizedPath),
        }
      })
    },
    [commitExpandedDirectories],
  )

  useEffect(() => {
    if (treeAutoLoadPaused) return
    if (activePane !== 'code') return
    if (tree.status !== 'idle') return
    if (tree.autoLoadBlocked) return

    void window.electronAPI
      .getProjectFileAutoLoadDecision(projectPath)
      .then((decision) => {
        if (!decision.shouldAutoLoad) {
          blockTreeAutoLoad(decision.fileCountSample, decision.limit)
          return
        }
        void loadTree()
      })
      .catch(() => {
        void loadTree()
      })
  }, [activePane, blockTreeAutoLoad, loadTree, projectPath, tree.autoLoadBlocked, tree.status, treeAutoLoadPaused])

  // 设置页修改自动加载上限后，解除既有 block 并重置为 idle，上面的决策 effect 会用新配置重新判断。
  const treeAutoLoadFileLimitRef = useRef(treeAutoLoadFileLimit)
  useEffect(() => {
    if (treeAutoLoadFileLimitRef.current === treeAutoLoadFileLimit) return
    treeAutoLoadFileLimitRef.current = treeAutoLoadFileLimit
    setTree((prev) => {
      if (!prev.autoLoadBlocked) return prev
      directoryLoadGenerationRef.current += 1
      directoryLoadPromisesRef.current.clear()
      return {
        status: 'idle',
        nodes: [],
        error: null,
        knownFilePaths: new Set(),
        loadingDirectories: new Set(),
        isRefreshingRoot: false,
        lastRootLoadedAtMs: null,
        lastRootRefreshStartedAtMs: null,
        autoLoadBlocked: false,
        autoLoadFileCountSample: 0,
        autoLoadLimit: 0,
      }
    })
  }, [treeAutoLoadFileLimit])

  // 卸载（如跳转转录页）时保存树快照，返回工作区时即时恢复，避免重新决策扫描空窗。
  useEffect(() => {
    return () => {
      const current = treeStateRef.current
      if (current.status !== 'ready' || current.autoLoadBlocked || current.nodes.length <= 0) return
      saveTreeSnapshot(projectPath, {
        nodes: current.nodes,
        // 只存 remembered（D25）：remount 时 active 由 collectEffectivelyExpanded 重新派生。
        rememberedDirectories: new Set(rememberedDirectoriesRef.current),
        lastRootLoadedAtMs: current.lastRootLoadedAtMs,
        savedAtMs: Date.now(),
      })
    }
  }, [projectPath])

  useEffect(() => {
    const { lineTarget, searchQuery } = parseFileSearchLineTarget(fileSearchQuery)
    const normalizedQuery = searchQuery
    if (!normalizedQuery) {
      setIsSearchingFiles(false)
      setFileSearchError(null)
      setSearchResultNodes([])
      return
    }

    if (tree.autoLoadBlocked) {
      setIsSearchingFiles(false)
      setFileSearchError(null)
      setSearchResultNodes([])
      return
    }

    const requestSeq = searchRequestSeqRef.current + 1
    searchRequestSeqRef.current = requestSeq
    setIsSearchingFiles(true)
    setFileSearchError(null)

    void window.electronAPI
      .searchProjectFiles(projectPath, normalizedQuery)
      .then((result) => {
        if (searchRequestSeqRef.current !== requestSeq) return
        setSearchResultNodes(result)
      })
      .catch((error) => {
        if (searchRequestSeqRef.current !== requestSeq) return
        setSearchResultNodes([])
        setFileSearchError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (searchRequestSeqRef.current !== requestSeq) return
        setIsSearchingFiles(false)
      })
  }, [fileSearchQuery, fileSearchRefreshRequest, projectPath])

  useEffect(() => {
    if (!activeRelativePath) return
    if (treeAutoLoadPaused) return
    if (tree.autoLoadBlocked) return
    if (tree.isRefreshingRoot) return
    void ensureTreePathLoaded(activeRelativePath)
  }, [activeRelativePath, ensureTreePathLoaded, tree.autoLoadBlocked, tree.isRefreshingRoot, treeAutoLoadPaused])

  const contentSearchScopeGlobs = useMemo(() => parseContentSearchScopeGlobs(contentSearchScopeInput), [contentSearchScopeInput])

  useEffect(() => {
    const normalizedQuery = contentSearchQuery.trim()
    if (!normalizedQuery) {
      setIsSearchingContent(false)
      setContentSearchError(null)
      setContentSearchResult({
        files: [],
        totalMatches: 0,
        limited: false,
      })
      return
    }

    const requestSeq = contentSearchRequestSeqRef.current + 1
    contentSearchRequestSeqRef.current = requestSeq
    setIsSearchingContent(true)
    setContentSearchError(null)

    void window.electronAPI
      .searchProjectContent(projectPath, normalizedQuery, {
        caseSensitive: contentSearchCaseSensitive,
        includeGlobs: contentSearchScopeGlobs.length > 0 ? contentSearchScopeGlobs : undefined,
      })
      .then((result) => {
        if (contentSearchRequestSeqRef.current !== requestSeq) return
        setContentSearchResult(result)
      })
      .catch((error) => {
        if (contentSearchRequestSeqRef.current !== requestSeq) return
        setContentSearchResult({
          files: [],
          totalMatches: 0,
          limited: false,
        })
        setContentSearchError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (contentSearchRequestSeqRef.current !== requestSeq) return
        setIsSearchingContent(false)
      })
  }, [contentSearchCaseSensitive, contentSearchQuery, contentSearchScopeGlobs, projectPath])

  const topLevelDirectorySet = useMemo(() => collectTopLevelDirectories(tree.nodes), [tree.nodes])
  const contentSearchScopePresets = useMemo<ContentSearchScopePreset[]>(() => {
    const presets: ContentSearchScopePreset[] = [
      {
        id: 'all',
        label: 'All',
        hint: 'entire project',
        scopeInput: '',
        title: 'Search the whole project',
      },
    ]

    for (const candidate of CONTENT_SEARCH_ROOT_SCOPE_CANDIDATES) {
      if (!topLevelDirectorySet.has(candidate)) continue
      presets.push({
        id: `dir:${candidate}`,
        label: CONTENT_SEARCH_ROOT_SCOPE_LABELS[candidate] ?? candidate,
        hint: `${candidate}/`,
        scopeInput: `${candidate}/`,
        title: `Search inside ${candidate}/`,
      })
    }

    const activeDirectory = directoryFromRelativePath(activeRelativePath)
    if (activeDirectory && !presets.some((preset) => preset.scopeInput === `${activeDirectory}/`)) {
      presets.push({
        id: 'current-dir',
        label: 'This dir',
        hint: `${activeDirectory}/`,
        scopeInput: `${activeDirectory}/`,
        title: `Search inside ${activeDirectory}/`,
      })
    }

    const activeExtension = extensionFromRelativePath(activeRelativePath)
    if (activeExtension) {
      presets.push({
        id: 'same-type',
        label: `.${activeExtension}`,
        hint: `*.${activeExtension}`,
        scopeInput: activeExtension,
        title: `Search ${activeExtension.toUpperCase()} files`,
      })
    }

    return presets.slice(0, 7)
  }, [activeRelativePath, topLevelDirectorySet])

  const activeContentSearchScopeKey = useMemo(() => contentSearchScopeKey(contentSearchScopeInput), [contentSearchScopeInput])

  const contentSearchScopeSummary = useMemo(() => (contentSearchScopeGlobs.length > 0 ? contentSearchScopeGlobs.join(' · ') : 'All files'), [contentSearchScopeGlobs])

  const activeContentSearchScopeLabel = useMemo(() => {
    const activePreset = contentSearchScopePresets.find((preset) => contentSearchScopeKey(preset.scopeInput) === activeContentSearchScopeKey)
    if (activePreset) return activePreset.label
    if (contentSearchScopeGlobs.length === 1) return contentSearchScopeGlobs[0]
    return `${contentSearchScopeGlobs.length} globs`
  }, [activeContentSearchScopeKey, contentSearchScopeGlobs, contentSearchScopePresets])

  const hasContentSearchQuery = contentSearchQuery.trim().length > 0
  const hasContentSearchScope = contentSearchScopeGlobs.length > 0
  const showContentSearchSummary = hasContentSearchQuery && !isSearchingContent && !contentSearchError
  const hasSearchQuery = fileSearchQuery.trim().length > 0
  const treeNodesForView = hasSearchQuery ? searchResultNodes : tree.nodes
  const fileSearchLineTarget = useMemo(() => parseFileSearchLineTarget(fileSearchQuery).lineTarget, [fileSearchQuery])

  // 被排除条目不应进入 tab / session / 最近打开等普通文件链路，收集其路径与类型供上层拦截。
  const excludedPathKinds = useMemo(() => {
    const result = new Map<string, ProjectFileNodeKind>()
    const walk = (items: ProjectFileNode[]) => {
      for (const item of items) {
        if (item.isExcluded) {
          result.set(item.relativePath, item.kind)
          continue
        }
        if (item.children && item.children.length > 0) {
          walk(item.children)
        }
      }
    }
    walk(tree.nodes)
    return result
  }, [tree.nodes])

  return {
    activeContentSearchScopeKey,
    activeContentSearchScopeLabel,
    contentSearchCaseSensitive,
    contentSearchError,
    contentSearchQuery,
    contentSearchResult,
    contentSearchScopeGlobs,
    contentSearchScopePresets,
    contentSearchScopeSummary,
    ensureTreePathLoaded,
    excludedPathKinds,
    expandedDirectories,
    fileSearchError,
    fileSearchLineTarget,
    fileSearchQuery,
    hasContentSearchQuery,
    hasContentSearchScope,
    hasSearchQuery,
    isContentSearchAdvancedOpen,
    isSearchingContent,
    isSearchingFiles,
    loadTree,
    markFilePathKnown,
    refreshRootIfStale,
    setContentSearchCaseSensitive,
    setContentSearchQuery,
    setExpandedDirectories,
    setFileSearchQuery,
    setIsContentSearchAdvancedOpen,
    showContentSearchSummary,
    toggleDirectory,
    tree,
    treeNodesForView,
  }
}
