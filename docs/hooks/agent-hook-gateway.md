# Agent Hook Gateway

The Electron main process starts a local hook ingress at:

```text
http://0.0.0.0:17373
```

Routes:

- `GET /health`
- `POST /hooks/claude-code`
- `POST /hooks/codex-cli`

Transcript import API is documented separately:

- `docs/hooks/transcript-import-api.md`

The gateway normalizes Claude Code and Codex CLI lifecycle payloads into
`AgentHookEnvelope`, keeps the latest 200 events in memory, and broadcasts new
events to the renderer over `agent-hook:event`.

## Codex CLI

Project-local Codex hooks are configured in `.codex/hooks.json`.

Codex runs command hooks only, so `.codex/hooks/agent-hook-forwarder.mjs` reads
the hook JSON from stdin and forwards it to the gateway. The forwarder exits
successfully even when the gateway is not running.

After changing hooks, open `/hooks` in Codex and trust the project hooks.

## Claude Code

Use `.claude/settings.hooks.example.json` as the project hook template. Merge the
`hooks` object into your active Claude Code settings file if you want Claude Code
events to appear in the gateway.

The example uses the same command-forwarder approach as Codex:
`.claude/hooks/agent-hook-forwarder.mjs`.

## Security

The gateway listens on `0.0.0.0` by default so WSL-based hooks can reach the
Windows-side Electron process. If `agentHooks.token` is configured in the app
config, hook requests must send:

```text
X-Agent-Hook-Token: <token>
```

The request body is capped at 256 KB by default. The first version is
observe-only and does not block agent execution.

## Manual Test

Start the app, open Settings -> Agent Hooks, then post a test event:

```bash
curl -sS -X POST \
  'http://127.0.0.1:17373/hooks/codex-cli?event=UserPromptSubmit' \
  -H 'content-type: application/json' \
  -d '{"eventName":"UserPromptSubmit","cwd":"/tmp","payload":{"prompt":"hello"}}'
```

The event should appear in the Agent Hooks panel.
