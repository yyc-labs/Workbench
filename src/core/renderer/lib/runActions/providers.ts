/**
 * 19 号计划 §3.3：静态注册的 RunActionProvider。
 * 纯计算、不调用 IPC、不启动终端；只产出结构化 RunAction[]。
 */

import { resolveExecutableScript } from '../executableScripts'
import { parsePackageScriptsWithLines } from '../packageScripts'
import { fileNameFromRelativePath, joinProjectPath, splitRelativePath } from '../projectPaths'
import type { RunAction, RunActionKind, RunContext } from './types'

export interface RunActionProvider {
  id: string
  resolve(context: RunContext): RunAction[]
}

/** 按脚本名启发式分类 kind（仅展示分组用，不影响执行）。 */
function classifyScriptKind(scriptName: string): RunActionKind {
  const name = scriptName.toLowerCase()
  if (name.includes('test')) return 'test'
  if (name.includes('build') || name === 'compile') return 'build'
  if (name.includes('install') || name === 'setup' || name === 'postinstall') return 'install'
  return 'run'
}

function resolveParentDirectoryAbsolutePath(projectPath: string, relativePath: string): string {
  const segments = splitRelativePath(relativePath)
  if (segments.length <= 1) return projectPath
  const parentRelative = segments.slice(0, -1).join('/')
  return parentRelative ? joinProjectPath(projectPath, parentRelative) : projectPath
}

/** B 类：package.json scripts → package-script 动作（文档原始顺序，携带行号）。 */
export const packageScriptsProvider: RunActionProvider = {
  id: 'package-scripts',
  resolve(context) {
    const manifest = context.nearestPackageJson
    if (!manifest) return []
    const manifestRelative = manifest.dirRelative === '.' ? 'package.json' : `${manifest.dirRelative}/package.json`
    // 只在编辑「声明脚本的 package.json 本身」时显示脚本动作：
    // 不把别的文件的脚本拿到其他文件显示（用户决策 2026-10-26）。
    if (manifestRelative !== context.relativePath) return []
    // 内容暂时非法（正在输入、注释等）时流式解析返回 null：安全隐藏入口，不猜（§9）。
    const entries = parsePackageScriptsWithLines(manifest.content)
    if (!entries) return []
    // 项目根（'.'）直接用项目根路径，joinProjectPath 不会折叠 '.' 段。
    const cwd = manifest.dirRelative === '.' ? context.projectPath : joinProjectPath(context.projectPath, manifest.dirRelative)
    return entries.map((entry) => ({
      id: `package-script:${manifestRelative}:${entry.name}`,
      label: entry.name,
      kind: classifyScriptKind(entry.name),
      source: { filePath: manifestRelative, line: entry.line },
      execution: { type: 'package-script', scriptName: entry.name, packageManager: context.packageManager, cwd },
    }))
  },
}

/** A 类 P0：可直接执行的源码与脚本 → run-file 动作（复用文件树同款扩展名映射）。 */
export const sourceFileProvider: RunActionProvider = {
  id: 'source-file',
  resolve(context) {
    const info = resolveExecutableScript(context.relativePath, context.useWsl)
    if (!info) return []
    return [
      {
        id: `run-file:${context.relativePath}`,
        label: fileNameFromRelativePath(context.relativePath),
        kind: 'run',
        source: { filePath: context.relativePath },
        execution: {
          type: 'run-file',
          runtime: info.runtime,
          filePath: context.relativePath,
          args: [],
          cwd: resolveParentDirectoryAbsolutePath(context.projectPath, context.relativePath),
        },
      },
    ]
  },
}

/** 静态注册表：数组顺序即优先级（§3.3 不做插件平台）。 */
// 「运行文件」入口已下线（用户决策 2026-10-26）：编辑源码文件不再显示运行按钮；
// 恢复时把 sourceFileProvider 加回数组即可。
export const runActionProviders: readonly RunActionProvider[] = [packageScriptsProvider]

/**
 * 汇总所有 Provider 输出并去重（§3.3）：同文件同 kind 的冲突只在**跨 Provider** 时
 * 取先注册（优先级高）的动作；同一 Provider 内的多条同类动作（如 package.json 的
 * dev 与 start 同为 run）是不同脚本，必须全部保留。action.id 冲突同样丢弃后者。
 */
export function resolveRunActions(providers: readonly RunActionProvider[], context: RunContext): RunAction[] {
  const providerOutputs = providers.map((provider) => provider.resolve(context))

  // 记录每个 (file, kind) 首次出现的 Provider 序号：仅首个 Provider 的该类动作被接受。
  const firstProviderByFileKind = new Map<string, number>()
  providerOutputs.forEach((actions, providerIndex) => {
    for (const action of actions) {
      const fileKindKey = `${action.source.filePath}::${action.kind}`
      if (!firstProviderByFileKind.has(fileKindKey)) {
        firstProviderByFileKind.set(fileKindKey, providerIndex)
      }
    }
  })

  const actions: RunAction[] = []
  const seenIds = new Set<string>()
  providerOutputs.forEach((providerActions, providerIndex) => {
    for (const action of providerActions) {
      if (seenIds.has(action.id)) continue
      const fileKindKey = `${action.source.filePath}::${action.kind}`
      if (firstProviderByFileKind.get(fileKindKey) !== providerIndex) continue
      seenIds.add(action.id)
      actions.push(action)
    }
  })
  return actions
}
