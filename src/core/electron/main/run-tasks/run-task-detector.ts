import * as fs from 'fs'
import * as path from 'path'
import { globSync } from 'glob'
import * as yaml from 'js-yaml'
import type { RunTaskCandidate, RunTaskCandidateSource, RunTaskReadiness } from '../../../shared/runTasks'

/**
 * Read-only scan of a project to propose runnable tasks. This module never
 * executes anything: it only parses package.json / docker-compose.yml /
 * workspace manifests and probes well-known directories.
 */

const MAX_SCAN_DIRS = 500

const DEV_SCRIPT_PATTERN = /^(dev|start|serve|develop)(:[\w.-]+)?$/

const IGNORED_DIR_NAMES = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'venv', '.venv', 'out', 'release', 'coverage', '.cache', '__pycache__', '.idea', '.vscode'])

const COMMON_TASK_DIRS = ['server', 'backend', 'apps', 'packages', 'services', 'api', 'client', 'frontend', 'web']

const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']

interface PackageJsonLite {
  name?: string
  scripts?: Record<string, string>
  workspaces?: unknown
}

export function detectRunTaskCandidates(projectPath: string, scanDirectories?: string[]): RunTaskCandidate[] {
  const root = path.resolve(projectPath)
  if (!isDirectory(root)) return []

  const collected: RunTaskCandidate[] = []
  const seenCommandKeys = new Set<string>()
  let scannedDirs = 0

  const pushCandidate = (source: RunTaskCandidateSource, name: string, command: string, cwd: string | undefined, sourceLabel: string, suggestedReadiness: RunTaskReadiness): void => {
    const commandKey = `${cwd ?? ''}::${command}`
    if (seenCommandKeys.has(commandKey)) return
    seenCommandKeys.add(commandKey)
    collected.push({
      key: `${source}::${cwd ?? ''}::${command}`,
      name,
      command,
      cwd,
      source,
      sourceLabel,
      suggestedReadiness,
    })
  }

  const canScan = () => ++scannedDirs <= MAX_SCAN_DIRS

  scanWorkspaces(root, pushCandidate, canScan)
  scanPackageScripts(root, pushCandidate, canScan)
  scanDockerCompose(root, pushCandidate)
  scanCommonDirs(root, pushCandidate)
  scanUserDirectories(root, scanDirectories, pushCandidate, canScan)

  return collected
}

// ── source: user-selected scan directories ───────────────

/**
 * Probe each user-selected directory (project-relative) the same way common
 * dirs are probed: package.json scripts in the directory and its first-level
 * children, plus go/python sub-project detection. Paths escaping the project
 * root are ignored.
 */
function scanUserDirectories(root: string, scanDirectories: string[] | undefined, push: PushCandidate, canScan: () => boolean): void {
  if (!scanDirectories || scanDirectories.length === 0) return

  for (const entry of scanDirectories) {
    const relative = toPosix(entry).replace(/^\/+|\/+$/g, '')
    if (!relative || relative.split('/').some((segment) => !segment || segment === '.' || segment === '..')) continue
    const dir = path.resolve(root, ...relative.split('/'))
    const normalizedRoot = path.resolve(root)
    if (dir !== normalizedRoot && !dir.startsWith(normalizedRoot + path.sep)) continue
    if (!isDirectory(dir)) continue

    const relativeCwd = toPosix(path.relative(normalizedRoot, dir))

    // Package scripts in the directory itself and its first-level children.
    const pushFromDir = (target: string, cwdPrefix: string | undefined): void => {
      const pkg = readPackageJson(target)
      const script = findDevScript(target, pkg)
      if (!script) return
      const pkgName = cwdPrefix ? pkg?.name || cwdPrefix : pkg?.name || 'App'
      push('package-script', pkgName, script.command, cwdPrefix, `${cwdPrefix ? `${cwdPrefix}/` : ''}package.json scripts.${script.name}`, { strategy: 'url' })
    }
    pushFromDir(dir, relativeCwd)
    if (!canScan()) return
    for (const childEntry of listChildDirs(dir)) {
      if (!canScan()) return
      pushFromDir(path.join(dir, childEntry), `${relativeCwd}/${childEntry}`)
    }

    // Sub-project probes for the directory and its children.
    pushSubProjectCandidate(push, dir, relativeCwd)
    for (const childEntry of listChildDirs(dir)) {
      pushSubProjectCandidate(push, path.join(dir, childEntry), `${relativeCwd}/${childEntry}`)
    }
  }
}

type PushCandidate = (source: RunTaskCandidateSource, name: string, command: string, cwd: string | undefined, sourceLabel: string, suggestedReadiness: RunTaskReadiness) => void

// ── source: monorepo workspaces ──────────────────────────

function scanWorkspaces(root: string, push: PushCandidate, canScan: () => boolean): void {
  if (!canScan()) return
  const patterns = collectWorkspacePatterns(root)
  if (patterns.length === 0) return

  for (const pattern of patterns) {
    if (!canScan()) return
    let matches: string[]
    try {
      matches = globSync(pattern, { cwd: root, nodir: false })
    } catch {
      continue
    }
    for (const match of matches) {
      if (!canScan()) return
      const dir = path.join(root, match)
      if (!isDirectory(dir)) continue
      const pkg = readPackageJson(dir)
      const script = findDevScript(dir, pkg)
      if (!script) continue
      const pkgName = pkg?.name || path.basename(dir)
      push('workspace', pkgName, script.command, toPosix(match), `${toPosix(match)}/package.json scripts.${script.name}`, { strategy: 'url' })
    }
  }
}

function collectWorkspacePatterns(root: string): string[] {
  const patterns: string[] = []

  const pnpmWorkspace = path.join(root, 'pnpm-workspace.yaml')
  if (isFile(pnpmWorkspace)) {
    try {
      const parsed = yaml.load(fs.readFileSync(pnpmWorkspace, 'utf8')) as { packages?: unknown } | null
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.packages)) {
        for (const item of parsed.packages) {
          if (typeof item === 'string' && item.trim()) patterns.push(item.trim())
        }
      }
    } catch {
      // unreadable yaml — skip this source
    }
  }

  const rootPkg = readPackageJson(root)
  if (rootPkg && Array.isArray(rootPkg.workspaces)) {
    for (const item of rootPkg.workspaces) {
      if (typeof item === 'string' && item.trim()) patterns.push(item.trim())
    }
  }

  return patterns
}

// ── source: package.json scripts ─────────────────────────

function scanPackageScripts(root: string, push: PushCandidate, canScan: () => boolean): void {
  const pushFromDir = (dir: string, relativeCwd: string | undefined): void => {
    const pkg = readPackageJson(dir)
    const script = findDevScript(dir, pkg)
    if (!script) return
    const pkgName = relativeCwd ? pkg?.name || relativeCwd : pkg?.name || 'App'
    push('package-script', pkgName, script.command, relativeCwd, `${relativeCwd ? `${relativeCwd}/` : ''}package.json scripts.${script.name}`, { strategy: 'url' })
  }

  pushFromDir(root, undefined)

  for (const entry of listChildDirs(root)) {
    if (!canScan()) return
    const child = path.join(root, entry)
    if (isFile(path.join(child, 'package.json'))) {
      pushFromDir(child, entry)
    }
  }
}

// ── source: docker-compose ───────────────────────────────

function scanDockerCompose(root: string, push: PushCandidate): void {
  for (const fileName of COMPOSE_FILES) {
    const filePath = path.join(root, fileName)
    if (!isFile(filePath)) continue

    let services: string[]
    try {
      const parsed = yaml.load(fs.readFileSync(filePath, 'utf8')) as { services?: unknown } | null
      if (!parsed || typeof parsed !== 'object' || !parsed.services || typeof parsed.services !== 'object') continue
      services = Object.keys(parsed.services as Record<string, unknown>).filter((key) => Boolean(key))
    } catch {
      continue
    }
    if (services.length === 0) continue

    const label = `${fileName} services`
    for (const service of services) {
      push('docker-compose', service, `docker compose up -d ${service}`, undefined, label, { strategy: 'exit' })
    }
    push('docker-compose', 'Docker', 'docker compose up -d', undefined, label, { strategy: 'exit' })
    return // first matching compose file wins
  }
}

// ── source: well-known directories ───────────────────────

function scanCommonDirs(root: string, push: PushCandidate): void {
  for (const entry of COMMON_TASK_DIRS) {
    const dir = path.join(root, entry)
    if (!isDirectory(dir)) continue
    for (const childEntry of listChildDirs(dir)) {
      const child = path.join(dir, childEntry)
      const relativeCwd = `${entry}/${childEntry}`
      pushSubProjectCandidate(push, child, relativeCwd)
    }
    pushSubProjectCandidate(push, dir, entry)
  }
}

function pushSubProjectCandidate(push: PushCandidate, dir: string, relativeCwd: string): void {
  if (isFile(path.join(dir, 'package.json'))) {
    const pkg = readPackageJson(dir)
    const script = findDevScript(dir, pkg)
    if (script) {
      push('common-dir', pkg?.name || path.basename(dir), script.command, relativeCwd, `${relativeCwd}/package.json scripts.${script.name}`, { strategy: 'url' })
      return
    }
  }

  if (isFile(path.join(dir, 'go.mod'))) {
    push('common-dir', path.basename(dir), 'go run .', relativeCwd, `${relativeCwd}/go.mod`, { strategy: 'url' })
    return
  }

  const isPython = isFile(path.join(dir, 'requirements.txt')) || isFile(path.join(dir, 'pyproject.toml'))
  if (isPython) {
    const entryFile = isFile(path.join(dir, 'main.py')) ? 'main.py' : isFile(path.join(dir, 'app.py')) ? 'app.py' : null
    if (entryFile) {
      push('common-dir', path.basename(dir), `python ${entryFile}`, relativeCwd, `${relativeCwd}/${entryFile}`, { strategy: 'url' })
    }
  }
}

// ── shared helpers ───────────────────────────────────────

interface DevScript {
  name: string
  command: string
}

function findDevScript(dir: string, pkg: PackageJsonLite | null): DevScript | null {
  if (!pkg?.scripts) return null
  const runner = inferRunnerForDir(dir)
  const names = Object.keys(pkg.scripts)
  // Prefer canonical names first so e.g. scripts.dev wins over scripts.dev:local.
  const preferred = ['dev', 'start', 'serve', 'develop']
  for (const name of preferred) {
    if (names.includes(name)) {
      return { name, command: `${runner} ${name}` }
    }
  }
  for (const name of names) {
    if (DEV_SCRIPT_PATTERN.test(name)) {
      return { name, command: `${runner} ${name}` }
    }
  }
  return null
}

/**
 * Pick the script runner from the nearest lockfile (pnpm/yarn), walking up a
 * few levels so monorepo sub-packages inherit the root package manager. A
 * pnpm-workspace.yaml also implies the pnpm runner even before a lockfile
 * exists.
 */
function inferRunnerForDir(dir: string): string {
  let current = dir
  for (let depth = 0; depth < 4; depth += 1) {
    if (isFile(path.join(current, 'pnpm-lock.yaml')) || isFile(path.join(current, 'pnpm-workspace.yaml'))) return 'pnpm run'
    if (isFile(path.join(current, 'yarn.lock'))) return 'yarn'
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return 'npm run'
}

function readPackageJson(dir: string): PackageJsonLite | null {
  const filePath = path.join(dir, 'package.json')
  if (!isFile(filePath)) return null
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as PackageJsonLite
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

function listChildDirs(dir: string): string[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((item) => item.isDirectory() && !item.name.startsWith('.') && !IGNORED_DIR_NAMES.has(item.name))
    .map((item) => item.name)
    .sort()
}

function toPosix(value: string): string {
  return value.replace(/\\/g, '/')
}

function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory()
  } catch {
    return false
  }
}

function isFile(target: string): boolean {
  try {
    return fs.statSync(target).isFile()
  } catch {
    return false
  }
}
