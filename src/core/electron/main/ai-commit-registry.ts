import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import type { AiCommitTaskSnapshot } from '../../shared/types'

interface AiCommitRegistry {
  entries: Record<string, AiCommitTaskSnapshot>
}

const REGISTRY_FILE = 'ai-commit-registry.json'
const MAX_OUTPUT_CHARS = 1_000_000

function getRegistryPath(): string {
  return join(app.getPath('userData'), REGISTRY_FILE)
}

function normalizeEntry(entry: AiCommitTaskSnapshot): AiCommitTaskSnapshot {
  return {
    ...entry,
    output: trimOutput(entry.output || ''),
    updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : Date.now(),
    startedAt: Number.isFinite(entry.startedAt) ? entry.startedAt : Date.now(),
  }
}

function trimOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) return output
  return output.slice(output.length - MAX_OUTPUT_CHARS)
}

function loadRegistry(): AiCommitRegistry {
  const filePath = getRegistryPath()
  try {
    const raw = readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<AiCommitRegistry>
    const entries = parsed.entries && typeof parsed.entries === 'object'
      ? Object.fromEntries(
        Object.entries(parsed.entries).map(([projectId, entry]) => [
          projectId,
          normalizeEntry(entry as AiCommitTaskSnapshot),
        ])
      )
      : {}

    return { entries }
  } catch {
    return { entries: {} }
  }
}

function saveRegistry(registry: AiCommitRegistry): void {
  const filePath = getRegistryPath()
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(filePath, JSON.stringify(registry, null, 2), 'utf-8')
}

export function getAiCommitTask(projectId: string): AiCommitTaskSnapshot | undefined {
  return loadRegistry().entries[projectId]
}

export function upsertAiCommitTask(task: AiCommitTaskSnapshot): AiCommitTaskSnapshot {
  const registry = loadRegistry()
  const normalized = normalizeEntry(task)
  registry.entries[task.projectId] = normalized
  saveRegistry(registry)
  return normalized
}

export function appendAiCommitTaskOutput(projectId: string, chunk: string): AiCommitTaskSnapshot | undefined {
  const registry = loadRegistry()
  const task = registry.entries[projectId]
  if (!task) return undefined

  const next: AiCommitTaskSnapshot = {
    ...task,
    output: trimOutput((task.output || '') + chunk),
    updatedAt: Date.now(),
  }

  registry.entries[projectId] = next
  saveRegistry(registry)
  return next
}
