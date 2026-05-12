import { readdirSync } from 'fs'
import { basename } from 'path'
import type { ProjectInfo } from '../shared/types'
import { RULES, globMatch, detectPackageManager } from '../shared/rules'

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

export function detectProject(dirPath: string): ProjectInfo | null {
  let files: string[]
  try {
    files = readdirSync(dirPath)
  } catch {
    return null
  }

  const name = basename(dirPath)

  for (const rule of RULES) {
    const matchedPatterns = rule.matchPatterns.filter((pattern) =>
      files.some((f) => globMatch(pattern, f))
    )

    if (matchedPatterns.length === 0) continue

    if (rule.requiresAll && matchedPatterns.length < rule.matchPatterns.length) {
      continue
    }

    const pm = detectPackageManager(files)
    const command =
      rule.type === 'python'
        ? rule.defaultCommand.replace('{name}', name)
        : substitutePackageManager(rule.defaultCommand, pm)

    return {
      id: generateId(dirPath),
      path: dirPath,
      name,
      type: rule.type,
      command,
      packageManager: pm === 'npm' ? undefined : pm,
    }
  }

  return null
}
