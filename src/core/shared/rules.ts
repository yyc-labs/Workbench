import type { DetectionRule, PackageManager } from './types'

export const RULES: DetectionRule[] = [
  {
    type: 'next.js',
    priority: 100,
    // next.config.* may not exist in modern Next (app router, small projects).
    // package.json is always required, and the dep check below confirms it's Next.
    matchPatterns: ['next.config.*', 'package.json'],
    defaultCommand: 'npm run dev',
    requireDep: 'next',
  },
  {
    type: 'vite',
    priority: 90,
    matchPatterns: ['vite.config.*'],
    defaultCommand: 'npm run dev',
  },
  {
    type: 'android',
    priority: 85,
    matchPatterns: ['settings.gradle*', 'build.gradle*'],
    defaultCommand: './gradlew installDebug',
    requiresAll: true,
  },
  {
    type: 'nuxt',
    priority: 80,
    matchPatterns: ['nuxt.config.*'],
    defaultCommand: 'npm run dev',
  },
  {
    type: 'node',
    priority: 70,
    matchPatterns: ['package.json'],
    defaultCommand: 'npm run dev',
    fallbackCommand: 'npm start',
  },
  {
    type: 'django',
    priority: 60,
    matchPatterns: ['manage.py'],
    defaultCommand: 'python manage.py runserver',
  },
  {
    type: 'flask',
    priority: 50,
    matchPatterns: ['app.py', 'requirements.txt'],
    defaultCommand: 'python app.py',
    requiresAll: true,
  },
  {
    type: 'fastapi',
    priority: 40,
    matchPatterns: ['main.py', 'requirements.txt'],
    defaultCommand: 'python main.py',
    requiresAll: true,
  },
  {
    type: 'python',
    priority: 30,
    matchPatterns: ['pyproject.toml'],
    defaultCommand: 'python -m {name}',
  },
]

const PACKAGE_MANAGER_INDICATORS: Record<string, PackageManager> = {
  'pnpm-lock.yaml': 'pnpm',
  'yarn.lock': 'yarn',
  'bun.lock': 'bun',
  'bun.lockb': 'bun',
}

export function globMatch(pattern: string, filename: string): boolean {
  const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$', 'i')
  return regex.test(filename)
}

export function detectPackageManager(files: string[]): PackageManager {
  for (const file of files) {
    const pm = PACKAGE_MANAGER_INDICATORS[file]
    if (pm) return pm
  }
  return 'npm'
}

/**
 * 解析 package.json 的 `packageManager` 声明字段（如 "pnpm@9.1.0"）。
 * 只认四个已知包管理器前缀，其余（corepack 包装、未知工具）返回 undefined。
 */
export function parsePackageManagerField(value: unknown): PackageManager | undefined {
  if (typeof value !== 'string') return undefined
  const name = value.split('@')[0]?.trim().toLowerCase()
  if (name === 'npm' || name === 'yarn' || name === 'pnpm' || name === 'bun') return name
  return undefined
}

/**
 * 按声明优先 → lockfile → npm 回退解析目录适用的包管理器（19 号计划 §4.1）。
 * `declared` 来自 package.json 的 packageManager 字段，`files` 为该目录的文件名列表。
 */
export function resolvePackageManager(options: { declared?: PackageManager; directoryFiles: string[] }): PackageManager {
  if (options.declared) return options.declared
  return detectPackageManager(options.directoryFiles)
}

export function projectIdFromPath(filePath: string): string {
  let hash = 0
  for (let i = 0; i < filePath.length; i++) {
    const char = filePath.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0
  }
  return `p${Math.abs(hash).toString(36)}`
}
