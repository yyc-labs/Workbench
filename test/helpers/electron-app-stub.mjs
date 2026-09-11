import Module from 'node:module'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/**
 * Replace the `electron` module in the require cache with a minimal stub so
 * main-process modules can be loaded under plain Node (node:test). Must be
 * called before loadTsModule() pulls in any module that imports 'electron'.
 *
 * In a non-Electron process the real electron package only exports the
 * executable path string, so `import { app } from 'electron'` yields undefined
 * and anything touching `app.getPath('userData')` crashes.
 */
export function stubElectronApp(userDataPath) {
  const resolved = require.resolve('electron')
  const app = {
    getPath: (name) => (name === 'userData' ? userDataPath : userDataPath),
  }
  Module._cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: { app } }
  return app
}
