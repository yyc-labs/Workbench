import type { IncomingMessage, ServerResponse } from 'http'
import type { JsonObject } from './protocol-types'

export type HeaderValue = string | string[] | undefined

export function jsonResponse(res: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

export function emptyResponse(res: ServerResponse, statusCode: number): void {
  res.writeHead(statusCode)
  res.end()
}

export function writeSseHeaders(res: ServerResponse): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })
  res.socket?.setNoDelay(true)
  res.flushHeaders?.()
}

export function readRequestBody(req: IncomingMessage, maxBodyBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    let bytes = 0
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      bytes += Buffer.byteLength(chunk)
      if (bytes > maxBodyBytes) {
        reject(new Error('REQUEST_BODY_TOO_LARGE'))
        req.destroy()
        return
      }
      body += chunk
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

export function parseJsonBody(rawBody: string): JsonObject {
  if (!rawBody.trim()) return {}
  const parsed = JSON.parse(rawBody) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Request body must be a JSON object.')
  }
  return parsed as JsonObject
}

export function getHeaderValue(headers: Record<string, HeaderValue>, name: string): string | undefined {
  const value = headers[name]
  if (Array.isArray(value)) {
    return value.find((item) => typeof item === 'string' && item.trim())?.trim()
  }
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function getContentType(headers: Record<string, HeaderValue>): string | undefined {
  return getHeaderValue(headers, 'content-type')
}

export function getResponseContentType(response: Response): string | undefined {
  return response.headers.get('content-type') || undefined
}
