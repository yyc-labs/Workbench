/**
 * 19 号计划 §3.2：Action Executor——协调一次运行请求。
 * 校验由调用方（hook）完成（它持有当前内容），这里负责会话策略与终端适配调用；
 * 不解析语言语法。P0 只覆盖内置终端通道（§6.2 第一版策略）。
 */

import { serializeRunActionCommand } from './commandSerialization'
import { runCommandInEmbeddedShell, type TerminalExecutionDeps } from './terminalExecution'
import type { RunAction } from './types'

export type ExecuteRunActionOptions = {
  projectId: string
  action: RunAction
  useWsl: boolean
  /** 启动失败提示（复用 terminalLaunchFailed 同款 toast 路径，§2.2）。 */
  notifyLaunchFailure: () => void
  onSubmitted?: () => void
}

/**
 * 执行一个编辑器运行动作：序列化命令 → 启动/复用嵌入式交互 shell 终端 → rename + reveal + 发送。
 * 返回 false 表示启动失败（已回调 notifyLaunchFailure）。
 */
export async function executeRunAction(deps: TerminalExecutionDeps, options: ExecuteRunActionOptions): Promise<boolean> {
  const { action } = options
  const command = serializeRunActionCommand(action)
  const ok = await runCommandInEmbeddedShell(deps, {
    projectId: options.projectId,
    cwd: action.execution.cwd,
    command,
    title: action.label,
    useWsl: options.useWsl,
    onSubmitted: options.onSubmitted,
  })
  if (!ok) {
    options.notifyLaunchFailure()
    return false
  }
  return true
}
