/**
 * 把一条已校验的命令发送进「刚启动的交互 shell 终端」。
 *
 * 背景：文件树右键执行脚本时，内置终端若直接 spawn 一次性命令
 *（pwsh -Command / cmd /c / bash -lc），进程结束即带着终端一起消失，
 * 用户来不及查看输出。改为启动交互 shell 后把命令作为键盘输入发送：
 * 脚本跑完 shell 回到提示符，终端保持打开。
 *
 * 时序：shell 就绪（开始输出）前写入的输入会被 pty 缓冲，但 conpty 早期
 * 输入存在被吞的边界情况，因此等该进程首条输出再发送；超时兜底发送，
 * 避免个别 shell 长时间无输出时命令永远发不出去。
 */

export interface TerminalCommandHooks {
  /** 订阅进程输出；返回退订函数。 */
  onOutput: (listener: (event: { projectId: string; data: string }) => void) => () => void
  /** 向进程写入输入。 */
  sendInput: (processKey: string, data: string) => void
}

/** shell 首输出等待上限：超过后按 type-ahead 语义直接发送。 */
const SHELL_READY_TIMEOUT_MS = 1000

/**
 * 发送命令并返回 cancel：cancel 后不再发送（启动失败 / 终端已关闭时调用）。
 * 发送与退订均只执行一次；重复调用 cancel 无副作用。
 */
export function sendTerminalCommand(processKey: string, command: string, hooks: TerminalCommandHooks, timeoutMs: number = SHELL_READY_TIMEOUT_MS): () => void {
  let settled = false
  let unsubscribe: (() => void) | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const settle = (send: boolean) => {
    if (settled) return
    settled = true
    if (timer != null) clearTimeout(timer)
    unsubscribe?.()
    unsubscribe = null
    if (send) hooks.sendInput(processKey, `${command}\r`)
  }

  unsubscribe = hooks.onOutput(({ projectId, data }) => {
    // 只认本进程的非空输出：shell 提示符出现即视为就绪。
    if (projectId !== processKey || !data) return
    settle(true)
  })
  timer = setTimeout(() => settle(true), timeoutMs)

  return () => settle(false)
}
