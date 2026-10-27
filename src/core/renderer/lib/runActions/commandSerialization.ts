/**
 * 19 号计划 §3.1/§9：RunAction → 终端命令字符串的纯函数序列化。
 * 必须脱离 Electron 可测；脚本名与路径不经未处理的拼接（§5.3）。
 */

import { buildScriptCommand } from '../executableScripts'
import { scriptCommand } from '../packageScripts'
import type { RunAction } from './types'

export function serializeRunActionCommand(action: RunAction): string {
  const execution = action.execution
  switch (execution.type) {
    case 'package-script':
      // package.json script 本身是用户配置的 Shell 命令，经包管理器原样执行，不解析重拼（§3.1 例外）。
      return scriptCommand(execution.packageManager, execution.scriptName)
    case 'run-file':
      // 复用文件树同款「解释器 + 引号路径」命令构造，Windows/WSL 差异由 runtime 映射表承担。
      return buildScriptCommand({ runtime: execution.runtime }, execution.filePath)
    case 'shell-task':
      return execution.command
  }
}
