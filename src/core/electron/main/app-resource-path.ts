import { app } from 'electron'
import { join } from 'path'

export function resolveAppResourcePath(...segments: string[]): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, ...segments)
  }

  return join(__dirname, '../../', ...segments)
}
