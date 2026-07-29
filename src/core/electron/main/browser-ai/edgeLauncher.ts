import { mkdir } from 'fs/promises'
import { createServer } from 'net'
import { spawn, type ChildProcess } from 'child_process'
import { buildEdgeLaunchArgs, resolveBrowserAiProfilePath, resolveEdgeExecutablePath } from './browserAiConfig'
import type { BrowserAiConfig } from '../../../shared/types'
import { probeCdp } from './cdpConnection'

export async function findFreeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        if (!port) {
          reject(new Error('Unable to allocate a loopback port.'))
          return
        }
        resolve(port)
      })
    })
  })
}

export type EdgeLauncher = {
  start: (config: BrowserAiConfig, userDataPath: string, profileName?: string) => Promise<{ port: number; profilePath: string }>
  stop: () => Promise<void>
  isRunning: () => boolean
  getPort: () => number | undefined
  getProfilePath: () => string | undefined
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()

  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve()
    }
    const timeout = setTimeout(finish, timeoutMs)
    child.once('exit', finish)
  })
}

export function createEdgeLauncher(): EdgeLauncher {
  let child: ChildProcess | null = null
  let port: number | undefined
  let profilePath: string | undefined

  return {
    start: async (config, userDataPath, profileName) => {
      if (child && child.exitCode === null && child.signalCode === null && port && profilePath) {
        return { port, profilePath }
      }

      if (port && profilePath && (await probeCdp('127.0.0.1', port))) {
        return { port, profilePath }
      }

      port = undefined
      profilePath = undefined

      const executablePath = resolveEdgeExecutablePath(config)
      if (!executablePath) {
        throw new Error('Microsoft Edge executable was not found.')
      }

      const nextPort = await findFreeLoopbackPort()
      const nextProfilePath = resolveBrowserAiProfilePath(userDataPath, profileName)
      await mkdir(nextProfilePath, { recursive: true })
      const args = buildEdgeLaunchArgs(config, nextPort, nextProfilePath)
      const nextChild = spawn(executablePath, args, {
        detached: false,
        stdio: 'ignore',
        windowsHide: config.headless,
      })
      child = nextChild
      port = nextPort
      profilePath = nextProfilePath
      nextChild.once('exit', () => {
        if (child === nextChild) {
          child = null
        }
      })
      return { port: nextPort, profilePath: nextProfilePath }
    },

    stop: async () => {
      const current = child
      child = null
      port = undefined
      profilePath = undefined
      if (!current) return
      if (current.exitCode === null && current.signalCode === null) {
        current.kill()
        await waitForExit(current, 2_000)
      }
    },

    isRunning: () => Boolean(child && child.exitCode === null && child.signalCode === null),
    getPort: () => port,
    getProfilePath: () => profilePath,
  }
}
