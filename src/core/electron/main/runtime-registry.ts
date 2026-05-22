import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import type { RuntimeRegistry, RuntimeEntry } from '../../shared/types'

const REGISTRY_FILE = 'runtime-registry.json'

function getRegistryPath(): string {
  return join(app.getPath('userData'), REGISTRY_FILE)
}

function loadRegistry(): RuntimeRegistry {
  const p = getRegistryPath()
  try {
    const raw = readFileSync(p, 'utf-8')
    return JSON.parse(raw) as RuntimeRegistry
  } catch {
    return { entries: {} }
  }
}

function saveRegistry(registry: RuntimeRegistry): void {
  const p = getRegistryPath()
  const dir = dirname(p)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(p, JSON.stringify(registry, null, 2), 'utf-8')
}

export function getRuntimeEntry(projectId: string): RuntimeEntry | undefined {
  return loadRegistry().entries[projectId]
}

export function setRuntimeEntry(entry: RuntimeEntry): void {
  const reg = loadRegistry()
  reg.entries[entry.projectId] = { ...entry, lastOpened: Date.now() }
  saveRegistry(reg)
}

export function listRuntimeEntries(): RuntimeEntry[] {
  return Object.values(loadRegistry().entries)
}

export function removeRuntimeEntry(projectId: string): void {
  const reg = loadRegistry()
  delete reg.entries[projectId]
  saveRegistry(reg)
}
