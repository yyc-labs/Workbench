import { spawn } from 'child_process'
import { access, constants as FsConstants } from 'fs'
import { shell } from 'electron'
import { wslBridge } from '../wsl-bridge'

function normalizePathValue(pathValue: string): string {
  return pathValue.trim().replace(/\\/g, '/')
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
