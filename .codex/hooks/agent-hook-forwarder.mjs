#!/usr/bin/env node

import { execFileSync } from 'child_process'

const provider = process.argv[2] || 'codex-cli'
const eventName = process.argv[3] || 'unknown'
const port = process.env.AGENT_HOOK_GATEWAY_PORT || '17373'
const token = process.env.AGENT_HOOK_TOKEN || ''
const timeoutMs = Number(process.env.AGENT_HOOK_TIMEOUT_MS || '1800')

for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
  delete process.env[key]
}

function getGatewayPath() {
  return `/hooks/${provider}?event=${encodeURIComponent(eventName)}`
}

function getWslGatewayHost() {
  try {
    const output = execFileSync('sh', ['-lc', "ip route show default 2>/dev/null | awk '{print $3; exit}'"], {
      encoding: 'utf8',
      timeout: 500,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return output.trim()
  } catch {
    return ''
  }
}

async function getEndpointCandidates() {
  if (process.env.AGENT_HOOK_GATEWAY_URL) {
    return [process.env.AGENT_HOOK_GATEWAY_URL]
  }

  const hosts = [
    process.env.AGENT_HOOK_GATEWAY_HOST,
    '127.0.0.1',
    getWslGatewayHost(),
  ].filter(Boolean)

  return Array.from(new Set(hosts)).map((host) => (
    `http://${host}:${port}${getGatewayPath()}`
  ))
}

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function main() {
  const raw = await readStdin()
  let payload = {}

  try {
    payload = raw.trim() ? JSON.parse(raw) : {}
  } catch {
    payload = { raw }
  }

  const body = JSON.stringify({
    provider,
    eventName,
    cwd: process.cwd(),
    payload,
  })

  for (const endpoint of await getEndpointCandidates()) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { 'x-agent-hook-token': token } : {}),
        },
        body,
        signal: controller.signal,
      })
      if (response.ok || response.status === 204) return
    } catch {
      // Try the next candidate below.
    } finally {
      clearTimeout(timeout)
    }
  }
}

main()
  .catch(() => undefined)
  .finally(() => {
    process.exit(0)
  })
