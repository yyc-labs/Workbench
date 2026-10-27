/**
 * 19 号计划 §3.4：RunContextResolver——项目上下文独立于文件类型识别。
 * 通过 listProjectDirectoryFiles 探测祖先目录的 manifest / lockfile（复用现有 IPC，不新建文件系统链路，§11.5），
 * 不扫描整个仓库；目录列表带 TTL 缓存，manifest 内容每次解析都重新读取，保证 scripts 列表新鲜。
 * deps 注入以便脱离 Electron 单测（§9）。
 */

import { parsePackageManagerField, resolvePackageManager } from '../../../shared/rules'
import type { PackageManager, ProjectFileTreeResult } from '../../../shared/types'
import type { NearestPackageManifest, RunContext } from './types'

export type RunContextResolverDeps = {
  listDirectoryFiles: (projectPath: string, directoryRelativePath: string | null) => Promise<ProjectFileTreeResult>
  readTextFile: (projectPath: string, relativePath: string) => Promise<string | null>
}

export type ResolveRunContextOptions = {
  projectPath: string
  /** 当前编辑文件相对项目根路径。 */
  relativePath: string
  /** 编辑器当前内容。 */
  content: string
  useWsl: boolean
}

const DIRECTORY_LISTING_CACHE_TTL_MS = 10_000

const directoryListingCache = new Map<string, { at: number; names: string[] }>()

/** 目录列表缓存失效（对应文件变化时可显式调用；TTL 到期自动过期）。 */
export function invalidateRunContextCache(): void {
  directoryListingCache.clear()
}

async function listDirectoryNames(deps: RunContextResolverDeps, projectPath: string, dirRelative: string): Promise<string[] | null> {
  const cacheKey = `${projectPath}::${dirRelative}`
  const cached = directoryListingCache.get(cacheKey)
  const now = Date.now()
  if (cached && now - cached.at < DIRECTORY_LISTING_CACHE_TTL_MS) return cached.names
  try {
    const result = await deps.listDirectoryFiles(projectPath, dirRelative === '.' ? null : dirRelative)
    const names = result.nodes.map((node) => node.name)
    directoryListingCache.set(cacheKey, { at: now, names })
    return names
  } catch {
    return null
  }
}

function detectDeclaredPackageManager(manifestContent: string): PackageManager | undefined {
  try {
    const parsed = JSON.parse(manifestContent) as { packageManager?: unknown }
    return parsePackageManagerField(parsed.packageManager)
  } catch {
    return undefined
  }
}

function joinRelativeDirectory(dirSegments: string[]): string {
  return dirSegments.length === 0 ? '.' : dirSegments.join('/')
}

export async function resolveRunContext(deps: RunContextResolverDeps, options: ResolveRunContextOptions): Promise<RunContext> {
  const { projectPath, content, useWsl } = options
  const normalizedRelativePath = options.relativePath.trim().replace(/\\/g, '/').replace(/^\/+/, '')
  const fileSegments = normalizedRelativePath.split('/').filter(Boolean)

  // 从文件所在目录向上探测到项目根为止：找最近的 package.json（§4.4 只覆盖必要祖先目录）。
  let probeSegments = fileSegments.slice(0, -1)
  let nearestPackageJson: NearestPackageManifest | null = null
  let packageManager: PackageManager = 'npm'

  while (true) {
    const dirRelative = joinRelativeDirectory(probeSegments)
    const names = await listDirectoryNames(deps, projectPath, dirRelative)
    if (names?.includes('package.json')) {
      const manifestRelative = dirRelative === '.' ? 'package.json' : `${dirRelative}/package.json`
      const manifestContent = await deps.readTextFile(projectPath, manifestRelative)
      if (manifestContent != null) {
        nearestPackageJson = { dirRelative, content: manifestContent }
        packageManager = resolvePackageManager({
          declared: detectDeclaredPackageManager(manifestContent),
          directoryFiles: names,
        })
        break
      }
    }
    if (probeSegments.length === 0) break
    probeSegments = probeSegments.slice(0, -1)
  }

  return {
    projectPath,
    relativePath: normalizedRelativePath,
    content,
    fileDirRelative: joinRelativeDirectory(fileSegments.slice(0, -1)),
    nearestPackageJson,
    packageManager,
    useWsl,
  }
}
