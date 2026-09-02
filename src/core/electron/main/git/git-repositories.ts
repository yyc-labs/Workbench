import { promises as fs } from 'node:fs'
import type { Dirent } from 'node:fs'
import path from 'node:path'
import type { GitRepositoryListResult, GitRepositorySummary } from '../../../shared/types'

const MAX_GIT_REPOSITORY_SCAN_DEPTH = 6
const MAX_GIT_REPOSITORIES = 50

const GIT_REPOSITORY_SKIP_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt', '.vite', '.turbo', '.cache', '.venv', 'venv', 'target', 'vendor', '__pycache__'])

type DiscoveredGitRepository = {
  rootPath: string
  gitDirPath?: string
}

function toPosixPath(input: string): string {
  return input.replace(/\\/g, '/')
}

function isPathInside(parent: string, candidate: string): boolean {
  if (parent === candidate) return false
  const relative = path.relative(parent, candidate)
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function relativeWorkspacePath(workspaceRoot: string, repoRoot: string): string {
  const relative = toPosixPath(path.relative(workspaceRoot, repoRoot))
  return relative || '.'
}

function compareRepositorySummary(a: GitRepositorySummary, b: GitRepositorySummary): number {
  if (a.relativePath === '.' && b.relativePath !== '.') return -1
  if (b.relativePath === '.' && a.relativePath !== '.') return 1

  const aDepth = a.relativePath === '.' ? 0 : a.relativePath.split('/').length
  const bDepth = b.relativePath === '.' ? 0 : b.relativePath.split('/').length
  if (aDepth !== bDepth) return aDepth - bDepth
  return a.relativePath.localeCompare(b.relativePath)
}

async function resolveGitDirPath(repoRoot: string, gitPath: string): Promise<string | undefined> {
  try {
    const stat = await fs.stat(gitPath)
    if (stat.isDirectory()) return gitPath
    if (!stat.isFile()) return undefined

    const content = await fs.readFile(gitPath, 'utf8')
    const firstLine = content.replace(/\r/g, '').split('\n')[0]?.trim() ?? ''
    const match = firstLine.match(/^gitdir:\s*(.+)$/i)
    if (!match) return gitPath

    const gitDir = match[1].trim()
    return path.isAbsolute(gitDir) ? gitDir : path.resolve(repoRoot, gitDir)
  } catch {
    return undefined
  }
}

function buildRepositorySummaries(workspaceRoot: string, discovered: DiscoveredGitRepository[]): GitRepositorySummary[] {
  const uniqueByRoot = new Map<string, DiscoveredGitRepository>()
  for (const repo of discovered) {
    uniqueByRoot.set(repo.rootPath, repo)
  }

  const roots = Array.from(uniqueByRoot.values()).sort((a, b) => a.rootPath.localeCompare(b.rootPath))
  const summaries = roots.map((repo): GitRepositorySummary => {
    const relativePath = relativeWorkspacePath(workspaceRoot, repo.rootPath)
    return {
      id: repo.rootPath,
      name: relativePath === '.' ? path.basename(workspaceRoot) : path.basename(repo.rootPath),
      repoRoot: repo.rootPath,
      relativePath,
      isNested: false,
      gitDirPath: repo.gitDirPath,
    }
  })

  // 根目录未初始化 Git 时也保留一个占位条目，避免列表只显示子仓库让用户误以为根目录是 Git 仓库。
  if (!summaries.some((summary) => summary.relativePath === '.')) {
    summaries.push({
      id: workspaceRoot,
      name: path.basename(workspaceRoot),
      repoRoot: workspaceRoot,
      relativePath: '.',
      isNested: false,
      isGitRepository: false,
    })
  }

  for (const summary of summaries) {
    if (summary.isGitRepository === false) continue

    const parent = summaries.filter((candidate) => candidate.isGitRepository !== false && isPathInside(candidate.repoRoot, summary.repoRoot)).sort((a, b) => b.repoRoot.length - a.repoRoot.length)[0]

    if (parent) {
      summary.isNested = true
      summary.parentRepoId = parent.id
    }
  }

  return summaries.sort(compareRepositorySummary)
}

export async function listGitRepositories(workspacePath: string): Promise<GitRepositoryListResult> {
  const scannedAt = Date.now()
  const inputPath = workspacePath.trim()
  if (!inputPath) {
    return {
      workspacePath,
      repositories: [],
      scannedAt,
      truncated: false,
      error: 'Workspace path is required.',
    }
  }

  let workspaceRoot: string
  try {
    workspaceRoot = await fs.realpath(inputPath)
    const stat = await fs.stat(workspaceRoot)
    if (!stat.isDirectory()) {
      return {
        workspacePath: workspaceRoot,
        repositories: [],
        scannedAt,
        truncated: false,
        error: 'Workspace path is not a directory.',
      }
    }
  } catch (error) {
    return {
      workspacePath: inputPath,
      repositories: [],
      scannedAt,
      truncated: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }

  const discovered: DiscoveredGitRepository[] = []
  let truncated = false

  async function scanDirectory(directoryPath: string, depth: number): Promise<void> {
    if (truncated) return
    if (depth > MAX_GIT_REPOSITORY_SCAN_DEPTH) return

    let entries: Dirent<string>[]
    try {
      entries = await fs.readdir(directoryPath, { withFileTypes: true, encoding: 'utf8' })
    } catch {
      return
    }

    const gitEntry = entries.find((entry) => entry.name === '.git')
    if (gitEntry) {
      const gitPath = path.join(directoryPath, gitEntry.name)
      const gitDirPath = await resolveGitDirPath(directoryPath, gitPath)
      discovered.push({ rootPath: directoryPath, gitDirPath })
      if (discovered.length >= MAX_GIT_REPOSITORIES) {
        truncated = true
        return
      }
    }

    for (const entry of entries) {
      if (truncated) return
      if (!entry.isDirectory()) continue
      if (entry.isSymbolicLink()) continue
      if (GIT_REPOSITORY_SKIP_DIRECTORIES.has(entry.name)) continue
      await scanDirectory(path.join(directoryPath, entry.name), depth + 1)
    }
  }

  await scanDirectory(workspaceRoot, 0)

  return {
    workspacePath: workspaceRoot,
    repositories: buildRepositorySummaries(workspaceRoot, discovered),
    scannedAt,
    truncated,
  }
}
