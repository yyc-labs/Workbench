/**
 * 19 号计划：编辑器上下文感知快捷运行——动作模型。
 * P0 全链路在 renderer 侧，不进 shared；未来动作需要跨进程时再提升（§11.5）。
 */

import type { PackageManager } from '../../../shared/types'
import type { ScriptRuntime } from '../executableScripts'

export type RunActionKind = 'run' | 'test' | 'build' | 'install'

/**
 * 结构化执行描述（§3.1）：Provider 只表达「要执行什么」，
 * 命令序列化（commandSerialization.ts）决定「如何执行」。
 */
export type RunActionExecution =
  | {
      type: 'package-script'
      scriptName: string
      packageManager: PackageManager
      cwd: string
    }
  | {
      type: 'run-file'
      runtime: ScriptRuntime
      /** 相对项目根的文件路径（'/' 分隔）。 */
      filePath: string
      args: string[]
      cwd: string
    }
  | {
      type: 'shell-task'
      command: string
      cwd: string
    }

export type RunAction = {
  /** 稳定标识：UI 点击只传 id，执行时核对脚本仍存在（§2.2 执行标识稳定性约束）。 */
  id: string
  label: string
  kind: RunActionKind
  /** 动作来源文件与行号（行号仅展示用，不作为执行依据）。 */
  source: { filePath: string; line?: number }
  execution: RunActionExecution
}

/** 从当前文件目录向上解析出的最近 package.json。 */
export type NearestPackageManifest = {
  /** manifest 所在目录相对项目根路径（'/' 分隔，项目根为 '.'）。 */
  dirRelative: string
  /** 原始文本内容。 */
  content: string
}

/** Provider 消费的项目上下文（§3.4）：由 RunContextResolver 解析，独立于文件类型识别。 */
export type RunContext = {
  /** 项目根绝对路径。 */
  projectPath: string
  /** 当前编辑文件相对项目根路径（'/' 分隔）。 */
  relativePath: string
  /** 编辑器当前内容。 */
  content: string
  /** 当前文件所在目录相对项目根（项目根为 '.'）。 */
  fileDirRelative: string
  nearestPackageJson: NearestPackageManifest | null
  /** 包管理器：声明字段优先 → lockfile → npm 回退（§4.1）。 */
  packageManager: PackageManager
  useWsl: boolean
}
