import { spawnSync } from 'child_process'

export type WindowsShellKind = 'pwsh' | 'powershell' | 'cmd'
export type WindowsPowerShellKind = Exclude<WindowsShellKind, 'cmd'>

type WindowsShellAvailabilityResolver = (kind: WindowsShellKind) => boolean

export type ResolvedWindowsTerminalShell = {
  kind: WindowsShellKind
  command: string
}

export type ResolvedWindowsPowerShell = {
  kind: WindowsPowerShellKind
  command: string
}

export type WindowsTerminalShellLaunch =
  | {
    shell: ResolvedWindowsTerminalShell
    args: string[]
  }
  | {
    shell?: undefined
    args: string[]
  }

const WINDOWS_SHELL_COMMANDS: Record<WindowsShellKind, string> = {
  pwsh: 'pwsh.exe',
  powershell: 'powershell.exe',
  cmd: 'cmd.exe',
}

const terminalResolutionCache = new Map<WindowsShellKind, ResolvedWindowsTerminalShell>()
const automationResolutionCache = new Map<WindowsShellKind, ResolvedWindowsTerminalShell>()
const powerShellResolutionCache = new Map<WindowsPowerShellKind, ResolvedWindowsPowerShell>()
const availabilityCache = new Map<WindowsShellKind, boolean>()

function normalizeWindowsShellPreference(shell?: string): WindowsShellKind {
  if (shell === 'cmd') return 'cmd'
  if (shell === 'powershell') return 'powershell'
  return 'pwsh'
}

function normalizeWindowsPowerShellPreference(shell?: string): WindowsPowerShellKind {
  return shell === 'powershell' ? 'powershell' : 'pwsh'
}

function normalizeWindowsAutomationShellPreference(shell?: string): WindowsShellKind {
  if (shell === 'powershell') return 'powershell'
  if (shell === 'pwsh') return 'pwsh'
  return 'cmd'
}

function buildTerminalResolutionOrder(preferred: WindowsShellKind): WindowsShellKind[] {
  switch (preferred) {
    case 'cmd':
      return ['cmd', 'pwsh', 'powershell']
    case 'powershell':
      return ['powershell', 'pwsh', 'cmd']
    default:
      return ['pwsh', 'powershell', 'cmd']
  }
}

function buildPowerShellResolutionOrder(preferred: WindowsPowerShellKind): WindowsPowerShellKind[] {
  return preferred === 'powershell'
    ? ['powershell', 'pwsh']
    : ['pwsh', 'powershell']
}

function buildAutomationResolutionOrder(preferred: WindowsShellKind): WindowsShellKind[] {
  switch (preferred) {
    case 'powershell':
      return ['powershell', 'pwsh', 'cmd']
    case 'pwsh':
      return ['pwsh', 'powershell', 'cmd']
    default:
      return ['cmd', 'pwsh', 'powershell']
  }
}

function probeWindowsShellAvailability(kind: WindowsShellKind): boolean {
  const cached = availabilityCache.get(kind)
  if (typeof cached === 'boolean') return cached

  const result = spawnSync(
    WINDOWS_SHELL_COMMANDS[kind],
    kind === 'cmd'
      ? ['/d', '/c', 'exit 0']
      : ['-NoLogo', '-NoProfile', '-Command', 'exit 0'],
    {
      windowsHide: true,
      stdio: 'ignore',
      timeout: 3000,
    }
  )
  const available = !result.error && result.status === 0
  availabilityCache.set(kind, available)
  return available
}

function resolveTerminalShellWith(
  preferredShell: string | undefined,
  availability: WindowsShellAvailabilityResolver,
): ResolvedWindowsTerminalShell {
  const preferred = normalizeWindowsShellPreference(preferredShell)
  for (const kind of buildTerminalResolutionOrder(preferred)) {
    if (availability(kind)) {
      return {
        kind,
        command: WINDOWS_SHELL_COMMANDS[kind],
      }
    }
  }

  return {
    kind: 'cmd',
    command: WINDOWS_SHELL_COMMANDS.cmd,
  }
}

function resolvePowerShellWith(
  preferredShell: string | undefined,
  availability: WindowsShellAvailabilityResolver,
): ResolvedWindowsPowerShell {
  const preferred = normalizeWindowsPowerShellPreference(preferredShell)
  for (const kind of buildPowerShellResolutionOrder(preferred)) {
    if (availability(kind)) {
      return {
        kind,
        command: WINDOWS_SHELL_COMMANDS[kind],
      }
    }
  }

  return {
    kind: 'powershell',
    command: WINDOWS_SHELL_COMMANDS.powershell,
  }
}

function resolveAutomationShellWith(
  preferredShell: string | undefined,
  availability: WindowsShellAvailabilityResolver,
): ResolvedWindowsTerminalShell {
  const preferred = normalizeWindowsAutomationShellPreference(preferredShell)
  for (const kind of buildAutomationResolutionOrder(preferred)) {
    if (availability(kind)) {
      return {
        kind,
        command: WINDOWS_SHELL_COMMANDS[kind],
      }
    }
  }

  return {
    kind: 'cmd',
    command: WINDOWS_SHELL_COMMANDS.cmd,
  }
}

export function preferredWindowsShellForDiagnostics(shell?: string): WindowsShellKind {
  if (shell === 'cmd') return 'cmd'
  if (shell === 'powershell') return 'powershell'
  return 'pwsh'
}

export function resolveWindowsTerminalShell(
  preferredShell?: string,
  availability?: WindowsShellAvailabilityResolver,
): ResolvedWindowsTerminalShell {
  if (availability) {
    return resolveTerminalShellWith(preferredShell, availability)
  }

  const preferred = normalizeWindowsShellPreference(preferredShell)
  const cached = terminalResolutionCache.get(preferred)
  if (cached) return cached

  const resolved = resolveTerminalShellWith(preferredShell, probeWindowsShellAvailability)
  terminalResolutionCache.set(preferred, resolved)
  return resolved
}

export function resolveWindowsPowerShell(
  preferredShell?: string,
  availability?: WindowsShellAvailabilityResolver,
): ResolvedWindowsPowerShell {
  if (availability) {
    return resolvePowerShellWith(preferredShell, availability)
  }

  const preferred = normalizeWindowsPowerShellPreference(preferredShell)
  const cached = powerShellResolutionCache.get(preferred)
  if (cached) return cached

  const resolved = resolvePowerShellWith(preferredShell, probeWindowsShellAvailability)
  powerShellResolutionCache.set(preferred, resolved)
  return resolved
}

export function resolveWindowsAutomationShell(
  preferredShell?: string,
  availability?: WindowsShellAvailabilityResolver,
): ResolvedWindowsTerminalShell {
  if (availability) {
    return resolveAutomationShellWith(preferredShell, availability)
  }

  const preferred = normalizeWindowsAutomationShellPreference(preferredShell)
  const cached = automationResolutionCache.get(preferred)
  if (cached) return cached

  const resolved = resolveAutomationShellWith(preferredShell, probeWindowsShellAvailability)
  automationResolutionCache.set(preferred, resolved)
  return resolved
}

export function buildWindowsTerminalShellLaunch(
  command: string,
  options?: {
    preferredShell?: string
    availability?: WindowsShellAvailabilityResolver
  },
): {
  shell: ResolvedWindowsTerminalShell
  args: string[]
}
export function buildWindowsTerminalShellLaunch(
  command?: undefined,
  options?: {
    preferredShell?: string
    availability?: WindowsShellAvailabilityResolver
  },
): {
  shell?: undefined
  args: string[]
}
export function buildWindowsTerminalShellLaunch(
  command: string | undefined,
  options?: {
    preferredShell?: string
    availability?: WindowsShellAvailabilityResolver
  },
): WindowsTerminalShellLaunch
export function buildWindowsTerminalShellLaunch(
  command?: string,
  options?: {
    preferredShell?: string
    availability?: WindowsShellAvailabilityResolver
  },
): WindowsTerminalShellLaunch {
  const trimmed = command?.trim()

  if (!trimmed) {
    return {
      args: [],
    }
  }

  const shell = resolveWindowsTerminalShell(options?.preferredShell, options?.availability)
  if (shell.kind === 'cmd') {
    return {
      shell,
      args: ['/d', '/k', trimmed],
    }
  }

  return {
    shell,
    args: ['-NoLogo', '-NoExit', '-Command', trimmed],
  }
}

export function buildWindowsTerminalTabArgs(
  cwd: string,
  command?: string,
  options?: {
    preferredShell?: string
    availability?: WindowsShellAvailabilityResolver
  },
): string[] {
  const launch = buildWindowsTerminalShellLaunch(command, options)
  if (!launch.shell) {
    return ['-d', cwd]
  }

  return ['-d', cwd, launch.shell.command, ...launch.args]
}

export function buildWindowsAutomationShellLaunch(
  command: string,
  options?: {
    preferredShell?: string
    availability?: WindowsShellAvailabilityResolver
  },
): {
  shell: ResolvedWindowsTerminalShell
  args: string[]
} {
  const shell = resolveWindowsAutomationShell(options?.preferredShell, options?.availability)

  if (shell.kind === 'cmd') {
    return {
      shell,
      args: ['/d', '/c', command],
    }
  }

  return {
    shell,
    args: ['-NoLogo', '-NoProfile', '-Command', command],
  }
}
