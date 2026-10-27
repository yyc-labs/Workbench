/**
 * 19 号计划 §3.2/§3.5/§11.4：Terminal Adapter——从文件树脚本执行链路抽取的共享终端能力。
 * 编辑器运行入口与文件树右键执行共用同一分配器与同一链路，`::script::<n>` 语义不变。
 * deps 注入以便脱离 Electron 单测（§9）。
 */

import { resolveInteractiveShellCommand } from '../interactiveShell'
import { sendTerminalCommand, type TerminalCommandHooks } from '../terminalCommand'

export type TerminalExecutionDeps = {
  /** 当前存活进程 key 列表（分配器据此取最小空闲编号）。 */
  getProcessKeys: () => string[]
  resolveShellCommand: (useWsl: boolean) => Promise<string>
  startProject: (projectId: string, commandOverride: string | undefined, processId: string | undefined, useWsl: boolean | undefined, cwdOverride: string | undefined, runStartupModeOverride?: 'silent' | 'terminal') => Promise<boolean>
  renameTerminal: (projectId: string, processKey: string, title: string) => void
  revealTerminal: (projectId: string, processKey: string) => void
  sendInput: (processKey: string, data: string) => void
  onProcessOutput: TerminalCommandHooks['onOutput']
  openPathTerminal: (cwd: string, command?: string) => Promise<boolean>
}

/** 从 appStore processes + projectId 构造共享 deps 的惯用入口。 */
export function createAppStoreTerminalDeps(
  store: {
    getState: () => {
      processes: Record<string, unknown>
      startProject: TerminalExecutionDeps['startProject']
      renameTerminal: TerminalExecutionDeps['renameTerminal']
      revealTerminal: TerminalExecutionDeps['revealTerminal']
      sendInput: TerminalExecutionDeps['sendInput']
    }
  },
  electronApi: { onProcessOutput: TerminalExecutionDeps['onProcessOutput']; openPathTerminal: TerminalExecutionDeps['openPathTerminal'] },
): TerminalExecutionDeps {
  return {
    getProcessKeys: () => Object.keys(store.getState().processes),
    resolveShellCommand: resolveInteractiveShellCommand,
    startProject: (...args) => store.getState().startProject(...args),
    renameTerminal: (projectId, processKey, title) => store.getState().renameTerminal(projectId, processKey, title),
    revealTerminal: (projectId, processKey) => store.getState().revealTerminal(projectId, processKey),
    sendInput: (processKey, data) => store.getState().sendInput(processKey, data),
    onProcessOutput: electronApi.onProcessOutput,
    openPathTerminal: (cwd, command) => electronApi.openPathTerminal(cwd, command),
  }
}

/** 扫描现有 processes 取最小空闲 n，生成 `${projectId}::script::<n>`（与文件树现状一致，§11.4）。 */
export function allocateScriptProcessKey(projectId: string, processKeys: readonly string[]): string {
  const prefix = `${projectId}::script::`
  const used = new Set<number>()
  for (const key of processKeys) {
    if (!key.startsWith(prefix)) continue
    const n = Number.parseInt(key.slice(prefix.length), 10)
    if (Number.isInteger(n) && n >= 0) used.add(n)
  }
  let n = 0
  while (used.has(n)) n += 1
  return `${prefix}${n}`
}

export type EmbeddedShellRunOptions = {
  projectId: string
  cwd: string
  command: string
  /** 终端初始 title（文件树用脚本文件名，编辑器用脚本名 / 文件名）。 */
  title: string
  useWsl: boolean
  onSubmitted?: () => void
}

/**
 * 启动交互 shell 并把命令作为键盘输入发送（脚本跑完 shell 回到提示符，终端保持打开）。
 * 返回 false 表示启动失败（shell 解析失败或 startProject 失败），调用方负责失败提示。
 */
export async function runCommandInEmbeddedShell(deps: TerminalExecutionDeps, options: EmbeddedShellRunOptions): Promise<boolean> {
  const processKey = allocateScriptProcessKey(options.projectId, deps.getProcessKeys())
  let shellCommand: string
  try {
    shellCommand = await deps.resolveShellCommand(options.useWsl)
  } catch {
    return false
  }
  // 显式传 'silent' 启动模式，避免 isPrimaryProjectRun 命中时被劫持到外部终端。
  const ok = await deps.startProject(options.projectId, shellCommand, processKey, options.useWsl, options.cwd, 'silent')
  if (!ok) return false
  deps.renameTerminal(options.projectId, processKey, options.title)
  deps.revealTerminal(options.projectId, processKey)
  // 命令经 shell 输入通道下发：等首条输出（shell 就绪）后发送，超时按 type-ahead 兜底；settle 幂等防重复发送（§6.1）。
  sendTerminalCommand(processKey, options.command, {
    onOutput: deps.onProcessOutput,
    sendInput: (key, data) => deps.sendInput(key, data),
  })
  options.onSubmitted?.()
  return true
}

/** 系统通道：打开系统终端并执行命令。返回是否成功打开。 */
export async function runCommandInSystemTerminal(deps: TerminalExecutionDeps, options: { cwd: string; command: string }): Promise<boolean> {
  return deps.openPathTerminal(options.cwd, options.command)
}
