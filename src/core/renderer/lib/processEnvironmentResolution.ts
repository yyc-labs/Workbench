import { detectProjectEnvironment } from './projectEnvironment'

/** Resolve the execution backend once at the store boundary. */
export function resolveProcessUseWsl(cwd: string, explicitUseWsl?: boolean): boolean | undefined {
  if (typeof explicitUseWsl === 'boolean') return explicitUseWsl
  const environment = detectProjectEnvironment(cwd)
  if (environment === 'ubuntu') return true
  if (environment === 'windows') return false
  return undefined
}
