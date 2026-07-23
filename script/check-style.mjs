import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const extensions = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json'])

function gitLines(args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

const baseRef = gitLines(['rev-parse', '--verify', 'origin/master']).length > 0 ? 'origin/master...HEAD' : 'HEAD'
const changedFiles = [...gitLines(['diff', '--name-only', '--diff-filter=ACMRTUXB', baseRef]), ...gitLines(['diff', '--name-only', '--diff-filter=ACMRTUXB']), ...gitLines(['ls-files', '--others', '--exclude-standard'])]
const files = [...new Set(changedFiles)].filter((filePath) => extensions.has(filePath.slice(filePath.lastIndexOf('.')))).filter((filePath) => existsSync(resolve(root, filePath)))

if (files.length === 0) process.exit(0)

const biomePath = resolve(root, process.platform === 'win32' ? 'node_modules/.bin/biome.cmd' : 'node_modules/.bin/biome')
const command = process.platform === 'win32' ? 'cmd.exe' : biomePath
const args = process.platform === 'win32' ? ['/d', '/s', '/c', biomePath, 'check', '--formatter-enabled=true', '--linter-enabled=false', ...files] : ['check', '--formatter-enabled=true', '--linter-enabled=false', ...files]
const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' })
if (result.error) console.error(`[check-style] Failed to execute Biome: ${result.error.message}`)
process.exit(result.status ?? 1)
