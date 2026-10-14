export type ScriptRuntime = 'node' | 'python' | 'bash' | 'powershell' | 'cmd'

export interface ExecutableScriptInfo {
  runtime: ScriptRuntime
  extension: string
}

interface ScriptRuntimeRule {
  extensions: string[]
  runtime: ScriptRuntime
  /** 仅 WSL 项目展示（bash 依赖 POSIX 环境）。 */
  wslOnly?: boolean
  /** 仅 Windows Native 项目展示（ps1/bat/cmd 依赖 Windows shell）。 */
  windowsOnly?: boolean
}

// 只看扩展名静态展示，不读文件内容——避免右键菜单触发文件 IO；解释器缺失时由终端报错（本期决策：不做主进程探测）。
const SCRIPT_RUNTIME_RULES: readonly ScriptRuntimeRule[] = [
  { extensions: ['.mjs', '.js'], runtime: 'node' },
  { extensions: ['.py'], runtime: 'python' },
  { extensions: ['.sh'], runtime: 'bash', wslOnly: true },
  { extensions: ['.ps1'], runtime: 'powershell', windowsOnly: true },
  { extensions: ['.bat', '.cmd'], runtime: 'cmd', windowsOnly: true },
]

function splitRelativeSegments(relativePath: string): string[] {
  return relativePath
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
}

/**
 * 按扩展名解析脚本文件的运行时。路径必须是不含 `..` 的相对路径，返回 null 表示不可执行或环境不匹配。
 */
export function resolveExecutableScript(relativePath: string, useWsl: boolean): ExecutableScriptInfo | null {
  const segments = splitRelativeSegments(relativePath)
  if (segments.length === 0) return null
  if (segments.some((segment) => segment === '.' || segment === '..')) return null

  const fileName = segments[segments.length - 1]
  const lowerFileName = fileName.toLowerCase()
  for (const rule of SCRIPT_RUNTIME_RULES) {
    if (rule.wslOnly && !useWsl) continue
    if (rule.windowsOnly && useWsl) continue
    const matched = rule.extensions.find((extension) => lowerFileName.endsWith(extension))
    if (!matched) continue
    return { runtime: rule.runtime, extension: matched }
  }
  return null
}

/**
 * 生成「解释器 + 脚本路径」命令。只由映射表解释器与校验后的相对路径构成，不接受任何用户自定义片段。
 */
export function buildScriptCommand(info: ExecutableScriptInfo, relativePath: string): string {
  const normalizedPath = relativePath.trim().replace(/\\/g, '/')
  switch (info.runtime) {
    case 'node':
      return `node "${normalizedPath}"`
    case 'python':
      return `python "${normalizedPath}"`
    case 'bash':
      return `bash "${normalizedPath}"`
    case 'powershell':
      return `pwsh "${normalizedPath}"`
    case 'cmd': {
      // cmd 对 `/` 有开关歧义，bat/cmd 用反斜杠路径。
      const windowsPath = normalizedPath.replace(/\//g, '\\')
      return `cmd /c "${windowsPath}"`
    }
  }
}
