import { promises as fs } from 'node:fs'
import { resolveWslVsCodeTarget } from '../shell/openers'
import { wslBridge } from '../wsl-bridge'
import type { GitRepositorySnapshot } from '../../../shared/types'

export type GitSnapshotReadOptions = { lightweight?: boolean }

type GitSnapshotReader = (repoRoot: string, traceActionId?: string, options?: GitSnapshotReadOptions) => Promise<GitRepositorySnapshot>

type GitSnapshotDedupeDependencies = {
  readGitRepositorySnapshot: GitSnapshotReader
  getDefaultWslDistro: () => string
  /** 测试注入：规范化仓库根（默认 fs.realpath，失败回退原路径） */
  normalizeRepoRoot?: (repoRoot: string) => Promise<string>
  /** 测试注入：执行模式标签（默认 windows-native / wsl:<distro>） */
  resolveExecutionMode?: (repoRoot: string) => string
}

// 快照 in-flight 去重（阶段 3 / plan-detail §4.1）：
// - 仅合并并发只读请求；key = 执行模式 + realpath 规范根 + light/full（light 与 full 不互享）。
// - mutation 写入口必须先调 invalidateGitSnapshot（规则 3）：执行前 bump generation，
//   在途旧请求只服务已在等待的调用方，bump 之后发起的请求不得共享旧结果。
// - 外部修改（外部终端、AI 子进程）不在主进程拦截，不纳入 generation，
//   依靠动作后 / AI 状态变化后的权威刷新兜底（useAiCommitFlow），不得以缓存替代。
// - 请求完成或失败后条目即从 Map 删除；失败不缓存。
export function createGitSnapshotDedupe(deps: GitSnapshotDedupeDependencies) {
  const readGitRepositorySnapshot = deps.readGitRepositorySnapshot
  const getDefaultWslDistro = () => deps.getDefaultWslDistro() || 'Ubuntu'
  const normalizeRepoRoot =
    deps.normalizeRepoRoot ??
    (async (repoRoot: string) => {
      try {
        return await fs.realpath(repoRoot)
      } catch {
        return repoRoot
      }
    })
  const resolveExecutionMode =
    deps.resolveExecutionMode ??
    ((repoRoot: string) => {
      if (process.platform !== 'win32') return 'windows-native'
      const target = resolveWslVsCodeTarget(repoRoot, getDefaultWslDistro())
      return target && wslBridge.isAvailable() ? `wsl:${target.distro}` : 'windows-native'
    })

  const generations = new Map<string, number>()
  const inflight = new Map<string, { generation: number; promise: Promise<GitRepositorySnapshot> }>()

  async function resolveBaseKey(repoRoot: string): Promise<string> {
    return `${resolveExecutionMode(repoRoot)}:${await normalizeRepoRoot(repoRoot)}`
  }

  async function readGitSnapshot(repoRoot: string, traceActionId?: string, options?: GitSnapshotReadOptions): Promise<GitRepositorySnapshot> {
    const lightweight = options?.lightweight === true
    const baseKey = await resolveBaseKey(repoRoot)
    const key = `${baseKey}:${lightweight ? 'light' : 'full'}`
    const generation = generations.get(baseKey) ?? 0
    const existing = inflight.get(key)
    if (existing && existing.generation === generation) {
      return existing.promise
    }
    const promise = readGitRepositorySnapshot(repoRoot, traceActionId, options).finally(() => {
      if (inflight.get(key)?.promise === promise) inflight.delete(key)
    })
    inflight.set(key, { generation, promise })
    return promise
  }

  async function invalidateGitSnapshot(repoRoot: string): Promise<void> {
    const baseKey = await resolveBaseKey(repoRoot)
    generations.set(baseKey, (generations.get(baseKey) ?? 0) + 1)
  }

  return {
    readGitSnapshot,
    invalidateGitSnapshot,
  }
}

export type GitSnapshotDedupe = ReturnType<typeof createGitSnapshotDedupe>
