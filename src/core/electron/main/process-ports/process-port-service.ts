import { execFile } from 'node:child_process'
import type { Capability, ProcessPortInfo, ProcessPortInventory } from '../../../shared/types'

const COMMAND_TIMEOUT_MS = 6000
const MAX_BUFFER_BYTES = 16 * 1024 * 1024

type ProcessPortServiceDependencies = {
  getCapability: () => Capability | null
}

function execWithTimeout(command: string, args: string[], timeoutMs = COMMAND_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: 'utf8', timeout: timeoutMs, maxBuffer: MAX_BUFFER_BYTES, windowsHide: true }, (error, stdout) => {
      if (error) {
        reject(error)
        return
      }
      resolve(typeof stdout === 'string' ? stdout : '')
    })
  })
}

type ProcessMeta = {
  name: string
  command: string
}

function sortAndFinalize(infoByPid: Map<number, ProcessPortInfo>): ProcessPortInfo[] {
  const items = Array.from(infoByPid.values())
  for (const item of items) {
    item.ports = Array.from(new Set(item.ports)).sort((a, b) => a - b)
  }
  return items.sort((a, b) => a.name.localeCompare(b.name) || a.pid - b.pid)
}

function parseWindowsPsProcesses(stdout: string): Map<number, ProcessMeta> {
  const result = new Map<number, ProcessMeta>()
  const text = stdout.trim()
  if (!text) return result

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return result
  }

  const rows = Array.isArray(parsed) ? parsed : [parsed]
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const record = row as Record<string, unknown>
    const pid = Number(record.ProcessId)
    if (!Number.isInteger(pid) || pid <= 0) continue
    result.set(pid, {
      name: typeof record.Name === 'string' ? record.Name : `pid-${pid}`,
      command: typeof record.CommandLine === 'string' ? record.CommandLine : '',
    })
  }
  return result
}

function fillCommandFromPs(infoByPid: Map<number, ProcessPortInfo>, stdout: string): void {
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+(.*)$/)
    if (!match) continue
    const pid = Number(match[1])
    const info = infoByPid.get(pid)
    if (info) info.command = match[2]
  }
}

async function collectWindows(): Promise<ProcessPortInfo[]> {
  const netstatOut = await execWithTimeout('netstat.exe', ['-ano', '-p', 'TCP'])
  const portsByPid = new Map<number, Set<number>>()
  for (const line of netstatOut.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/)
    // 协议 本地地址 外部地址 状态 PID
    if (parts.length >= 5 && parts[0].toUpperCase() === 'TCP' && parts[3].toUpperCase() === 'LISTENING') {
      const portMatch = parts[1].match(/:(\d+)$/) // 兼容 [::]:135 / 0.0.0.0:135 / 127.0.0.1:3000
      const pid = Number(parts[4])
      if (portMatch && Number.isInteger(pid) && pid > 0) {
        const set = portsByPid.get(pid) ?? new Set<number>()
        set.add(Number(portMatch[1]))
        portsByPid.set(pid, set)
      }
    }
  }
  if (portsByPid.size === 0) return []

  // 中文系统乱码防护：脚本首行强制 UTF-8 输出；execFile 侧 encoding:'utf8'
  // 只查询有监听端口的 PID，避免每次轮询全量枚举所有进程
  const pidList = Array.from(portsByPid.keys())
  const psScript = [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '$ErrorActionPreference = "Stop"',
    `$pids = @(${pidList.join(',')})`,
    'Get-CimInstance Win32_Process | Where-Object { $pids -contains $_.ProcessId } | Select-Object ProcessId, Name, CommandLine | ConvertTo-Json -Compress',
  ].join('; ')
  const psOut = await execWithTimeout('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript])
  const metaByPid = parseWindowsPsProcesses(psOut)

  return Array.from(portsByPid.entries())
    .map(([pid, ports]) => ({
      pid,
      name: metaByPid.get(pid)?.name ?? `pid-${pid}`,
      command: metaByPid.get(pid)?.command ?? '',
      ports: Array.from(ports).sort((a, b) => a - b),
      host: 'host' as const,
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.pid - b.pid)
}

async function collectMacos(): Promise<ProcessPortInfo[]> {
  const lsofOut = await execWithTimeout('lsof', ['-i', '-P', '-n', '-sTCP:LISTEN'])
  const infoByPid = new Map<number, ProcessPortInfo>()
  for (const line of lsofOut.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 9) continue
    const name = parts[0]
    const pid = Number(parts[1])
    const portMatch = parts[8].match(/:(\d+)$/) // NAME 列形如 *:3000 / 127.0.0.1:3000 / [::1]:3000
    if (!Number.isInteger(pid) || pid <= 0 || !portMatch) continue
    const info = infoByPid.get(pid) ?? { pid, name, command: '', ports: [], host: 'host' as const }
    info.ports.push(Number(portMatch[1]))
    infoByPid.set(pid, info)
  }
  if (infoByPid.size === 0) return []
  const psOut = await execWithTimeout('ps', ['-axo', 'pid=,command='])
  fillCommandFromPs(infoByPid, psOut)
  return sortAndFinalize(infoByPid)
}

async function collectLinux(): Promise<ProcessPortInfo[]> {
  const ssOut = await execWithTimeout('ss', ['-tulnp'])
  const infoByPid = new Map<number, ProcessPortInfo>()
  for (const line of ssOut.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/)
    // State Recv-Q Send-Q Local:Port Peer:Port [Process]
    if (parts[0] !== 'LISTEN' || parts.length < 5) continue
    const portMatch = parts[3].match(/:(\d+)$/) // *:3000 / [::]:3000 / 0.0.0.0:3000
    if (!portMatch) continue
    const procMatch = parts
      .slice(5)
      .join(' ')
      .match(/users:\(\("([^"]+)",pid=(\d+)/)
    if (!procMatch) continue // 无权限看不到 pid 的行直接跳过（多为系统/root 进程）
    const pid = Number(procMatch[2])
    if (!Number.isInteger(pid) || pid <= 0) continue
    const info = infoByPid.get(pid) ?? { pid, name: procMatch[1], command: '', ports: [], host: 'host' as const }
    info.ports.push(Number(portMatch[1]))
    infoByPid.set(pid, info)
  }
  if (infoByPid.size === 0) return []
  const psOut = await execWithTimeout('ps', ['-eo', 'pid=,args='])
  fillCommandFromPs(infoByPid, psOut)
  return sortAndFinalize(infoByPid)
}

export function createProcessPortService(deps: ProcessPortServiceDependencies) {
  async function listProcessPorts(): Promise<ProcessPortInventory> {
    const checkedAt = Date.now()
    const hostPlatform = deps.getCapability()?.hostPlatform ?? (process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux')
    try {
      if (hostPlatform === 'windows') {
        return { checkedAt, hostPlatform, processes: await collectWindows() }
      }
      if (hostPlatform === 'macos') {
        return { checkedAt, hostPlatform, processes: await collectMacos() }
      }
      return { checkedAt, hostPlatform, processes: await collectLinux() }
    } catch (error) {
      // 失败返回错误态而不是抛异常，UI 需要渲染 error 文案
      return {
        checkedAt,
        hostPlatform,
        processes: [],
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  return { listProcessPorts }
}

export type ProcessPortService = ReturnType<typeof createProcessPortService>
