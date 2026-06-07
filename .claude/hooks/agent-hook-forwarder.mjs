#!/usr/bin/env node

const provider = process.argv[2] || 'claude-code'
const eventName = process.argv[3] || 'unknown'
const endpoint = process.env.AGENT_HOOK_GATEWAY_URL
  || `http://${process.env.AGENT_HOOK_GATEWAY_HOST || '127.0.0.1'}:${process.env.AGENT_HOOK_GATEWAY_PORT || '17373'}/hooks/${provider}?event=${encodeURIComponent(eventName)}`
const token = process.env.AGENT_HOOK_TOKEN || ''
const timeoutMs = Number(process.env.AGENT_HOOK_TIMEOUT_MS || '1800')

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

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { 'x-agent-hook-token': token } : {}),
      },
      body,
      signal: controller.signal,
    })
  } catch {
    // Hooks are observe-only in this project; gateway outages must not block Claude Code.
  } finally {
    clearTimeout(timeout)
  }
}

main()
  .catch(() => undefined)
  .finally(() => {
    process.exit(0)
  })
