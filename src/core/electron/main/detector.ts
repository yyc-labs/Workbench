import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { basename } from 'path'
import type { ProjectInfo } from '../../shared/types'
import { RULES, globMatch, detectPackageManager } from '../../shared/rules'

function generateId(filePath: string): string {
  let hash = 0
  for (let i = 0; i < filePath.length; i++) {
    const char = filePath.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash | 0
  }
  return 'p' + Math.abs(hash).toString(36)
}

function substitutePackageManager(
  command: string,
  pm: 'pnpm' | 'yarn' | 'npm'
): string {
  if (pm === 'npm') return command
  return command.replace('npm', pm)
}

function resolveDefaultCommand(type: ProjectInfo['type'], baseCommand: string, pm: 'pnpm' | 'yarn' | 'npm'): string {
  if (type === 'python') return baseCommand
  if (type === 'android') {
    // Keep command shell-compatible for both cmd.exe and bash/zsh.
    // Use wrapper when present, otherwise fallback to global gradle command.
    return 'gradlew.bat installDebug || ./gradlew installDebug || gradle installDebug'
  }
  return substitutePackageManager(baseCommand, pm)
}

function isLikelyAndroidProject(files: string[]): boolean {
  const hasSettingsGradle = files.some((f) => globMatch('settings.gradle*', f))
  const hasAndroidSignals =
    files.includes('app')
    || files.some((f) => globMatch('build.gradle*', f))
    || files.includes('gradle.properties')
    || files.includes('local.properties')
    || files.includes('gradle')

  return hasSettingsGradle && hasAndroidSignals
}

/** Read package.json dependencies if the file exists in the directory */
function readPackageDep(dirPath: string, dep: string): boolean {
  try {
    const raw = readFileSync(join(dirPath, 'package.json'), 'utf-8')
    const pkg = JSON.parse(raw)
    return !!(pkg.dependencies?.[dep] || pkg.devDependencies?.[dep])
  } catch {
    return false
  }
}

export function detectProject(dirPath: string): ProjectInfo | null {
  let files: string[]
  try {
    files = readdirSync(dirPath)
  } catch {
    return null
  }

  const name = basename(dirPath)
  const pm = detectPackageManager(files)

  // Android special-case fallback:
  // many student/team projects miss wrapper files in repo, but still are valid Android roots.
  if (isLikelyAndroidProject(files)) {
    return {
      id: generateId(dirPath),
      path: dirPath,
      name,
      type: 'android',
      command: resolveDefaultCommand('android', './gradlew installDebug', pm),
      packageManager: pm === 'npm' ? undefined : pm,
      docLinks: [],
    }
  }

  // Sort by priority descending — highest priority rule wins first match
  const sortedRules = [...RULES].sort((a, b) => b.priority - a.priority)

  for (const rule of sortedRules) {
    const matchedPatterns = rule.matchPatterns.filter((pattern) =>
      files.some((f) => globMatch(pattern, f))
    )

    if (matchedPatterns.length === 0) continue

    if (rule.requiresAll && matchedPatterns.length < rule.matchPatterns.length) {
      continue
    }

    // Content-based dependency check (e.g. Next.js needs "next" in package.json)
    if (rule.requireDep && !readPackageDep(dirPath, rule.requireDep)) {
      continue
    }

    const command = resolveDefaultCommand(
      rule.type,
      rule.type === 'python' ? rule.defaultCommand.replace('{name}', name) : rule.defaultCommand,
      pm
    )

    return {
      id: generateId(dirPath),
      path: dirPath,
      name,
      type: rule.type,
      command,
      packageManager: pm === 'npm' ? undefined : pm,
      docLinks: [],
    }
  }

  return null
}
