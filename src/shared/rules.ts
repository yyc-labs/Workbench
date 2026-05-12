import type { DetectionRule, PackageManager } from './types'

export const RULES: DetectionRule[] = [
  {
    type: 'next.js',
    priority: 100,
    matchPatterns: ['next.config.*'],
    defaultCommand: 'next dev',
  },
  {
    type: 'vite',
    priority: 90,
    matchPatterns: ['vite.config.*'],
    defaultCommand: 'vite',
  },
  {
    type: 'nuxt',
    priority: 80,
    matchPatterns: ['nuxt.config.*'],
    defaultCommand: 'nuxt dev',
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
