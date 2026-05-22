export type ProjectEnvironment = 'windows' | 'ubuntu' | 'unknown'

/**
 * Infer project environment from the path shape shown in renderer.
 * - Windows drive path: C:\... or C:/...
 * - WSL UNC path: \\wsl.localhost\Ubuntu\... or \\wsl$\Ubuntu\...
 * - Linux absolute path: /home/... /mnt/... etc.
 */
export function detectProjectEnvironment(pathValue: string): ProjectEnvironment {
  const normalized = pathValue.trim().replace(/\\/g, '/')
  if (!normalized) return 'unknown'

  if (/^\/\/(?:wsl\.localhost|wsl\$)\//i.test(normalized)) {
    return 'ubuntu'
  }

  if (/^[a-z]:\//i.test(normalized)) {
    return 'windows'
  }

  // /mnt/<drive>/... are Windows-mounted paths; treat as Windows projects.
  if (/^\/?mnt\/[a-z](?:\/|$)/i.test(normalized)) {
    return 'windows'
  }

  if (normalized.startsWith('/')) {
    return 'ubuntu'
  }

  return 'unknown'
}

export function projectEnvironmentLabel(env: ProjectEnvironment): string {
  if (env === 'windows') return 'Windows'
  if (env === 'ubuntu') return 'Ubuntu'
  return 'Unknown'
}
