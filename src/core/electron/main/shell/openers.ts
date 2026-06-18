import { spawn } from 'child_process'
import { access, appendFileSync, constants as FsConstants } from 'fs'
import { shell } from 'electron'
import { tmpdir } from 'os'
import { join } from 'path'
import { wslBridge } from '../wsl-bridge'

const SSH_TERMINAL_DEBUG_LOG = join(tmpdir(), 'ide-electron-open-ssh.log')
const SSH_TERMINAL_DEBUG_TEXT_LIMIT = 240
const WSL_GB18030_DECODER = new TextDecoder('gb18030', { fatal: false })

function appendSshTerminalDebugLog(event: string, details?: Record<string, unknown>): void {
  try {
    appendFileSync(
      SSH_TERMINAL_DEBUG_LOG,
      `${JSON.stringify({
        ts: new Date().toISOString(),
        event,
        ...details,
      })}\n`,
      'utf8'
    )
  } catch {
    // Debug logging must never block terminal launch.
  }
}

function normalizePathValue(pathValue: string): string {
  return pathValue.trim().replace(/\\/g, '/')
}

function previewSshTerminalDebugText(text: string | null | undefined, maxLength = SSH_TERMINAL_DEBUG_TEXT_LIMIT): string | undefined {
  if (!text) return undefined
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength)}...(${text.length} chars)`
}

function previewSshTerminalDebugError(error: unknown): string {
  return previewSshTerminalDebugText(error instanceof Error ? error.message : String(error)) ?? ''
}

export function describeWslCommandForDebug(command: string): string {
  const normalized = command.trim()
  if (
    normalized.includes('ide-electron-ssh.')
    && normalized.includes('base64 -d >')
  ) {
    return '[redacted: write WSL SSH temp script via base64]'
  }
  return previewSshTerminalDebugText(normalized) ?? ''
}

export function resolveWslVsCodeTarget(
  pathValue: string,
  defaultDistro: string
): { distro: string; linuxPath: string } | null {
  const normalized = normalizePathValue(pathValue)
  if (!normalized) return null

  const uncWsl = normalized.match(/^\/\/(?:wsl\.localhost|wsl\$)\/([^/]+)\/?(.*)$/i)
  if (uncWsl) {
    const distro = uncWsl[1]
    const rest = uncWsl[2] ?? ''
    const linuxPath = rest ? `/${rest.replace(/^\/+/, '')}` : '/'
    return { distro, linuxPath }
  }

  if (/^[a-z]:?(?:\/|$)/i.test(normalized)) {
    return null
  }

  if (/^\/\/(?!wsl\.localhost\/|wsl\$\/)/i.test(normalized)) {
    return null
  }

  if (normalized.startsWith('/')) {
    if (/^\/mnt\/[a-z](?:\/|$)/i.test(normalized)) {
      return null
    }
    return {
      distro: defaultDistro,
      linuxPath: normalized,
    }
  }

  const noLeadingSlash = normalized.replace(/^\/+/, '')
  if (/^mnt\/[a-z](?:\/|$)/i.test(noLeadingSlash)) {
    return null
  }

  return null
}

function resolveLocalVsCodePath(pathValue: string): string {
  const normalized = normalizePathValue(pathValue)
  if (!normalized) return pathValue

  const noLeadingSlash = normalized.replace(/^\/+/, '')
  if (/^mnt\/[a-z](?:\/|$)/i.test(noLeadingSlash)) {
    return wslBridge.toWindowsPath(`/${noLeadingSlash}`)
  }

  return pathValue
}

function toWslAuthority(distro: string): string {
  return `wsl+${distro}`
}

function asFolderPath(pathValue: string): string {
  return pathValue.endsWith('/') ? pathValue : `${pathValue}/`
}

function quoteBashSingle(input: string): string {
  return input.replace(/'/g, "'\\''")
}

function looksLikeUtf16Le(buffer: Buffer): boolean {
  if (buffer.length < 2) return false
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return true

  let sampledPairs = 0
  let zeroHighBytes = 0

  for (let index = 0; index + 1 < buffer.length; index += 2) {
    sampledPairs += 1
    if (buffer[index] !== 0 && buffer[index + 1] === 0) {
      zeroHighBytes += 1
    }
  }

  return sampledPairs > 0 && zeroHighBytes / sampledPairs >= 0.25
}

function countReplacementChars(text: string): number {
  return (text.match(/�/g) || []).length
}

function decodeWslProcessOutputChunk(buffer: Buffer): string {
  if (buffer.length === 0) return ''

  if (looksLikeUtf16Le(buffer)) {
    return buffer.toString('utf16le').replace(/^\uFEFF/, '').replace(/\u0000/g, '')
  }

  const utf8Text = buffer.toString('utf8')
  const utf8BadCount = countReplacementChars(utf8Text)
  if (utf8BadCount === 0) {
    return utf8Text
  }

  const gb18030Text = WSL_GB18030_DECODER.decode(buffer)
  return countReplacementChars(gb18030Text) < utf8BadCount ? gb18030Text : utf8Text
}

export function decodeWslProcessOutput(input: Buffer | Buffer[]): string {
  const chunks = Array.isArray(input) ? input : [input]
  if (chunks.length === 0) return ''
  return chunks.map((chunk) => decodeWslProcessOutputChunk(chunk)).join('')
}

function execWslBash(
  distro: string,
  cmd: string,
  timeoutMs: number,
  options?: {
    debugLabel?: string
    debugCommand?: string
  }
): Promise<string> {
  const debugLabel = options?.debugLabel ?? 'wsl-command'
  const debugCommand = describeWslCommandForDebug(options?.debugCommand ?? cmd)
  const startedAt = Date.now()
  appendSshTerminalDebugLog('wsl-bash:start', {
    distro,
    label: debugLabel,
    timeoutMs,
    command: debugCommand,
  })

  return new Promise((resolve, reject) => {
    const child = spawn('wsl.exe', ['-d', distro, '--', 'bash', '-lc', cmd], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let settled = false
    let timedOut = false

    const resolveOnce = (value: string) => {
      if (settled) return
      settled = true
      resolve(value)
    }

    const rejectOnce = (error: Error) => {
      if (settled) return
      settled = true
      reject(error)
    }

    child.on('spawn', () => {
      appendSshTerminalDebugLog('wsl-bash:spawned', {
        distro,
        label: debugLabel,
        command: debugCommand,
        pid: child.pid ?? null,
      })
    })

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutChunks.push(Buffer.from(chunk))
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(Buffer.from(chunk))
    })

    const timer = setTimeout(() => {
      timedOut = true
      appendSshTerminalDebugLog('wsl-bash:timeout', {
        distro,
        label: debugLabel,
        timeoutMs,
        command: debugCommand,
        pid: child.pid ?? null,
      })
      child.kill('SIGTERM')
      rejectOnce(new Error(`WSL command timed out after ${timeoutMs}ms: ${cmd}`))
    }, timeoutMs)

    child.on('close', (code, signal) => {
      clearTimeout(timer)
      const stdoutBuffer = Buffer.concat(stdoutChunks)
      const stderrBuffer = Buffer.concat(stderrChunks)
      const stdout = decodeWslProcessOutput(stdoutChunks).trim()
      const stderr = decodeWslProcessOutput(stderrChunks).trim()
      appendSshTerminalDebugLog('wsl-bash:closed', {
        distro,
        label: debugLabel,
        command: debugCommand,
        pid: child.pid ?? null,
        code,
        signal,
        timedOut,
        elapsedMs: Date.now() - startedAt,
        stdoutBytes: stdoutBuffer.length,
        stderrBytes: stderrBuffer.length,
        stdoutPreview: previewSshTerminalDebugText(stdout),
        stderrPreview: previewSshTerminalDebugText(stderr),
      })
      if (timedOut) return
      if (code === 0) {
        resolveOnce(stdout)
      } else {
        rejectOnce(new Error(stderr || stdout || `WSL command exited with code ${code}: ${cmd}`))
      }
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      appendSshTerminalDebugLog('wsl-bash:spawn-error', {
        distro,
        label: debugLabel,
        command: debugCommand,
        elapsedMs: Date.now() - startedAt,
        message: previewSshTerminalDebugText(err.message),
      })
      rejectOnce(new Error(`Failed to spawn wsl.exe: ${err.message}`))
    })
  })
}

export function buildWslSshRunnerScript(payload: {
  host: string
  port: number
  username: string
  password: string
}): string {
  const escapedPassword = quoteBashSingle(payload.password)
  const escapedHost = quoteBashSingle(payload.host)
  const escapedUser = quoteBashSingle(payload.username)
  const escapedPort = quoteBashSingle(String(payload.port))

  return [
    '#!/usr/bin/env bash',
    'rm -f -- "$0"',
    "expect_script=$(mktemp /tmp/ide-electron-ssh-expect.XXXXXX.exp)",
    "cleanup() {",
    '  rm -f -- "$expect_script"',
    '}',
    'trap cleanup EXIT',
    `export IDE_ELECTRON_SSH_USER='${escapedUser}'`,
    `export IDE_ELECTRON_SSH_HOST='${escapedHost}'`,
    `export IDE_ELECTRON_SSH_PORT='${escapedPort}'`,
    `export IDE_ELECTRON_SSH_PASS='${escapedPassword}'`,
    "cat > \"$expect_script\" <<'EOF_EXPECT'",
    'set timeout -1',
    'set ssh_user $env(IDE_ELECTRON_SSH_USER)',
    'set ssh_host $env(IDE_ELECTRON_SSH_HOST)',
    'set ssh_port $env(IDE_ELECTRON_SSH_PORT)',
    'set ssh_pass $env(IDE_ELECTRON_SSH_PASS)',
    'spawn ssh -o StrictHostKeyChecking=accept-new -p $ssh_port $ssh_user@$ssh_host',
    'expect {',
    '  -re "(?i)yes/no" { send "yes\\r"; exp_continue }',
    '  -re "(?i)password:" { send "$ssh_pass\\r" }',
    '}',
    'interact',
    'EOF_EXPECT',
    'expect "$expect_script"',
    'unset IDE_ELECTRON_SSH_USER IDE_ELECTRON_SSH_HOST IDE_ELECTRON_SSH_PORT IDE_ELECTRON_SSH_PASS',
    'exec bash -i',
    '',
  ].join('\n')
}

export function buildWslTempScriptPathCommand(): string {
  return 'mktemp /tmp/ide-electron-ssh.XXXXXX.sh'
}

export function buildWslTempScriptWriteCommand(scriptPath: string, scriptContent: string): string {
  const encodedScript = Buffer.from(scriptContent, 'utf8').toString('base64')
  const escapedScript = quoteBashSingle(encodedScript)
  const escapedPath = quoteBashSingle(scriptPath)
  const quotedPath = `'${escapedPath}'`

  return [
    `printf %s '${escapedScript}' | base64 -d > ${quotedPath}`,
    `chmod 700 ${quotedPath}`,
    `test -s ${quotedPath} || { echo "WSL SSH temp script is empty: ${scriptPath}" >&2; exit 1; }`,
  ].join(' && ')
}

async function writeWslTempScript(distro: string, scriptContent: string): Promise<string> {
  const scriptPath = await execWslBash(distro, buildWslTempScriptPathCommand(), 5000, {
    debugLabel: 'create-temp-script-path',
  })
  await execWslBash(distro, buildWslTempScriptWriteCommand(scriptPath, scriptContent), 5000, {
    debugLabel: 'write-temp-script',
  })
  return scriptPath
}

export function buildWtWslExecArgs(distro: string, commandArgs: string[]): string[] {
  // Match the working WSL terminal launch pattern used elsewhere in the app.
  // Starting the commandline with `wsl` avoids `wt new-tab` re-parsing `-d`.
  return ['wsl', '-d', distro, '--', ...commandArgs]
}

type RequestedSshRoute = 'wsl' | 'windows'

export function resolveSshOpenRoute(
  requestedRoute: RequestedSshRoute | null | undefined,
  platform: NodeJS.Platform = process.platform
): 'wsl' | 'native' {
  if (platform === 'win32') {
    return requestedRoute === 'windows' ? 'native' : 'wsl'
  }

  return 'native'
}

export function buildNativeSshCommand(payload: {
  host: string
  port: number
  username: string
}): string {
  const target = `${payload.username}@${payload.host}`
  return payload.port !== 22 ? `ssh -p ${payload.port} ${target}` : `ssh ${target}`
}

export type OpenSshTerminalFailureReason =
  | 'invalid-input'
  | 'windows-host-required'
  | 'wsl-not-installed'
  | 'wsl-distro-unavailable'
  | 'wsl-bash-unavailable'
  | 'wsl-expect-unavailable'
  | 'terminal-launch-failed'

type OpenSshTerminalResult = {
  ok: boolean
  mode: 'wsl-expect' | 'native-ssh'
  autoLogin: boolean
  message?: string
  reason?: OpenSshTerminalFailureReason
}

function quoteAppleScriptString(input: string): string {
  return input.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

async function openPosixSshTerminal(sshCommand: string): Promise<{ ok: boolean; message?: string }> {
  const interactiveCommand = `${sshCommand}; exec bash -i`

  if (process.platform === 'darwin') {
    const appleScript = [
      'tell application "Terminal"',
      'activate',
      `do script "${quoteAppleScriptString(interactiveCommand)}"`,
      'end tell',
    ]
    const child = spawn('osascript', appleScript.flatMap((line) => ['-e', line]), {
      detached: true,
      stdio: 'ignore',
    })

    return await new Promise((resolve) => {
      child.on('error', (err) => {
        resolve({
          ok: false,
          message: err.message,
        })
      })
      child.on('spawn', () => {
        child.unref()
        resolve({ ok: true })
      })
    })
  }

  const child = spawn('x-terminal-emulator', ['-e', 'bash', '-lc', interactiveCommand], {
    detached: true,
    stdio: 'ignore',
  })

  return await new Promise((resolve) => {
    child.on('error', (err) => {
      resolve({
        ok: false,
        message: err.message,
      })
    })
    child.on('spawn', () => {
      child.unref()
      resolve({ ok: true })
    })
  })
}

async function verifyWslExpectReady(distro: string): Promise<void> {
  appendSshTerminalDebugLog('openSshTerminal:wsl-verify-start', {
    distro,
    platform: process.platform,
  })
  if (process.platform !== 'win32') {
    appendSshTerminalDebugLog('openSshTerminal:wsl-verify-failed', {
      distro,
      reason: 'windows-host-required',
    })
    throw new Error('WSL SSH route is only available on Windows hosts.')
  }

  try {
    await execWslBash(distro, 'true', 5000, {
      debugLabel: 'verify-wsl-distro',
    })
    appendSshTerminalDebugLog('openSshTerminal:wsl-verify-step-ok', {
      distro,
      step: 'verify-wsl-distro',
    })
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error)
    const normalized = raw.toLowerCase()
    appendSshTerminalDebugLog('openSshTerminal:wsl-verify-step-failed', {
      distro,
      step: 'verify-wsl-distro',
      message: previewSshTerminalDebugText(raw),
    })
    if (normalized.includes('failed to spawn wsl.exe') || normalized.includes('enoent')) {
      throw new Error('WSL_NOT_INSTALLED')
    }
    if (
      normalized.includes('there is no distribution with the supplied name')
      || normalized.includes('distribution was not found')
      || normalized.includes('specified distribution')
      || ((raw.includes('分发') || raw.includes('发行版')) && (raw.includes('不存在') || raw.includes('找不到')))
    ) {
      throw new Error('WSL_DISTRO_UNAVAILABLE')
    }
    throw error
  }

  try {
    await execWslBash(distro, 'command -v bash >/dev/null', 5000, {
      debugLabel: 'verify-bash',
    })
    appendSshTerminalDebugLog('openSshTerminal:wsl-verify-step-ok', {
      distro,
      step: 'verify-bash',
    })
  } catch {
    appendSshTerminalDebugLog('openSshTerminal:wsl-verify-step-failed', {
      distro,
      step: 'verify-bash',
    })
    throw new Error('WSL_BASH_UNAVAILABLE')
  }

  try {
    await execWslBash(distro, 'command -v expect >/dev/null', 5000, {
      debugLabel: 'verify-expect',
    })
    appendSshTerminalDebugLog('openSshTerminal:wsl-verify-step-ok', {
      distro,
      step: 'verify-expect',
    })
  } catch {
    appendSshTerminalDebugLog('openSshTerminal:wsl-verify-step-failed', {
      distro,
      step: 'verify-expect',
    })
    throw new Error('WSL_EXPECT_UNAVAILABLE')
  }

  appendSshTerminalDebugLog('openSshTerminal:wsl-verify-ready', {
    distro,
  })
}

export function mapWslSshFailure(distro: string, error: unknown): {
  reason: OpenSshTerminalFailureReason
  message: string
} {
  const raw = error instanceof Error ? error.message : String(error)

  if (raw.includes('WSL SSH temp script is empty') || raw.includes('mktemp:')) {
    return {
      reason: 'terminal-launch-failed',
      message: `WSL SSH failed to create a temporary login script in distro "${distro}". ${raw}`,
    }
  }

  switch (raw) {
    case 'WSL_NOT_INSTALLED':
      return {
        reason: 'wsl-not-installed',
        message: 'WSL SSH is unavailable because `wsl.exe` is not available on this host.',
      }
    case 'WSL_DISTRO_UNAVAILABLE':
      return {
        reason: 'wsl-distro-unavailable',
        message: `WSL SSH is unavailable because distro "${distro}" was not found.`,
      }
    case 'WSL_BASH_UNAVAILABLE':
      return {
        reason: 'wsl-bash-unavailable',
        message: `WSL SSH is unavailable because bash is not available in distro "${distro}".`,
      }
    case 'WSL_EXPECT_UNAVAILABLE':
      return {
        reason: 'wsl-expect-unavailable',
        message: `WSL SSH is unavailable because \`expect\` is not installed in distro "${distro}".`,
      }
    case 'WSL SSH route is only available on Windows hosts.':
      return {
        reason: 'windows-host-required',
        message: 'WSL SSH route is only available on Windows hosts.',
      }
    default:
      return {
        reason: 'terminal-launch-failed',
        message: raw
          ? `WSL SSH failed in distro "${distro}". ${raw}`
          : `WSL SSH failed in distro "${distro}".`,
      }
  }
}

function spawnVsCode(args: string[], onError?: (err: Error) => void): void {
  const spawnWith = (
    cmd: string,
    spawnArgs: string[],
    fallback?: () => void
  ) => {
    const child = spawn(cmd, spawnArgs, {
      detached: true,
      shell: false,
      windowsHide: true,
      stdio: 'ignore',
    })

    child.on('error', (err) => {
      console.error(`[open-vscode] failed command="${cmd}" args=${JSON.stringify(spawnArgs)} error=${err.message}`)
      if (fallback) {
        fallback()
      } else {
        onError?.(err)
      }
    })

    child.unref()
  }

  if (process.platform === 'win32') {
    spawnWith(
      'cmd.exe',
      ['/d', '/s', '/c', 'code.cmd', ...args],
      () => spawnWith('code', args)
    )
    return
  }

  spawnWith('code', args)
}

function spawnVsCodeViaWsl(distro: string, linuxFolder: string): void {
  const escapedPath = quoteBashSingle(linuxFolder)
  const command = `cd '${escapedPath}' && code .`
  const child = spawn(
    'wsl.exe',
    ['-d', distro, '--', 'bash', '-lc', command],
    {
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
    }
  )
  child.on('error', (err) => {
    console.error(`[open-vscode] wsl fallback failed distro="${distro}" path="${linuxFolder}" error=${err.message}`)
  })
  child.unref()
}

export function openVsCode(folderPath: string, defaultDistro: string): void {
  const wslTarget = resolveWslVsCodeTarget(folderPath, defaultDistro)
  if (wslTarget) {
    const distro = wslTarget.distro
    const linuxFolder = asFolderPath(wslTarget.linuxPath)
    const remoteArgs = ['--remote', toWslAuthority(distro), linuxFolder]
    spawnVsCode(remoteArgs, () => {
      spawnVsCodeViaWsl(distro, linuxFolder)
    })
    return
  }

  const localPath = resolveLocalVsCodePath(folderPath)
  spawnVsCode([localPath])
}

export function openFolder(folderPath: string, revealPath?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const normalizedRevealPath = typeof revealPath === 'string' ? revealPath.trim() : ''
    if (normalizedRevealPath) {
      access(normalizedRevealPath, FsConstants.F_OK, (error) => {
        if (!error) {
          shell.showItemInFolder(normalizedRevealPath)
          resolve()
          return
        }

        shell.openPath(folderPath)
          .then((err) => {
            if (err) {
              reject(new Error(`Failed to open folder: ${err}`))
              return
            }
            resolve()
          })
          .catch(reject)
      })
      return
    }

    shell.openPath(folderPath)
      .then((err) => {
        if (err) {
          reject(new Error(`Failed to open folder: ${err}`))
          return
        }
        resolve()
      })
      .catch(reject)
  })
}

export function openTerminalAtPath(
  folderPath: string,
  defaultDistro: string,
  command?: string
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const trimmedCommand = command?.trim()
    const wslTarget = resolveWslVsCodeTarget(folderPath, defaultDistro)
    if (process.platform === 'win32' && wslTarget) {
      const wslArgs = trimmedCommand
        ? [
          'wsl',
          '-d',
          wslTarget.distro,
          '--cd',
          wslTarget.linuxPath,
          '--',
          'bash',
          '-lc',
          `${trimmedCommand}; exec bash -i`,
        ]
        : ['wsl', '-d', wslTarget.distro, '--cd', wslTarget.linuxPath]
      const child = spawn(
        'wt.exe',
        wslArgs,
        {
          detached: true,
          stdio: 'ignore',
        }
      )

      child.on('error', (err) => {
        console.error('[path-terminal] spawn wsl terminal failed:', err.message)
        resolve(false)
      })

      child.on('spawn', () => resolve(true))
      child.unref()
      return
    }

    const localPath = resolveLocalVsCodePath(folderPath)
    const localArgs = trimmedCommand
      ? ['-d', localPath, 'cmd.exe', '/k', trimmedCommand]
      : ['-d', localPath]
    const child = spawn('wt.exe', localArgs, {
      detached: true,
      stdio: 'ignore',
    })

    child.on('error', (err) => {
      console.error('[path-terminal] spawn local terminal failed:', err.message)
      resolve(false)
    })

    child.on('spawn', () => resolve(true))
    child.unref()
  })
}

export async function openSshTerminal(
  defaultDistro: string,
  payload: {
    host: string
    port?: number
    username: string
    password?: string | null
    route?: 'wsl' | 'windows'
  }
): Promise<OpenSshTerminalResult> {
  const host = payload.host.trim()
  const username = payload.username.trim()
  const port = Number.isInteger(payload.port) && Number(payload.port) > 0 ? Number(payload.port) : 22
  const password = payload.password?.trim() || ''
  const requestedRoute: RequestedSshRoute = payload.route === 'windows' ? 'windows' : 'wsl'
  const resolvedRoute = resolveSshOpenRoute(requestedRoute)

  appendSshTerminalDebugLog('openSshTerminal:start', {
    defaultDistro,
    host,
    username,
    port,
    route: requestedRoute,
    resolvedRoute,
    hasPassword: Boolean(password),
    platform: process.platform,
    logPath: SSH_TERMINAL_DEBUG_LOG,
  })

  if (!host || !username) {
    appendSshTerminalDebugLog('openSshTerminal:invalid-input', {
      hostPresent: Boolean(host),
      usernamePresent: Boolean(username),
    })
    return {
      ok: false,
      mode: 'native-ssh',
      autoLogin: false,
      message: 'SSH host and username are required.',
      reason: 'invalid-input',
    }
  }

  if (requestedRoute !== resolvedRoute) {
    appendSshTerminalDebugLog('openSshTerminal:route-adjusted', {
      requestedRoute,
      resolvedRoute,
      platform: process.platform,
    })
  }

  if (resolvedRoute === 'wsl') {
    appendSshTerminalDebugLog('openSshTerminal:wsl-availability', {
      wslAvailable: process.platform === 'win32' && wslBridge.isAvailable(),
      route: requestedRoute,
      defaultDistro,
    })
    try {
      await verifyWslExpectReady(defaultDistro)
      appendSshTerminalDebugLog('openSshTerminal:expect-found', { defaultDistro })
      const runnerScript = buildWslSshRunnerScript({
        host,
        port,
        username,
        password,
      })
      appendSshTerminalDebugLog('openSshTerminal:script-built', {
        defaultDistro,
        scriptBytesUtf8: Buffer.byteLength(runnerScript, 'utf8'),
        scriptLineCount: runnerScript.split('\n').length,
      })
      const scriptPath = await writeWslTempScript(
        defaultDistro,
        runnerScript
      )
      const scriptBytes = await execWslBash(
        defaultDistro,
        `wc -c < '${quoteBashSingle(scriptPath)}'`,
        5000,
        {
          debugLabel: 'inspect-temp-script-bytes',
        }
      ).catch(() => '')
      const wtArgs = buildWtWslExecArgs(defaultDistro, ['bash', scriptPath])
      appendSshTerminalDebugLog('openSshTerminal:script-written', {
        defaultDistro,
        scriptPath,
        scriptBytes,
        wtArgs,
      })
      const child = spawn(
        'wt.exe',
        wtArgs,
        {
          detached: true,
          stdio: 'ignore',
        }
      )

      return await new Promise((resolve) => {
        child.on('error', (err) => {
          appendSshTerminalDebugLog('openSshTerminal:wt-spawn-error', {
            mode: 'wsl-expect',
            defaultDistro,
            wtArgs,
            message: err.message,
          })
          resolve({
            ok: false,
            mode: 'wsl-expect',
            autoLogin: false,
            message: err.message,
            reason: 'terminal-launch-failed',
          })
        })
        child.on('spawn', () => {
          appendSshTerminalDebugLog('openSshTerminal:wt-spawned', {
            mode: 'wsl-expect',
            defaultDistro,
            wtArgs,
            pid: child.pid ?? null,
          })
          child.on('close', (code, signal) => {
            appendSshTerminalDebugLog('openSshTerminal:wt-closed', {
              mode: 'wsl-expect',
              defaultDistro,
              wtArgs,
              pid: child.pid ?? null,
              code,
              signal,
            })
          })
          child.unref()
          resolve({
            ok: true,
            mode: 'wsl-expect',
            autoLogin: true,
          })
        })
      })
    } catch (error) {
      const { reason, message } = mapWslSshFailure(defaultDistro, error)
      appendSshTerminalDebugLog('openSshTerminal:wsl-expect-failed', {
        defaultDistro,
        reason,
        message,
        rawError: previewSshTerminalDebugError(error),
      })
      return {
        ok: false,
        mode: 'wsl-expect',
        autoLogin: false,
        message,
        reason,
      }
    }
  }

  const sshCommand = buildNativeSshCommand({ host, port, username })
  if (process.platform !== 'win32') {
    appendSshTerminalDebugLog('openSshTerminal:native-launch', {
      sshCommand,
      platform: process.platform,
      terminalCommand: process.platform === 'darwin' ? 'osascript' : 'x-terminal-emulator',
    })
    const launchResult = await openPosixSshTerminal(sshCommand)
    if (!launchResult.ok) {
      appendSshTerminalDebugLog('openSshTerminal:terminal-spawn-error', {
        mode: 'native-ssh',
        message: launchResult.message,
        platform: process.platform,
      })
      return {
        ok: false,
        mode: 'native-ssh',
        autoLogin: false,
        message: launchResult.message,
        reason: 'terminal-launch-failed',
      }
    }

    appendSshTerminalDebugLog('openSshTerminal:terminal-spawned', {
      mode: 'native-ssh',
      platform: process.platform,
    })
    return {
      ok: true,
      mode: 'native-ssh',
      autoLogin: false,
    }
  }

  const localArgs = ['-d', '.', 'cmd.exe', '/k', sshCommand]
  appendSshTerminalDebugLog('openSshTerminal:native-launch', {
    sshCommand,
    wtArgs: localArgs,
  })
  const child = spawn('wt.exe', localArgs, {
    detached: true,
    stdio: 'ignore',
  })

  return await new Promise((resolve) => {
    child.on('error', (err) => {
      appendSshTerminalDebugLog('openSshTerminal:wt-spawn-error', {
        mode: 'native-ssh',
        message: err.message,
      })
      resolve({
        ok: false,
        mode: 'native-ssh',
        autoLogin: false,
        message: err.message,
        reason: 'terminal-launch-failed',
      })
    })
    child.on('spawn', () => {
      appendSshTerminalDebugLog('openSshTerminal:wt-spawned', {
        mode: 'native-ssh',
        route: requestedRoute,
      })
      child.unref()
      resolve({
        ok: true,
        mode: 'native-ssh',
        autoLogin: false,
        message: undefined,
      })
    })
  })
}
