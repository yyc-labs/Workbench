/**
 * 交互 shell 命令解析（集合面板新建终端 / 文件树脚本执行共用）。
 * 按 useWsl 记忆结果，避免每次开新终端都走一次 IPC；
 * 查询失败时抛错，由调用方决定降级（终端启动失败提示）。
 */

let cache: { useWsl: boolean; command: string } | null = null

export async function resolveInteractiveShellCommand(useWsl: boolean): Promise<string> {
  if (cache?.useWsl === useWsl) return cache.command
  const result = await window.electronAPI.getInteractiveShellCommand(useWsl)
  cache = { useWsl, command: result.command }
  return result.command
}
