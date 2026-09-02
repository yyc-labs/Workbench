import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { networkInterfaces, type NetworkInterfaceInfo } from 'os'
import { fileURLToPath } from 'url'
import type { TranscriptShareBindingMode, TranscriptShareEntry, TranscriptShareHost, TranscriptShareListResult, TranscriptShareStartPayload, TranscriptShareStartResult } from '../../../shared/types'
import { listLanHosts, pickPrimaryLanAddress } from '../../../shared/lanHosts'

const SHARE_PORT = 17374
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const TOKEN_PATTERN = /^[a-f0-9-]{16,}$/i

type StoredShare = {
  entry: TranscriptShareEntry
  html: string
}

type ShareHttpServerLike = {
  once: (event: 'error', listener: (error: Error) => void) => void
  listen: (port: number, host: string, callback: () => void) => void
  address: () => { port: number } | string | null
  close: (callback: () => void) => void
}

type TranscriptShareServiceOptions = {
  networkInterfaces?: () => NodeJS.Dict<NetworkInterfaceInfo[]>
  port?: number
  preferredListenHosts?: string[]
  createServer?: (handler: (req: IncomingMessage, res: ServerResponse) => void) => ShareHttpServerLike
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function imageMimeFromPath(filePath: string): string {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  if (lower.endsWith('.bmp')) return 'image/bmp'
  return 'application/octet-stream'
}

async function inlineImages(html: string, images: TranscriptShareStartPayload['images']): Promise<string> {
  if (!images || images.length === 0) return html
  let result = html
  for (const image of images) {
    if (!image?.placeholder || !image.fileUrl) continue
    let dataUri = ''
    try {
      const filePath = fileURLToPath(image.fileUrl)
      const stat = await fs.stat(filePath)
      if (stat.size <= MAX_IMAGE_BYTES) {
        const buffer = await fs.readFile(filePath)
        dataUri = `data:${imageMimeFromPath(filePath)};base64,${buffer.toString('base64')}`
      }
    } catch {
      dataUri = ''
    }
    // Replace every occurrence of the placeholder; fall back to empty src on failure.
    result = result.split(image.placeholder).join(dataUri)
  }
  return result
}

export interface TranscriptShareService {
  start: (payload: TranscriptShareStartPayload) => Promise<TranscriptShareStartResult>
  stop: (token: string) => TranscriptShareListResult
  list: () => TranscriptShareListResult
  shutdown: () => Promise<void>
}

export function createTranscriptShareService(options: TranscriptShareServiceOptions = {}): TranscriptShareService {
  const readNetworkInterfaces = options.networkInterfaces || networkInterfaces
  const createShareServer = options.createServer || ((handler) => createServer(handler))
  const shares = new Map<string, StoredShare>()
  let server: ShareHttpServerLike | null = null
  let activePort = Number.isInteger(options.port) ? Number(options.port) : SHARE_PORT
  let activeHosts = listLanHosts(readNetworkInterfaces)
  let activeHost = pickPrimaryLanAddress(activeHosts)
  let activeBindingMode: TranscriptShareBindingMode = activeHost === '127.0.0.1' ? 'loopback' : 'lan'

  const renderPage = (share: StoredShare): string => share.html

  const handleRequest = (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url || '/', 'http://localhost')
    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('ok')
      return
    }

    const match = /^\/t\/([^/]+)\/?$/.exec(url.pathname)
    if (req.method !== 'GET' || !match) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('Not found')
      return
    }

    const token = decodeURIComponent(match[1] || '')
    const share = TOKEN_PATTERN.test(token) ? shares.get(token) : undefined
    if (!share) {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' })
      res.end(`<!doctype html><meta charset="utf-8"><title>404</title><body style="font-family:system-ui;padding:48px;color:#555">${escapeHtml('链接已失效或不存在 / Link expired or not found')}</body>`)
      return
    }

    const body = renderPage(share)
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': Buffer.byteLength(body),
      'cache-control': 'no-store',
    })
    res.end(body)
  }

  const preferredListenHosts = options.preferredListenHosts && options.preferredListenHosts.length > 0 ? options.preferredListenHosts : ['0.0.0.0', '127.0.0.1']

  const setBoundHosts = (listenHost: string): void => {
    const hosts = listLanHosts(readNetworkInterfaces)
    if (listenHost === '127.0.0.1') {
      activeBindingMode = 'loopback'
      activeHosts = [{ host: '127.0.0.1', interfaceName: 'loopback', kind: 'other' }]
      activeHost = '127.0.0.1'
      return
    }

    activeBindingMode = 'lan'
    activeHosts = hosts
    activeHost = pickPrimaryLanAddress(hosts)
  }

  const listenOnHost = (listenHost: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      const created = createShareServer(handleRequest)
      let settled = false

      const finalizeError = (error: unknown) => {
        if (settled) return
        settled = true
        reject(error)
      }

      created.once('error', (error) => {
        server = null
        finalizeError(error)
      })

      created.listen(activePort, listenHost, () => {
        if (settled) return
        settled = true
        server = created
        const address = created.address()
        if (address && typeof address === 'object' && Number.isInteger(address.port)) {
          activePort = address.port
        }
        setBoundHosts(listenHost)
        resolve()
      })
    })
  }

  const ensureServer = async (): Promise<void> => {
    if (server) return Promise.resolve()

    let lastError: unknown = null
    for (const host of preferredListenHosts) {
      try {
        await listenOnHost(host)
        return
      } catch (error) {
        lastError = error
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Transcript share server failed to bind to any listen host.')
  }

  const toListResult = (): TranscriptShareListResult => ({
    running: Boolean(server),
    host: activeHost,
    port: activePort,
    bindingMode: activeBindingMode,
    hosts: activeHosts,
    entries: Array.from(shares.values())
      .map((share) => share.entry)
      .sort((a, b) => b.createdAt - a.createdAt),
  })

  return {
    start: async (payload) => {
      const html = typeof payload.html === 'string' ? payload.html : ''
      if (!html.trim()) {
        throw new Error('Transcript share requires non-empty HTML.')
      }
      await ensureServer()

      const token = randomUUID().replace(/-/g, '')
      const inlinedHtml = await inlineImages(html, payload.images)
      const entry: TranscriptShareEntry = {
        token,
        projectId: typeof payload.projectId === 'string' ? payload.projectId : '',
        transcriptId: typeof payload.transcriptId === 'string' ? payload.transcriptId : '',
        title: typeof payload.title === 'string' ? payload.title : '',
        url: `http://${activeHost}:${activePort}/t/${token}`,
        createdAt: Date.now(),
      }
      shares.set(token, { entry, html: inlinedHtml })

      return {
        entry,
        host: activeHost,
        port: activePort,
        bindingMode: activeBindingMode,
        hosts: activeHosts,
      }
    },

    stop: (token) => {
      if (typeof token === 'string' && token) {
        shares.delete(token)
      }
      return toListResult()
    },

    list: () => toListResult(),

    shutdown: async () => {
      shares.clear()
      const current = server
      server = null
      if (!current) return
      await new Promise<void>((resolve) => {
        current.close(() => resolve())
      })
    },
  }
}
