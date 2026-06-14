import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Module from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import ts from 'typescript'

const testHelperDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testHelperDir, '../..')
const originalResolveFilename = Module._resolveFilename
let tsRequireHookRegistered = false

export function resolveFromRepo(relativePath) {
  return resolve(repoRoot, relativePath)
}

function transpileTsModule(sourcePath) {
  const source = readFileSync(sourcePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      target: ts.ScriptTarget.ES2022,
      strict: true,
    },
    fileName: sourcePath,
  })
  return outputText
}

function resolveLocalTsModule(request, parent) {
  if (!request.startsWith('.') || !parent?.filename) return null
  const basePath = resolve(dirname(parent.filename), request)
  const candidates = [
    `${basePath}.ts`,
    `${basePath}.tsx`,
    resolve(basePath, 'index.ts'),
    resolve(basePath, 'index.tsx'),
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function registerTsRequireHook() {
  if (tsRequireHookRegistered) return
  tsRequireHookRegistered = true

  Module._extensions['.ts'] = (loadedModule, sourcePath) => {
    loadedModule._compile(transpileTsModule(sourcePath), sourcePath)
  }
  Module._extensions['.tsx'] = Module._extensions['.ts']

  Module._resolveFilename = function resolveFilenameWithTs(request, parent, isMain, options) {
    const localTsModule = resolveLocalTsModule(request, parent)
    if (localTsModule) return localTsModule
    return originalResolveFilename.call(this, request, parent, isMain, options)
  }
}

export function loadTsModule(relativePath) {
  registerTsRequireHook()
  const sourcePath = resolveFromRepo(relativePath)
  const loadedModule = new Module(sourcePath)
  loadedModule.filename = sourcePath
  loadedModule.paths = Module._nodeModulePaths(dirname(sourcePath))
  loadedModule._compile(transpileTsModule(sourcePath), sourcePath)
  return loadedModule.exports
}
