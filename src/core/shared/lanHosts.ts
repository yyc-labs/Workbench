import type { TranscriptShareHost, TranscriptShareHostKind } from './types'

// 局域网可达 host 的探测与排序，供 transcript share / agent hook gateway 复用。
// 纯函数、不依赖 Electron 与 node 内置模块类型，可被 renderer/web 编译。

type LanNetworkInterfaceInfo = {
  address?: string
  family?: string | number
  internal?: boolean
}

export type LanNetworkInterfacesReader = () => Record<string, ReadonlyArray<LanNetworkInterfaceInfo> | undefined>

type CandidateHost = TranscriptShareHost & {
  score: number
}

export function classifyInterface(name: string): TranscriptShareHostKind {
  const lower = name.trim().toLowerCase()
  if (/(hyper-v|vmware|virtualbox|vbox|docker|wsl|loopback|vethernet|virtual)/.test(lower)) return 'virtual'
  if (/(wi-?fi|wlan|wireless)/.test(lower)) return 'wifi'
  if (/(ethernet|en\d|lan)/.test(lower)) return 'ethernet'
  if (/(vpn|tun|tap|tailscale|zerotier|wireguard)/.test(lower)) return 'vpn'
  return 'other'
}

function isPreferredPrivateLanAddress(host: string): boolean {
  return host.startsWith('192.168.')
}

function isHotspotOrSharedInterface(name: string): boolean {
  const lower = name.trim().toLowerCase()
  return /(wi-?fi direct|mobile hotspot|internet connection sharing|shared connection)/.test(lower) || /^(local area connection|本地连接)\*/.test(lower)
}

function scoreHost(candidate: TranscriptShareHost): number {
  let score = 0

  // In the user's sharing setup, peers typically reach the machine through a
  // 192.168.x.x private LAN address rather than a corporate/VPN 10.x.x.x one.
  if (isPreferredPrivateLanAddress(candidate.host)) {
    score += 1000
  }

  // Windows Mobile Hotspot / ICS adapters are still a strong hint when multiple
  // 192.168.x.x addresses exist.
  if (isHotspotOrSharedInterface(candidate.interfaceName)) {
    score += 250
  }

  switch (candidate.kind) {
    case 'wifi':
      score += 400
      break
    case 'ethernet':
      score += 350
      break
    case 'other':
      score += 250
      break
    case 'vpn':
      score += 150
      break
    case 'virtual':
      score += 25
      break
  }

  if (candidate.host.startsWith('192.168.')) score += 40
  else if (candidate.host.startsWith('10.')) score += 35
  else if (/^172\.(1[6-9]|2\d|3[01])\./.test(candidate.host)) score += 30

  if (candidate.host.startsWith('169.254.')) score -= 500

  return score
}

export function listLanHosts(readNetworkInterfaces: LanNetworkInterfacesReader): TranscriptShareHost[] {
  let interfaces: Record<string, ReadonlyArray<LanNetworkInterfaceInfo> | undefined>
  try {
    interfaces = readNetworkInterfaces()
  } catch {
    return [{ host: '127.0.0.1', interfaceName: 'loopback', kind: 'other' }]
  }
  const candidates: CandidateHost[] = []
  const seen = new Set<string>()
  for (const [interfaceName, list] of Object.entries(interfaces)) {
    if (!list) continue
    for (const net of list) {
      if (net.family !== 'IPv4' || net.internal) continue
      if (!net.address || seen.has(net.address)) continue
      seen.add(net.address)

      const candidate: TranscriptShareHost = {
        host: net.address,
        interfaceName,
        kind: classifyInterface(interfaceName),
      }
      candidates.push({
        ...candidate,
        score: scoreHost(candidate),
      })
    }
  }

  const sorted = candidates
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (a.kind !== b.kind) return a.kind.localeCompare(b.kind)
      if (a.interfaceName !== b.interfaceName) return a.interfaceName.localeCompare(b.interfaceName)
      return a.host.localeCompare(b.host)
    })
    .map(({ host, interfaceName, kind }) => ({ host, interfaceName, kind }))

  if (sorted.length > 0) return sorted
  return [{ host: '127.0.0.1', interfaceName: 'loopback', kind: 'other' }]
}

export function pickPrimaryLanAddress(hosts: TranscriptShareHost[]): string {
  return hosts[0]?.host || '127.0.0.1'
}

// 网关/分享对外公布的可访问地址：通配监听（0.0.0.0 / ::）时返回本机局域网 IPv4，否则原样返回绑定 host。
export function resolveAdvertisedHost(bindHost: string, readNetworkInterfaces: LanNetworkInterfacesReader): string {
  const isWildcard = bindHost === '0.0.0.0' || bindHost === '::' || bindHost === '[::]'
  if (!isWildcard) return bindHost
  return pickPrimaryLanAddress(listLanHosts(readNetworkInterfaces))
}
