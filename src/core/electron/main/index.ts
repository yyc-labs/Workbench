import { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } from 'electron'
import { join, basename } from 'path'
import { createHash } from 'crypto'
import { spawn } from 'child_process'
import { tmpdir } from 'os'
import { writeFileSync, unlinkSync } from 'fs'
import { constants as FsConstants } from 'fs'
import { access } from 'fs/promises'
import { StringDecoder } from 'string_decoder'
import { ProcessManager } from './runner'
import { detectProject } from './detector'
import { loadConfig, updateConfig } from './config'
import { IPC } from './ipc'
import { capabilityManager } from './capability-manager'
import { tmuxManager } from './tmux-manager'
import { wslBridge } from './wsl-bridge'
import { setRuntimeEntry, listRuntimeEntries, removeRuntimeEntry } from './runtime-registry'
import { getAiCommitTask, upsertAiCommitTask, appendAiCommitTaskOutput } from './ai-commit-registry'
import {
  listProjectFiles,
  searchProjectFiles,
  searchProjectContent,
  readProjectFile,
  statProjectFile,
  writeProjectFile,
  toProjectFileServiceErrorMessage,
} from './project-file-service'
import type {
  AiCommitTaskSnapshot,
  AiCommitRunOverride,
  Capability,
  AppConfig,
  GitBranchInfo,
  GitChangedFile,
  GitChangeKind,
  GitChangeScope,
  GitHistoryCommitInfo,
  GitOperationRequest,
  GitOperationResult,
  GitSetFileStageRequest,
  GitSetFileStageResult,
  GitFileDiffRequest,
  GitFileDiffResult,
  GitWorkspaceSnapshot,
  ProjectFileContentSearchOptions,
  RuntimeDiagnostics,
  TerminalProcessInventory,
  TerminalStopAllResult,
} from '../../shared/types'

let mainWindow: BrowserWindow | null = null
let processManager: ProcessManager | null = null
let bootCapability: Capability | null = null
const activeAiCommitProjects = new Set<string>()

type ThemeMode = AppConfig['theme']

function resolveEffectiveTheme(theme: ThemeMode): 'light' | 'dark' {
  if (theme === 'system') {
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  }
  return theme
}

function getWindowBackgroundColor(theme: ThemeMode): string {
  return resolveEffectiveTheme(theme) === 'dark' ? '#09090b' : '#f5f7fb'
}

function applyWindowBackground(theme: ThemeMode): void {
  if (!mainWindow) return
  mainWindow.setBackgroundColor(getWindowBackgroundColor(theme))
}

function sendAiCommitOutput(projectId: string, data: string): void {
  appendAiCommitTaskOutput(projectId, data)
  mainWindow?.webContents.send(IPC.AI_COMMIT_OUTPUT, { projectId, data })
}

function sendAiCommitStatus(projectId: string, status: 'running' | 'success' | 'error'): void {
  const current = getAiCommitTask(projectId)
  if (current) {
    const now = Date.now()
    upsertAiCommitTask({
      ...current,
      status,
      updatedAt: now,
      finishedAt: status === 'running' ? undefined : now,
    })
  }
  mainWindow?.webContents.send(IPC.AI_COMMIT_STATUS, { projectId, status })
}

function markAiCommitInterruptedIfOrphan(projectId: string): AiCommitTaskSnapshot | undefined {
  const task = getAiCommitTask(projectId)
  if (!task) return undefined
  if (task.status !== 'running') return task
  if (activeAiCommitProjects.has(projectId)) return task

  const now = Date.now()
  const interruptedLine = '[AI Commit] previous task interrupted: app process exited before completion.\r\n'
  const next = upsertAiCommitTask({
    ...task,
    status: 'error',
    output: `${task.output || ''}${interruptedLine}`,
    updatedAt: now,
    finishedAt: now,
  })

  mainWindow?.webContents.send(IPC.AI_COMMIT_OUTPUT, { projectId, data: interruptedLine })
  mainWindow?.webContents.send(IPC.AI_COMMIT_STATUS, { projectId, status: 'error' as const })
  return next
}

type RecentCommitInfo = GitHistoryCommitInfo

async function runAiCommit(
  projectId: string,
  projectPath: string,
  override?: AiCommitRunOverride
): Promise<boolean> {
  const existing = markAiCommitInterruptedIfOrphan(projectId)
  if (existing && existing.status === 'running') {
    sendAiCommitOutput(projectId, '[AI Commit] skipped: a commit task is already running for this project.\r\n')
    sendAiCommitStatus(projectId, 'running')
    return true
  }

  const now = Date.now()
  upsertAiCommitTask({
    projectId,
    projectPath,
    runId: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    status: 'running',
    output: '',
    startedAt: now,
    updatedAt: now,
    override,
  })
  activeAiCommitProjects.add(projectId)

  const config = loadConfig()
  const aiCfgRaw = config.aiCommit || {}
  const aiCfg = {
    ...aiCfgRaw,
    split: typeof override?.split === 'boolean' ? override.split : aiCfgRaw.split,
    splitMaxBatches: typeof override?.splitMaxBatches === 'number'
      ? override.splitMaxBatches
      : aiCfgRaw.splitMaxBatches,
    maxBullets: typeof override?.maxBullets === 'number'
      ? override.maxBullets
      : aiCfgRaw.maxBullets,
  }
  const wslPwshPath = (aiCfg.wslPwshPath || '').replace(/[\r\n]/g, '').trim() || '/snap/bin/pwsh'
  const splitEnabled = Boolean(aiCfg.split)
  const splitMaxBatches = Math.max(
    1,
    Math.min(
      12,
      Number.isFinite(aiCfg.splitMaxBatches)
        ? Math.trunc(aiCfg.splitMaxBatches as number)
        : 4
    )
  )
  const maxBullets = Math.max(
    1,
    Math.min(
      20,
      Number.isFinite(aiCfg.maxBullets)
        ? Math.trunc(aiCfg.maxBullets as number)
        : 8
    )
  )
  const scriptPs1Path = join(__dirname, '../../script/auto-git-commit/auto_commit.ps1')
  const scriptPs1WslPath = process.platform === 'win32' ? wslBridge.toWslPath(scriptPs1Path) : null
  const wslTarget = process.platform === 'win32' ? resolveWslVsCodeTarget(projectPath) : null

  sendAiCommitStatus(projectId, 'running')
  sendAiCommitOutput(projectId, `\r\n[AI Commit] Starting in ${projectPath}\r\n`)
  sendAiCommitOutput(
    projectId,
    `[AI Commit] mode: ${splitEnabled ? `split (max batches=${splitMaxBatches})` : 'single'}, max bullets=${maxBullets}\r\n`
  )

  return new Promise<boolean>((resolve) => {
    const windowsPsArgs = [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPs1Path,
      '-All',
    ]

    if (aiCfg.enabled ?? true) {
      windowsPsArgs.push('-UseAi')
    }
    if (splitEnabled) {
      windowsPsArgs.push('-Split', '-SplitMaxBatches', String(splitMaxBatches))
    }
    windowsPsArgs.push('-MaxBullets', String(maxBullets))

    if (aiCfg.apiBaseUrl && aiCfg.apiBaseUrl.trim()) {
      windowsPsArgs.push('-ApiBaseUrl', aiCfg.apiBaseUrl.trim())
    }
    if (aiCfg.apiKey && aiCfg.apiKey.trim()) {
      windowsPsArgs.push('-ApiKey', aiCfg.apiKey.trim())
    }
    if (aiCfg.model && aiCfg.model.trim()) {
      windowsPsArgs.push('-Model', aiCfg.model.trim())
    }

    const spawnWindowsPowerShell = (cmd: string) =>
      spawn(cmd, windowsPsArgs, {
        cwd: projectPath,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

    const quoteBash = (value: string) => `'${quoteBashSingle(value)}'`

    const spawnWslPowerShell = () => {
      if (!wslTarget || !scriptPs1WslPath) return spawnWindowsPowerShell('pwsh')

      const wslPwshArgs = [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPs1WslPath,
        '-All',
      ]
      if (aiCfg.enabled ?? true) {
        wslPwshArgs.push('-UseAi')
      }
      if (splitEnabled) {
        wslPwshArgs.push('-Split', '-SplitMaxBatches', String(splitMaxBatches))
      }
      wslPwshArgs.push('-MaxBullets', String(maxBullets))
      if (aiCfg.apiBaseUrl && aiCfg.apiBaseUrl.trim()) {
        wslPwshArgs.push('-ApiBaseUrl', aiCfg.apiBaseUrl.trim())
      }
      if (aiCfg.apiKey && aiCfg.apiKey.trim()) {
        wslPwshArgs.push('-ApiKey', aiCfg.apiKey.trim())
      }
      if (aiCfg.model && aiCfg.model.trim()) {
        wslPwshArgs.push('-Model', aiCfg.model.trim())
      }

      const preferredPwsh = quoteBash(wslPwshPath)
      const quotedArgs = wslPwshArgs.map((arg) => quoteBash(arg)).join(' ')
      const command = [
        'set -euo pipefail',
        `if [ -x ${preferredPwsh} ]; then`,
        `  echo "[AI Commit] wsl pwsh cmd: ${wslPwshPath}"`,
        `  exec ${preferredPwsh} ${quotedArgs}`,
        'else',
        '  echo "[AI Commit] wsl pwsh cmd: pwsh"',
        `  exec pwsh ${quotedArgs}`,
        'fi',
      ].join('\n')

      return spawn('wsl.exe', [
        '-d',
        wslTarget.distro,
        '--cd',
        wslTarget.linuxPath,
        '--',
        'bash',
        '-lc',
        command,
      ], {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    }

    let child = (() => {
      if (wslTarget) {
        return spawnWslPowerShell()
      }

      return spawnWindowsPowerShell('pwsh')
    })()

    let started = false
    const allowWindowsFallback = !wslTarget
    let switchedToWindowsPowerShell = false

    const stdoutDecoder = new StringDecoder('utf8')
    const stderrDecoder = new StringDecoder('utf8')

    const attachStreams = () => {
      child.stdout?.on('data', (buf: Buffer) => {
        const text = stdoutDecoder.write(buf)
        if (text) {
          sendAiCommitOutput(projectId, text.replace(/\r?\n/g, '\r\n'))
        }
      })

      child.stderr?.on('data', (buf: Buffer) => {
        const text = stderrDecoder.write(buf)
        if (text) {
          sendAiCommitOutput(projectId, text.replace(/\r?\n/g, '\r\n'))
        }
      })
    }

    child.on('spawn', () => {
      started = true
      sendAiCommitOutput(projectId, `[AI Commit] shell: ${wslTarget ? 'wsl-pwsh' : 'pwsh'}\r\n`)
      attachStreams()
    })

    child.on('error', (err) => {
      if (!started && allowWindowsFallback && !switchedToWindowsPowerShell) {
        switchedToWindowsPowerShell = true
        sendAiCommitOutput(projectId, `[AI Commit] pwsh unavailable, fallback to powershell.exe (${err.message})\r\n`)
        child = spawnWindowsPowerShell('powershell.exe')
        child.on('spawn', () => {
          sendAiCommitOutput(projectId, '[AI Commit] shell: powershell.exe\r\n')
          attachStreams()
        })
        child.on('error', (fallbackErr) => {
          sendAiCommitOutput(projectId, `[AI Commit] process error: ${fallbackErr.message}\r\n`)
          sendAiCommitStatus(projectId, 'error')
          activeAiCommitProjects.delete(projectId)
          resolve(false)
        })
        child.on('close', (code) => {
          const tailOut = stdoutDecoder.end()
          if (tailOut) {
            sendAiCommitOutput(projectId, tailOut.replace(/\r?\n/g, '\r\n'))
          }
          const tailErr = stderrDecoder.end()
          if (tailErr) {
            sendAiCommitOutput(projectId, tailErr.replace(/\r?\n/g, '\r\n'))
          }
          const ok = code === 0
          sendAiCommitOutput(projectId, `[AI Commit] finished with code ${code}\r\n`)
          sendAiCommitStatus(projectId, ok ? 'success' : 'error')
          activeAiCommitProjects.delete(projectId)
          resolve(ok)
        })
        return
      }
      sendAiCommitOutput(projectId, `[AI Commit] process error: ${err.message}\r\n`)
      sendAiCommitStatus(projectId, 'error')
      activeAiCommitProjects.delete(projectId)
      resolve(false)
    })

    child.on('close', (code) => {
      const tailOut = stdoutDecoder.end()
      if (tailOut) {
        sendAiCommitOutput(projectId, tailOut.replace(/\r?\n/g, '\r\n'))
      }
      const tailErr = stderrDecoder.end()
      if (tailErr) {
        sendAiCommitOutput(projectId, tailErr.replace(/\r?\n/g, '\r\n'))
      }
      const ok = code === 0
      sendAiCommitOutput(projectId, `[AI Commit] finished with code ${code}\r\n`)
      sendAiCommitStatus(projectId, ok ? 'success' : 'error')
      activeAiCommitProjects.delete(projectId)
      resolve(ok)
    })
  })
}

function runtimeLauncherScript(): string {
  return loadConfig().runtimeLauncherScript || '$HOME/tools/claude-code-script/start-claude-with-env.sh'
}

function expandWslHomePath(pathValue: string): string {
  const normalized = pathValue.trim()
  if (!normalized) return normalized

  const wslHome = bootCapability?.wslEnv?.HOME
  if (!wslHome) return normalized

  if (normalized === '~') return wslHome
  if (normalized.startsWith('~/')) return `${wslHome}/${normalized.slice(2)}`
  if (normalized === '$HOME') return wslHome
  if (normalized.startsWith('$HOME/')) return `${wslHome}/${normalized.slice(6)}`
  if (normalized === '${HOME}') return wslHome
  if (normalized.startsWith('${HOME}/')) return `${wslHome}/${normalized.slice(8)}`

  return normalized
}

function resolvedRuntimeLauncherScript(): string {
  return expandWslHomePath(runtimeLauncherScript())
}

function quoteBashSingle(input: string): string {
  return input.replace(/'/g, "'\\''")
}

function resolveWslVsCodeTarget(pathValue: string): { distro: string; linuxPath: string } | null {
  const normalized = pathValue.trim().replace(/\\/g, '/')
  if (!normalized) return null

  const uncWsl = normalized.match(/^\/\/(?:wsl\.localhost|wsl\$)\/([^/]+)\/?(.*)$/i)
  if (uncWsl) {
    const distro = uncWsl[1]
    const rest = uncWsl[2] ?? ''
    const linuxPath = rest ? `/${rest.replace(/^\/+/, '')}` : '/'
    return { distro, linuxPath }
  }

  if (normalized.startsWith('/')) {
    // /mnt/<drive>/... maps to Windows drives and should open locally.
    if (/^\/mnt\/[a-z](?:\/|$)/i.test(normalized)) {
      return null
    }
    return {
      distro: bootCapability?.wslDistro || 'Ubuntu',
      linuxPath: normalized,
    }
  }

  // Accept linux paths that miss the leading slash, e.g. "mnt/d/workspace".
  // These are Windows-mounted paths in WSL form and should open locally.
  const noLeadingSlash = normalized.replace(/^\/+/, '')
  if (/^mnt\/[a-z](?:\/|$)/i.test(noLeadingSlash)) {
    return null
  }

  return null
}

function emptyGitBranchInfo(): GitBranchInfo {
  return {
    current: '',
    ahead: 0,
    behind: 0,
    detached: false,
    localBranches: [],
    remoteBranches: [],
  }
}

function runGitCommand(cwd: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('git', args, {
      cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (buf: Buffer) => {
      stdout += buf.toString('utf8')
    })
    child.stderr?.on('data', (buf: Buffer) => {
      stderr += buf.toString('utf8')
    })

    child.on('error', (err) => {
      resolve({ code: null, stdout, stderr: stderr || err.message })
    })
    child.on('close', (code) => {
      resolve({ code, stdout, stderr })
    })
  })
}

function listGitLines(cwd: string, args: string[]): Promise<string[]> {
  return runGitCommand(cwd, args).then((result) => {
    if (result.code !== 0) return []
    return result.stdout
      .replace(/\r/g, '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  })
}

function remainderAfterTokens(record: string, tokenCount: number): string {
  let cursor = 0
  for (let index = 0; index < tokenCount; index++) {
    const nextSpace = record.indexOf(' ', cursor)
    if (nextSpace < 0) return ''
    cursor = nextSpace + 1
  }
  return record.slice(cursor)
}

function gitStatusToken(record: string, index: number): string {
  return record.split(' ')[index] || ''
}

function classifyGitChangeKind(indexStatus: string, worktreeStatus: string): GitChangeKind {
  if (indexStatus === '?' || worktreeStatus === '?') return 'untracked'
  if (indexStatus === 'U' || worktreeStatus === 'U') return 'conflicted'

  const status = [indexStatus, worktreeStatus].find((item) => item && item !== '.')
  switch (status) {
    case 'A':
      return 'added'
    case 'M':
      return 'modified'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'C':
      return 'copied'
    case 'T':
      return 'typechanged'
    default:
      return 'unknown'
  }
}

function classifyGitChangeScope(indexStatus: string, worktreeStatus: string): GitChangeScope {
  if (indexStatus === 'U' || worktreeStatus === 'U') return 'conflicted'
  if (indexStatus === '?' || worktreeStatus === '?') return 'untracked'
  if (indexStatus !== '.' && worktreeStatus === '.') return 'staged'
  return 'unstaged'
}

function createGitChangedFile(
  pathValue: string,
  indexStatus: string,
  worktreeStatus: string,
  originalPath?: string
): GitChangedFile | null {
  const path = pathValue.trim()
  if (!path) return null
  const staged = indexStatus !== '.' && indexStatus !== '?'
  const unstaged = worktreeStatus !== '.' && worktreeStatus !== '?' || indexStatus === '?' || worktreeStatus === '?'
  return {
    path,
    originalPath: originalPath?.trim() || undefined,
    indexStatus,
    worktreeStatus,
    kind: classifyGitChangeKind(indexStatus, worktreeStatus),
    scope: classifyGitChangeScope(indexStatus, worktreeStatus),
    staged,
    unstaged,
  }
}

function parseGitStatus(raw: string): { branch: GitBranchInfo; changedFiles: GitChangedFile[] } {
  const branch = emptyGitBranchInfo()
  const changedFiles: GitChangedFile[] = []
  const records = raw.replace(/\r/g, '').split('\x00').filter(Boolean)

  for (let index = 0; index < records.length; index++) {
    const record = records[index]

    if (record.startsWith('# branch.oid ')) {
      branch.oid = record.slice('# branch.oid '.length).trim()
      continue
    }
    if (record.startsWith('# branch.head ')) {
      const head = record.slice('# branch.head '.length).trim()
      branch.detached = head === '(detached)'
      branch.current = branch.detached ? 'DETACHED' : head
      continue
    }
    if (record.startsWith('# branch.upstream ')) {
      branch.upstream = record.slice('# branch.upstream '.length).trim() || undefined
      continue
    }
    if (record.startsWith('# branch.ab ')) {
      const match = record.match(/\+(-?\d+)\s+-(-?\d+)/)
      if (match) {
        branch.ahead = Number.parseInt(match[1], 10) || 0
        branch.behind = Number.parseInt(match[2], 10) || 0
      }
      continue
    }

    if (record.startsWith('? ')) {
      const file = createGitChangedFile(record.slice(2), '?', '?')
      if (file) changedFiles.push(file)
      continue
    }

    if (record.startsWith('1 ')) {
      const xy = gitStatusToken(record, 1)
      const file = createGitChangedFile(remainderAfterTokens(record, 8), xy[0] || '.', xy[1] || '.')
      if (file) changedFiles.push(file)
      continue
    }

    if (record.startsWith('2 ')) {
      const xy = gitStatusToken(record, 1)
      const file = createGitChangedFile(
        remainderAfterTokens(record, 9),
        xy[0] || '.',
        xy[1] || '.',
        records[index + 1]
      )
      if (file) changedFiles.push(file)
      index += 1
      continue
    }

    if (record.startsWith('u ')) {
      const xy = gitStatusToken(record, 1)
      const file = createGitChangedFile(remainderAfterTokens(record, 10), xy[0] || 'U', xy[1] || 'U')
      if (file) changedFiles.push(file)
    }
  }

  return { branch, changedFiles }
}

async function readGitCommitHistory(cwd: string, limit: number): Promise<GitHistoryCommitInfo[]> {
  const result = await runGitCommand(cwd, [
    'log',
    `-${limit}`,
    '--pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%cI%x1f%D%x1f%B%x1e',
  ])
  if (result.code !== 0) return []

  const records = result.stdout
    .replace(/\r/g, '')
    .split('\x1e')
    .map((item) => item.trim())
    .filter(Boolean)

  const commits: GitHistoryCommitInfo[] = []
  for (const record of records) {
    const fields = record.split('\x1f')
    const hash = fields[0]
    const shortHash = fields[1]
    const subject = fields[2]
    const authorName = fields[3] || ''
    const committedAt = fields[4]
    const refs = (fields[5] || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
    const fullMessage = fields.slice(6).join('\x1f')
    if (!hash || !shortHash || !subject || !committedAt) continue
    const bullets = fullMessage
      .replace(/\r/g, '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^-\s+/.test(line))

    commits.push({
      hash,
      shortHash,
      subject,
      authorName,
      committedAt,
      refs,
      bullets,
      filesChanged: 0,
    })
  }

  const filesChangedByHash = await readGitCommitFilesChangedMap(cwd, limit)
  for (const commit of commits) {
    commit.filesChanged = filesChangedByHash.get(commit.hash.toLowerCase()) ?? 0
  }

  return commits
}

async function readGitCommitFilesChangedMap(cwd: string, limit: number): Promise<Map<string, number>> {
  const result = await runGitCommand(cwd, [
    'log',
    `-${limit}`,
    '--pretty=format:%H',
    '--numstat',
  ])
  if (result.code !== 0) return new Map()

  const lines = result.stdout.replace(/\r/g, '').split('\n')
  const countsByHash = new Map<string, number>()
  let currentHash = ''

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    if (/^[0-9a-f]{40}$/i.test(line)) {
      currentHash = line.toLowerCase()
      if (!countsByHash.has(currentHash)) {
        countsByHash.set(currentHash, 0)
      }
      continue
    }

    if (!currentHash) continue
    const fields = line.split('\t')
    if (fields.length < 3) continue
    countsByHash.set(currentHash, (countsByHash.get(currentHash) ?? 0) + 1)
  }

  return countsByHash
}

async function readRecentCommits(cwd: string): Promise<RecentCommitInfo[]> {
  const commits = await readGitCommitHistory(cwd, 5)
  if (commits.length === 0) return []

  const latestTime = new Date(commits[0].committedAt).getTime()
  if (Number.isNaN(latestTime)) {
    return [commits[0]]
  }

  const withinOneMinute = commits.filter((commit) => {
    const t = new Date(commit.committedAt).getTime()
    if (Number.isNaN(t)) return false
    return latestTime - t <= 60_000
  })

  return withinOneMinute.length > 0 ? withinOneMinute : [commits[0]]
}

async function readGitWorkspaceSnapshot(projectPath: string): Promise<GitWorkspaceSnapshot> {
  const emptyBranch = emptyGitBranchInfo()
  const statusResult = await runGitCommand(projectPath, ['status', '--porcelain=v2', '--branch', '-uall', '-z'])

  if (statusResult.code !== 0) {
    return {
      projectPath,
      isGitRepository: false,
      branch: emptyBranch,
      changedFiles: [],
      recentCommits: [],
      checkedAt: Date.now(),
      error: statusResult.stderr.trim() || 'Not a git repository',
    }
  }

  const [localBranches, remoteBranches, recentCommits] = await Promise.all([
    listGitLines(projectPath, ['branch', '--format=%(refname:short)']),
    listGitLines(projectPath, ['branch', '--remotes', '--format=%(refname:short)']),
    readGitCommitHistory(projectPath, 10),
  ])

  const parsed = parseGitStatus(statusResult.stdout)
  const branch = {
    ...parsed.branch,
    localBranches,
    remoteBranches: remoteBranches.filter((item) => !/\/HEAD$/.test(item)),
  }

  return {
    projectPath,
    isGitRepository: true,
    branch,
    changedFiles: parsed.changedFiles,
    recentCommits,
    checkedAt: Date.now(),
  }
}

function formatGitCommand(args: string[]): string {
  const escaped = args.map((arg) => (
    /\s/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg
  ))
  return `git ${escaped.join(' ')}`
}

function normalizeGitOperationOutput(stdout: string, stderr: string): string {
  const normalized = [stdout, stderr]
    .filter(Boolean)
    .join('\n')
    .replace(/\r/g, '')
    .trim()
  return normalized || '(no output)'
}

function normalizeGitDiffOutput(output: string): string {
  return output.replace(/\r/g, '').trim()
}

async function fileExistsAtCwd(cwd: string, relativeFilePath: string): Promise<boolean> {
  try {
    const filePath = join(cwd, relativeFilePath)
    await access(filePath, FsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

async function setGitFileStage(request: GitSetFileStageRequest): Promise<GitSetFileStageResult> {
  const checkedAt = Date.now()
  const projectPath = request.projectPath.trim()
  const filePath = request.filePath.trim()
  const stage = request.stage

  if (!projectPath) {
    return {
      ok: false,
      checkedAt,
      command: '',
      output: 'Project path is required.',
      exitCode: null,
      error: 'Project path is required.',
    }
  }
  if (!filePath) {
    return {
      ok: false,
      checkedAt,
      command: '',
      output: 'File path is required.',
      exitCode: null,
      error: 'File path is required.',
    }
  }

  const snapshot = await readGitWorkspaceSnapshot(projectPath)
  if (!snapshot.isGitRepository) {
    const reason = snapshot.error || 'Not a git repository.'
    return {
      ok: false,
      checkedAt,
      command: '',
      output: reason,
      exitCode: null,
      error: reason,
    }
  }

  if (stage) {
    const args = ['add', '--', filePath]
    const execution = await runGitCommand(projectPath, args)
    const output = normalizeGitOperationOutput(execution.stdout, execution.stderr)
    const ok = execution.code === 0
    return {
      ok,
      checkedAt,
      command: formatGitCommand(args),
      output,
      exitCode: execution.code,
      error: ok ? undefined : output,
    }
  }

  const fallbackArgs: string[][] = [
    ['restore', '--staged', '--', filePath],
    ['reset', 'HEAD', '--', filePath],
    ['rm', '--cached', '--', filePath],
  ]

  let lastExecution: { code: number | null; stdout: string; stderr: string } | null = null
  let lastCommand = ''
  for (const args of fallbackArgs) {
    const execution = await runGitCommand(projectPath, args)
    const ok = execution.code === 0
    if (ok) {
      return {
        ok: true,
        checkedAt,
        command: formatGitCommand(args),
        output: normalizeGitOperationOutput(execution.stdout, execution.stderr),
        exitCode: execution.code,
      }
    }
    lastExecution = execution
    lastCommand = formatGitCommand(args)
  }

  const output = lastExecution
    ? normalizeGitOperationOutput(lastExecution.stdout, lastExecution.stderr)
    : 'Unstage operation failed.'
  return {
    ok: false,
    checkedAt,
    command: lastCommand,
    output,
    exitCode: lastExecution?.code ?? null,
    error: output,
  }
}

async function getGitFileDiff(request: GitFileDiffRequest): Promise<GitFileDiffResult> {
  const checkedAt = Date.now()
  const projectPath = request.projectPath.trim()
  const filePath = request.filePath.trim()
  const staged = Boolean(request.staged)

  if (!projectPath) {
    return {
      ok: false,
      checkedAt,
      command: '',
      output: 'Project path is required.',
      exitCode: null,
      staged,
      error: 'Project path is required.',
    }
  }
  if (!filePath) {
    return {
      ok: false,
      checkedAt,
      command: '',
      output: 'File path is required.',
      exitCode: null,
      staged,
      error: 'File path is required.',
    }
  }

  const snapshot = await readGitWorkspaceSnapshot(projectPath)
  if (!snapshot.isGitRepository) {
    const reason = snapshot.error || 'Not a git repository.'
    return {
      ok: false,
      checkedAt,
      command: '',
      output: reason,
      exitCode: null,
      staged,
      error: reason,
    }
  }

  let args = staged
    ? ['diff', '--cached', '--', filePath]
    : ['diff', '--', filePath]
  let execution = await runGitCommand(projectPath, args)
  let ok = execution.code === 0
  let output = normalizeGitDiffOutput(execution.stdout)
  let errorText = ok ? undefined : execution.stderr.trim() || undefined

  if (!staged && ok && !output) {
    const existsInWorkingTree = await fileExistsAtCwd(projectPath, filePath)
    if (existsInWorkingTree) {
      args = ['diff', '--no-index', '--', '/dev/null', filePath]
      const untrackedDiff = await runGitCommand(projectPath, args)
      if (untrackedDiff.code === 0 || untrackedDiff.code === 1) {
        execution = untrackedDiff
        ok = true
        output = normalizeGitDiffOutput(untrackedDiff.stdout)
        errorText = undefined
      }
    }
  }

  return {
    ok,
    checkedAt,
    command: formatGitCommand(args),
    output,
    exitCode: execution.code,
    staged,
    error: errorText,
  }
}

async function runGitOperation(request: GitOperationRequest): Promise<GitOperationResult> {
  const checkedAt = Date.now()
  const operation = request.operation
  const projectPath = request.projectPath.trim()
  const targetBranch = request.targetBranch?.trim()

  if (!projectPath) {
    return {
      operation,
      ok: false,
      checkedAt,
      command: '',
      output: 'Project path is required.',
      exitCode: null,
      error: 'Project path is required.',
    }
  }

  const snapshot = await readGitWorkspaceSnapshot(projectPath)
  if (!snapshot.isGitRepository) {
    const reason = snapshot.error || 'Not a git repository.'
    return {
      operation,
      ok: false,
      checkedAt,
      command: '',
      output: reason,
      exitCode: null,
      error: reason,
    }
  }

  const currentBranch = snapshot.branch.current
  const hasConflicts = snapshot.changedFiles.some((file) => file.scope === 'conflicted')
  const hasWorkingTreeChanges = snapshot.changedFiles.length > 0
  let skipReason: string | null = null
  let args: string[] = []

  switch (operation) {
    case 'fetch': {
      args = ['fetch', '--prune', '--tags', '--verbose']
      break
    }
    case 'pull': {
      if (!snapshot.branch.upstream) {
        skipReason = 'Current branch has no upstream tracking branch.'
        break
      }
      if (hasConflicts) {
        skipReason = 'Resolve conflicts before pull.'
        break
      }
      if (hasWorkingTreeChanges) {
        skipReason = 'Working tree is not clean. Commit, stash, or discard changes before pull.'
        break
      }
      if (snapshot.branch.behind <= 0) {
        skipReason = 'No incoming commits to pull.'
        break
      }
      args = ['pull', '--ff-only']
      break
    }
    case 'push': {
      if (hasConflicts) {
        skipReason = 'Resolve conflicts before push.'
        break
      }
      if (!currentBranch || currentBranch === 'DETACHED') {
        skipReason = 'Detached HEAD cannot be pushed.'
        break
      }
      if (snapshot.branch.ahead <= 0) {
        skipReason = 'No outgoing commits to push.'
        break
      }
      args = snapshot.branch.upstream
        ? ['push']
        : ['push', '-u', 'origin', currentBranch]
      break
    }
    case 'merge': {
      if (hasConflicts) {
        skipReason = 'Resolve conflicts before merge.'
        break
      }
      if (hasWorkingTreeChanges) {
        skipReason = 'Working tree is not clean. Commit, stash, or discard changes before merge.'
        break
      }
      if (!targetBranch) {
        skipReason = 'Select a branch to merge from.'
        break
      }
      if (targetBranch === currentBranch) {
        skipReason = 'Cannot merge current branch into itself.'
        break
      }
      args = ['merge', '--no-edit', targetBranch]
      break
    }
    case 'switch': {
      if (hasConflicts) {
        skipReason = 'Resolve conflicts before switching branch.'
        break
      }
      if (!targetBranch) {
        skipReason = 'Select a branch to switch to.'
        break
      }
      if (targetBranch === currentBranch) {
        skipReason = 'Already on the selected branch.'
        break
      }

      const localCandidates = new Set(snapshot.branch.localBranches)
      const remoteCandidates = new Set(snapshot.branch.remoteBranches)
      if (localCandidates.has(targetBranch)) {
        args = ['switch', targetBranch]
        break
      }

      const remoteMatch = targetBranch.match(/^([^/]+)\/(.+)$/)
      if (remoteMatch && remoteCandidates.has(targetBranch)) {
        args = ['switch', '--track', targetBranch]
        break
      }

      skipReason = 'Target branch not found in local/remote branch list.'
      break
    }
    default: {
      const unreachable: never = operation
      return {
        operation: unreachable,
        ok: false,
        checkedAt,
        command: '',
        output: `Unsupported git operation: ${String(unreachable)}`,
        exitCode: null,
        error: 'Unsupported git operation.',
      }
    }
  }

  if (skipReason) {
    return {
      operation,
      ok: false,
      checkedAt,
      command: '',
      output: skipReason,
      exitCode: null,
      skipped: true,
      error: skipReason,
      targetBranch,
    }
  }

  const execution = await runGitCommand(projectPath, args)
  const output = normalizeGitOperationOutput(execution.stdout, execution.stderr)
  const ok = execution.code === 0
  return {
    operation,
    ok,
    checkedAt,
    command: formatGitCommand(args),
    output,
    exitCode: execution.code,
    error: ok ? undefined : output,
    targetBranch,
  }
}

function resolveLocalVsCodePath(pathValue: string): string {
  const normalized = pathValue.trim().replace(/\\/g, '/')
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

function spawnVsCode(args: string[], onError?: (err: Error) => void): void {
  const primaryCmd = process.platform === 'win32' ? 'code.cmd' : 'code'
  const fallbackCmd = 'code'

  const spawnWith = (cmd: string, allowFallback: boolean) => {
    const child = spawn(cmd, args, {
      detached: true,
      shell: true,
      stdio: 'ignore',
    })

    child.on('error', (err) => {
      console.error(`[open-vscode] failed command="${cmd}" args=${JSON.stringify(args)} error=${err.message}`)
      if (allowFallback && cmd !== fallbackCmd) {
        spawnWith(fallbackCmd, false)
      } else {
        onError?.(err)
      }
    })

    child.unref()
  }

  spawnWith(primaryCmd, true)
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

function openTerminalAtPath(folderPath: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const wslTarget = resolveWslVsCodeTarget(folderPath)
    if (process.platform === 'win32' && wslTarget) {
      const child = spawn(
        'wt.exe',
        ['wsl', '-d', wslTarget.distro, '--cd', wslTarget.linuxPath],
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
    const child = spawn('wt.exe', ['-d', localPath], {
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

async function diagnoseRuntime(): Promise<RuntimeDiagnostics> {
  const scriptPath = resolvedRuntimeLauncherScript()
  const issues: string[] = []
  const hasWsl = bootCapability?.hasWsl ?? false
  const hasTmux = bootCapability?.hasTmux ?? false
  const distro = bootCapability?.wslDistro
  let launcherScriptExists = false
  let launcherScriptExecutable = false

  if (!hasWsl) {
    issues.push('WSL is not available')
  }
  if (!hasTmux) {
    issues.push('tmux is not available in WSL')
  }

  if (hasWsl) {
    try {
      const escaped = quoteBashSingle(scriptPath)
      const flags = await wslBridge.exec(
        `[ -e '${escaped}' ] && [ -x '${escaped}' ] && echo EXISTS_EXEC || ([ -e '${escaped}' ] && echo EXISTS_NOEXEC) || echo MISSING`
      )
      if (flags.includes('EXISTS_EXEC')) {
        launcherScriptExists = true
        launcherScriptExecutable = true
      } else if (flags.includes('EXISTS_NOEXEC')) {
        launcherScriptExists = true
        launcherScriptExecutable = false
        issues.push(`Runtime launcher script is not executable: ${scriptPath}`)
      } else {
        issues.push(`Runtime launcher script not found: ${scriptPath}`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      issues.push(`Failed to check launcher script: ${msg}`)
    }
  }

  return {
    checkedAt: Date.now(),
    hasWsl,
    hasTmux,
    distro,
    launcherScript: scriptPath,
    launcherScriptExists,
    launcherScriptExecutable,
    issues,
  }
}

/** Focus a Windows Terminal window whose title contains the session name
  *   (tmux set-titles produces "{sessionName}:{windowName}" e.g. "ide-electron-69fdda:bash") */
function focusTerminalWindow(sessionName: string): void {
  const match = sessionName

  console.log(`[focusTerminalWindow] sessionName="${sessionName}" match="${match}"`)

  const ps1File = join(tmpdir(), `focus-terminal-${Date.now()}.ps1`).replace(/\\/g, '/')

  // PS script writes results to stdout — no log file, no detached-process quirks
  const ps = [
    '$ErrorActionPreference = "Stop"',
    `$match = '${match}'`,
    '',
    'Add-Type -TypeDefinition @\'',
    'using System;',
    'using System.Runtime.InteropServices;',
    'using System.Text;',
    'public class TF {',
    '  [DllImport("user32.dll")]',
    '  public static extern bool EnumWindows(EnumWinProc lpEnumFunc, IntPtr lParam);',
    '  [DllImport("user32.dll")]',
    '  public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);',
    '  [DllImport("user32.dll")]',
    '  public static extern bool IsIconic(IntPtr hWnd);',
    '  [DllImport("user32.dll")]',
    '  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);',
    '  [DllImport("user32.dll")]',
    '  public static extern bool SetForegroundWindow(IntPtr hWnd);',
    '  [DllImport("user32.dll")]',
    '  public static extern bool BringWindowToTop(IntPtr hWnd);',
    '  [DllImport("user32.dll")]',
    '  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);',
    '  public delegate bool EnumWinProc(IntPtr hWnd, IntPtr lParam);',
    '}',
    '\'@',
    '',
    'Write-Output "match=$match"',
    'Write-Output "Enumerating windows..."',
    '$found = [IntPtr]::Zero',
    '',
    '$cb = [TF+EnumWinProc]{ param($h,$l)',
    '  $sb = New-Object System.Text.StringBuilder 256',
    '  [TF]::GetWindowText($h, $sb, 256) | Out-Null',
    '  $title = $sb.ToString()',
    '  if ($title.Length -gt 0) { Write-Output "hwnd=$h title=$title" }',
    '  if ($title.Contains($match)) { $script:found = $h; Write-Output "MATCHED hwnd=$h"; return $false }',
    '  return $true',
    '}',
    '',
    '[TF]::EnumWindows($cb, [IntPtr]::Zero)',
    '',
    'if ($script:found -ne [IntPtr]::Zero) {',
    '  $iconic = [TF]::IsIconic($script:found)',
    '  Write-Output "found hwnd=$($script:found) iconic=$iconic"',
    '  if ($iconic) { [TF]::ShowWindow($script:found, 9) | Out-Null; Write-Output "ShowWindow(SW_RESTORE)" }',
    '  [TF]::BringWindowToTop($script:found) | Out-Null; Write-Output "BringWindowToTop done"',
    '  [TF]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)',
    '  [TF]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)',
    '  $fg = [TF]::SetForegroundWindow($script:found)',
    '  Write-Output "SetForegroundWindow=$fg"',
    '} else {',
    '  Write-Output "NOT FOUND"',
    '}',
  ].join('\r\n')

  writeFileSync(ps1File, ps, 'utf-8')

  // Don't detach — we want stdio pipes to work. unref() lets the app exit without waiting.
  const child = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1File], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stdout = ''
  let stderr = ''

  child.stdout!.on('data', (d: Buffer) => { stdout += d.toString() })
  child.stderr!.on('data', (d: Buffer) => { stderr += d.toString() })

  child.on('error', (err) => {
    console.error('[focusTerminalWindow] spawn failed:', err.message)
  })

  child.on('close', (code) => {
    console.log(`[focusTerminalWindow] PS exited code=${code}`)
    if (stdout.trim()) console.log('[focusTerminalWindow PS stdout]\n', stdout.trim())
    else console.log('[focusTerminalWindow PS stdout] EMPTY')
    if (stderr.trim()) console.log('[focusTerminalWindow PS stderr]\n', stderr.trim())
    try { unlinkSync(ps1File) } catch { /* best effort */ }
  })

  child.unref()
}

function createWindow(): void {
  const config = loadConfig()

  // Keep Chromium caches under userData to avoid default temp/profile permission issues.
  // This only changes cache location and does not affect app logic.
  try {
    app.setPath('sessionData', join(app.getPath('userData'), 'session'))
  } catch {
    // Best effort only.
  }

  const windowIcon =
    process.platform === 'win32'
      ? join(__dirname, '../../icon/Y (2).ico')
      : join(__dirname, '../../icon/Y.png')

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: getWindowBackgroundColor(config.theme),
    icon: windowIcon,
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
  })

  mainWindow.setMenuBarVisibility(false)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' && input.type !== 'rawKeyDown') return
    const key = input.key.toLowerCase()
    const hasPrimaryModifier = input.control || input.meta
    const isCtrlTab = key === 'tab' && hasPrimaryModifier && !input.shift && !input.alt
    const isCtrlShiftF = key === 'f' && hasPrimaryModifier && input.shift && !input.alt
    const isCtrlAltF = key === 'f' && hasPrimaryModifier && input.alt && !input.shift
    if (isCtrlTab) {
      event.preventDefault()
      mainWindow?.webContents.send(IPC.CODE_TOGGLE_VIEW_MODE)
      return
    }
    const isSearchShortcut = isCtrlShiftF || isCtrlAltF
    if (!isSearchShortcut) return
    event.preventDefault()
    mainWindow?.webContents.send(IPC.CODE_FOCUS_SEARCH)
  })
  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send(IPC.WINDOW_STATE, { isMaximized: true })
  })
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send(IPC.WINDOW_STATE, { isMaximized: false })
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  if (processManager) {
    processManager.setOutputWindow(mainWindow)
  }

  registerIpcHandlers()

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC.DETECT_DIRECTORY, (_event, dirPath: string) => {
    return detectProject(dirPath)
  })

  ipcMain.handle(
    IPC.PROCESS_START,
    (_event, projectId: string, command: string, cwd: string, useWsl?: boolean) => {
      return processManager?.start(projectId, command, cwd, useWsl) ?? false
    }
  )

  ipcMain.handle(IPC.PROCESS_STOP, (_event, projectId: string) => {
    return processManager?.stop(projectId) ?? false
  })

  ipcMain.handle(
    IPC.PROCESS_INPUT,
    (_event, projectId: string, data: string) => {
      processManager?.sendInput(projectId, data)
      return true
    }
  )

  ipcMain.handle(IPC.PROCESS_RESIZE, (_event, projectId: string, cols: number, rows: number) => {
    processManager?.resize(projectId, cols, rows)
    return true
  })

  ipcMain.handle(IPC.CONFIG_GET, () => {
    return loadConfig()
  })

  ipcMain.on(IPC.CONFIG_GET_THEME_SYNC, (event) => {
    event.returnValue = loadConfig().theme
  })

  ipcMain.handle(
    IPC.CONFIG_SET,
    (_event, partial: Record<string, unknown>) => {
      const updated = updateConfig(
        partial as Partial<AppConfig> & { startupDefaultTagId?: string }
      )
      if (Object.prototype.hasOwnProperty.call(partial, 'theme')) {
        applyWindowBackground(updated.theme)
      }
      return updated
    }
  )

  ipcMain.handle(IPC.AI_COMMIT_RUN, async (_event, projectId: string, projectPath: string, override?: AiCommitRunOverride) => {
    return runAiCommit(projectId, projectPath, override)
  })

  ipcMain.handle(IPC.AI_COMMIT_GET_STATE, (_event, projectId: string): AiCommitTaskSnapshot | null => {
    return markAiCommitInterruptedIfOrphan(projectId) ?? null
  })

  ipcMain.handle(IPC.GIT_GET_LATEST_COMMIT, async (_event, projectPath: string) => {
    return readRecentCommits(projectPath)
  })

  ipcMain.handle(IPC.GIT_GET_WORKSPACE_SNAPSHOT, async (_event, projectPath: string) => {
    return readGitWorkspaceSnapshot(projectPath)
  })

  ipcMain.handle(IPC.GIT_RUN_OPERATION, async (_event, request: GitOperationRequest) => {
    return runGitOperation(request)
  })

  ipcMain.handle(IPC.GIT_SET_FILE_STAGE, async (_event, request: GitSetFileStageRequest) => {
    return setGitFileStage(request)
  })

  ipcMain.handle(IPC.GIT_GET_FILE_DIFF, async (_event, request: GitFileDiffRequest) => {
    return getGitFileDiff(request)
  })

  ipcMain.handle(IPC.SHELL_OPEN_EXTERNAL, (_event, url: string) => {
    return shell.openExternal(url)
  })

  ipcMain.handle(IPC.SHELL_OPEN_FOLDER, async (_event, folderPath: string) => {
    const err = await shell.openPath(folderPath)
    if (err) throw new Error(`Failed to open folder: ${err}`)
  })

  ipcMain.handle(IPC.SHELL_OPEN_VSCODE, (_event, folderPath: string) => {
    const wslTarget = resolveWslVsCodeTarget(folderPath)
    if (wslTarget) {
      const distro = wslTarget.distro
      const linuxFolder = asFolderPath(wslTarget.linuxPath)

      // Prefer official WSL remote syntax from Windows CLI:
      //   code --remote wsl+<distro> <path in WSL>
      // Fallback path for edge cases remains folder-uri.
      const remoteArgs = ['--remote', toWslAuthority(distro), linuxFolder]
      spawnVsCode(remoteArgs, () => {
        spawnVsCodeViaWsl(distro, linuxFolder)
      })
      return
    }

    const localPath = resolveLocalVsCodePath(folderPath)
    spawnVsCode([localPath])
  })

  ipcMain.handle(IPC.WINDOW_MINIMIZE, () => {
    mainWindow?.minimize()
    return true
  })

  ipcMain.handle(IPC.WINDOW_TOGGLE_MAXIMIZE, () => {
    if (!mainWindow) return false
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow.maximize()
    }
    return mainWindow.isMaximized()
  })

  ipcMain.handle(IPC.WINDOW_CLOSE, () => {
    mainWindow?.close()
    return true
  })

  ipcMain.handle(IPC.WINDOW_IS_MAXIMIZED, () => {
    return mainWindow?.isMaximized() ?? false
  })

  ipcMain.handle(IPC.DIALOG_SELECT_DIRECTORY, async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    })
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0]
    }
    return null
  })

  ipcMain.handle(IPC.PROJECT_FILE_TREE, async (_event, projectPath: string) => {
    try {
      return await listProjectFiles(projectPath)
    } catch (error) {
      throw new Error(toProjectFileServiceErrorMessage(error))
    }
  })

  ipcMain.handle(IPC.PROJECT_FILE_SEARCH, async (_event, projectPath: string, query: string) => {
    try {
      return await searchProjectFiles(projectPath, query)
    } catch (error) {
      throw new Error(toProjectFileServiceErrorMessage(error))
    }
  })

  ipcMain.handle(
    IPC.PROJECT_FILE_CONTENT_SEARCH,
    async (_event, projectPath: string, query: string, options?: ProjectFileContentSearchOptions) => {
    try {
        return await searchProjectContent(projectPath, query, options)
    } catch (error) {
      throw new Error(toProjectFileServiceErrorMessage(error))
    }
    }
  )

  ipcMain.handle(IPC.PROJECT_FILE_READ, async (_event, projectPath: string, relativePath: string) => {
    try {
      return await readProjectFile(projectPath, relativePath)
    } catch (error) {
      throw new Error(toProjectFileServiceErrorMessage(error))
    }
  })

  ipcMain.handle(IPC.PROJECT_FILE_STAT, async (_event, projectPath: string, relativePath: string) => {
    try {
      return await statProjectFile(projectPath, relativePath)
    } catch (error) {
      throw new Error(toProjectFileServiceErrorMessage(error))
    }
  })

  ipcMain.handle(
    IPC.PROJECT_FILE_WRITE,
    async (
      _event,
      projectPath: string,
      relativePath: string,
      content: string,
      expectedMtimeMs?: number
    ) => {
      try {
        return await writeProjectFile(projectPath, relativePath, content, expectedMtimeMs)
      } catch (error) {
        throw new Error(toProjectFileServiceErrorMessage(error))
      }
    }
  )

  // ── Runtime Manager ──────────────────────────────────────

  ipcMain.handle(
    IPC.RUNTIME_START,
    async (_event, projectId: string, projectPath: string, cli?: 'claude' | 'codex') => {
      const diag = await diagnoseRuntime()
      if (diag.issues.length > 0) {
        console.error('[runtime:start] diagnostics failed:', diag.issues.join(' | '))
        return false
      }

      const distro = bootCapability?.wslDistro || 'Ubuntu'
      const wslPath = wslBridge.toWslPath(projectPath)

      // Match the script's session naming: basename + first 6 chars of MD5(path)
      const md5 = createHash('md5').update(wslPath).digest('hex').slice(0, 6)
      const sessionName = `${basename(projectPath)}-${md5}`

      // Build CLI tool flag for the launcher script
      const cliFlag = cli === 'codex' ? ' --cli codex' : ''
      const launcher = quoteBashSingle(resolvedRuntimeLauncherScript())

      return new Promise<boolean>((resolve) => {
        const child = spawn(
          'wsl.exe',
          [
            '-d',
            distro,
            '--',
            'bash',
            '-lc',
            `'${launcher}'${cliFlag} '${quoteBashSingle(wslPath)}'`
          ],
          {
            detached: true,
            windowsHide: true,
            stdio: 'ignore',
          }
        )

        child.on('error', (err) => {
          console.error('[runtime:start] spawn failed:', err.message)
          resolve(false)
        })

        child.on('spawn', () => {
          setRuntimeEntry({
            projectId,
            sessionName,
            createdAt: Date.now(),
            lastOpened: Date.now(),
          })

          resolve(true)
        })

        child.unref()
      })
    }
  )

  ipcMain.handle(IPC.SHELL_OPEN_TERMINAL, async (_event, sessionName: string, statusHint?: string) => {
    console.log(`[open-terminal] sessionName="${sessionName}" statusHint=${statusHint ?? 'none'}`)

    // Fast path: renderer already knows session is attached — skip WSL checks entirely
    if (statusHint === 'attached') {
      console.log('[open-terminal] fast path — skipping WSL, focusing directly')
      focusTerminalWindow(sessionName)
      return true
    }

    // Slow path: check tmux session existence and client count via WSL
    const exists = await tmuxManager.sessionExists(sessionName)
    console.log(`[open-terminal] sessionExists=${exists}`)
    if (!exists) return false

    const clients = await tmuxManager.countClients(sessionName)
    console.log(`[open-terminal] clients=${clients}`)
    if (clients > 0) {
      focusTerminalWindow(sessionName)
      return true
    }

    const distro = bootCapability?.wslDistro || 'Ubuntu'

    return new Promise<boolean>((resolve) => {
      const child = spawn('wt.exe', [
        'wsl', '-d', distro,
        '--', 'bash', '-c',
        `exec tmux attach-session -t '${sessionName}'`
      ], {
        detached: true,
        stdio: 'ignore',
      })

      child.on('error', (err) => {
        console.error('[runtime:open-terminal] spawn failed:', err.message)
        resolve(false)
      })

      child.on('close', () => resolve(true))

      child.unref()
    })
  })

  ipcMain.handle(IPC.SHELL_OPEN_PATH_TERMINAL, async (_event, folderPath: string) => {
    return openTerminalAtPath(folderPath)
  })

  ipcMain.handle(IPC.RUNTIME_LIST_ENTRIES, () => {
    return listRuntimeEntries()
  })

  ipcMain.handle(IPC.RUNTIME_DIAGNOSTICS, async () => {
    return diagnoseRuntime()
  })

  // ── WSL / tmux ──────────────────────────────────────────

  ipcMain.handle(IPC.WSL_GET_CAPABILITY, () => {
    return bootCapability
  })

  ipcMain.handle(IPC.TMUX_LIST_SESSIONS, () => {
    return tmuxManager.listLauncherSessions()
  })

  ipcMain.handle(IPC.TMUX_KILL_SESSION, (_event, sessionName: string) => {
    return tmuxManager.killSession(sessionName)
  })

  ipcMain.handle(IPC.TERMINAL_LIST_ALL, async (): Promise<TerminalProcessInventory> => {
    const managedProcesses = processManager?.listManagedProcesses() ?? []
    const tmuxSessions = bootCapability?.hasTmux
      ? await tmuxManager.listLauncherSessions()
      : []
    return {
      checkedAt: Date.now(),
      managedProcesses,
      tmuxSessions,
    }
  })

  ipcMain.handle(IPC.TERMINAL_STOP_ALL, async (): Promise<TerminalStopAllResult> => {
    const managedStopped = processManager?.stopAllWithCount() ?? 0
    const allTmuxSessions = bootCapability?.hasTmux
      ? await tmuxManager.listLauncherSessions()
      : []
    const tmuxSessionNames = allTmuxSessions.map((s) => s.sessionName).filter(Boolean)

    if (tmuxSessionNames.length === 0) {
      return {
        managedStopped,
        tmuxKilled: 0,
        tmuxSkipped: 0,
      }
    }

    await tmuxManager.killSessions(tmuxSessionNames)
    const after = bootCapability?.hasTmux ? await tmuxManager.listLauncherSessions() : []
    const afterSet = new Set(after.map((s) => s.sessionName))
    let tmuxKilled = 0
    let tmuxSkipped = 0
    for (const name of tmuxSessionNames) {
      if (afterSet.has(name)) tmuxSkipped += 1
      else tmuxKilled += 1
    }

    return {
      managedStopped,
      tmuxKilled,
      tmuxSkipped,
    }
  })

}

// ── before-quit ───────────────────────────────────────────

let isQuitting = false

app.on('before-quit', async (e) => {
  if (isQuitting) return
  e.preventDefault()
  isQuitting = true

  const { runtimeKeepAliveOnQuit = false } = loadConfig()
  const runtimeEntries = listRuntimeEntries()

  if (!runtimeKeepAliveOnQuit) {
    // Only clean sessions associated with this app registry; avoid touching unrelated tmux sessions.
    const ownSessionNames = runtimeEntries.map((entry) => entry.sessionName).filter(Boolean)
    try {
      await tmuxManager.killSessions(ownSessionNames)
    } catch (err) {
      console.error('[before-quit] failed to clean app runtime sessions:', err)
    }

    // Drop registry entries on graceful exit to avoid stale mappings on next boot.
    for (const entry of runtimeEntries) {
      removeRuntimeEntry(entry.projectId)
    }
  }

  processManager?.stopAll()

  setTimeout(() => {
    app.quit()
  }, 1500)
})

// ── startup ──────────────────────────────────────────────

app.whenReady().then(async () => {
  nativeTheme.on('updated', () => {
    const { theme } = loadConfig()
    if (theme === 'system') {
      applyWindowBackground(theme)
    }
  })

  // P0 1: One-time capability probe
  await capabilityManager.init()
  bootCapability = capabilityManager.get()

  // Create ProcessManager with capability injected
  processManager = new ProcessManager(bootCapability)

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
