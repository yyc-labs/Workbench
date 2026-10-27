import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { parsePackageManagerField, resolvePackageManager } = loadTsModule('src/core/shared/rules.ts')
const { packageScriptsProvider, resolveRunActions, runActionProviders, sourceFileProvider } = loadTsModule('src/core/renderer/lib/runActions/providers.ts')
const { serializeRunActionCommand } = loadTsModule('src/core/renderer/lib/runActions/commandSerialization.ts')
const { resolveRunContext, invalidateRunContextCache } = loadTsModule('src/core/renderer/lib/runActions/runContextResolver.ts')
const { allocateScriptProcessKey, runCommandInEmbeddedShell } = loadTsModule('src/core/renderer/lib/runActions/terminalExecution.ts')
const { executeRunAction } = loadTsModule('src/core/renderer/lib/runActions/actionExecutor.ts')

const PKG_JSON = JSON.stringify(
  {
    name: 'demo',
    scripts: { dev: 'vite', build: 'vite build', test: 'vitest run' },
  },
  null,
  2,
)

// 行号对齐 PKG_JSON 的格式化输出（scripts 从第 3 行开始）。
const PKG_WITH_LINES = ['{', '  "name": "demo",', '  "scripts": {', '    "dev": "vite",', '    "build": "vite build",', '    "test": "vitest run"', '  }', '}'].join('\n')

function makeDeps(overrides = {}) {
  return {
    listDirectoryFiles: async () => ({ rootPath: '', directoryRelativePath: null, nodes: [], skipped: { directories: 0, files: 0 } }),
    readTextFile: async () => null,
    ...overrides,
  }
}

function directoryResult(names, directoryRelativePath = null) {
  return { rootPath: 'D:/proj', directoryRelativePath, nodes: names.map((name) => ({ name, relativePath: name, kind: 'file' })), skipped: { directories: 0, files: 0 } }
}

test('packageScriptsProvider emits document-order package-script actions with lines and cwd', () => {
  const actions = packageScriptsProvider.resolve({
    projectPath: 'D:/proj',
    relativePath: 'package.json',
    content: PKG_WITH_LINES,
    fileDirRelative: '.',
    nearestPackageJson: { dirRelative: '.', content: PKG_WITH_LINES },
    packageManager: 'pnpm',
    useWsl: false,
  })
  assert.deepEqual(
    actions.map((action) => action.label),
    ['dev', 'build', 'test'],
  )
  assert.deepEqual(
    actions.map((action) => action.source.line),
    [4, 5, 6],
  )
  assert.deepEqual(
    actions.map((action) => action.kind),
    ['run', 'build', 'test'],
  )
  for (const action of actions) {
    assert.equal(action.execution.type, 'package-script')
    assert.equal(action.execution.packageManager, 'pnpm')
    assert.equal(action.execution.cwd, 'D:/proj')
    assert.equal(action.source.filePath, 'package.json')
  }
})

test('packageScriptsProvider hides actions when manifest content is invalid', () => {
  const invalid = '{\n  // comment\n  "scripts": {"dev": "vite"}\n}'
  const actions = packageScriptsProvider.resolve({
    projectPath: 'D:/proj',
    relativePath: 'package.json',
    content: invalid,
    fileDirRelative: '.',
    nearestPackageJson: { dirRelative: '.', content: invalid },
    packageManager: 'npm',
    useWsl: false,
  })
  assert.deepEqual(actions, [])
})

test('packageScriptsProvider hides manifest scripts when editing other files', () => {
  // 编辑 src/app.ts 时即使向上探测到最近 package.json，也不把它的脚本拿到当前文件显示。
  const actions = packageScriptsProvider.resolve({
    projectPath: 'D:/proj',
    relativePath: 'src/app.ts',
    content: '',
    fileDirRelative: 'src',
    nearestPackageJson: { dirRelative: '.', content: PKG_WITH_LINES },
    packageManager: 'npm',
    useWsl: false,
  })
  assert.deepEqual(actions, [])
})

test('sourceFileProvider maps P0 extensions to run-file actions with correct runtime and cwd', () => {
  const base = { projectPath: 'D:/proj', content: '', packageManager: 'npm', nearestPackageJson: null }
  const resolve = (relativePath, useWsl) => sourceFileProvider.resolve({ ...base, relativePath, fileDirRelative: '.', useWsl })[0] ?? null

  const js = resolve('scripts/train.js', false)
  assert.equal(js.execution.type, 'run-file')
  assert.equal(js.execution.runtime, 'node')
  assert.equal(js.execution.cwd, 'D:/proj/scripts')
  assert.equal(js.id, 'run-file:scripts/train.js')

  assert.equal(resolve('app.py', false)?.execution.runtime, 'python')
  assert.equal(resolve('run.sh', false), null, 'bash 脚本仅 WSL 环境展示')
  assert.equal(resolve('run.sh', true)?.execution.runtime, 'bash')
  assert.equal(resolve('setup.ps1', true), null, 'ps1 仅 Windows native 展示')
  assert.equal(resolve('setup.ps1', false)?.execution.runtime, 'powershell')
  assert.equal(resolve('go.bat', false)?.execution.runtime, 'cmd')
  assert.equal(resolve('README.md', false), null)
})

test('resolveRunActions dedupes by id and cross-provider file+kind conflicts', () => {
  const context = {
    projectPath: 'D:/proj',
    relativePath: 'package.json',
    content: PKG_WITH_LINES,
    fileDirRelative: '.',
    nearestPackageJson: { dirRelative: '.', content: PKG_WITH_LINES },
    packageManager: 'npm',
    useWsl: false,
  }
  const actions = resolveRunActions(runActionProviders, context)
  const ids = actions.map((action) => action.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('resolveRunActions keeps all same-kind scripts from one provider (no intra-provider dedupe)', () => {
  // dev 与 start 同为 run 类：同 Provider 内的同类动作是不同脚本，必须全部保留（§3.3 去重仅限跨 Provider）。
  const content = ['{', '  "name": "demo",', '  "scripts": {', '    "dev": "vite",', '    "start": "node server.js",', '    "lint": "eslint .",', '    "test": "vitest run",', '    "typecheck": "tsc --noEmit"', '  }', '}'].join('\n')
  const actions = packageScriptsProvider.resolve({
    projectPath: 'D:/proj',
    relativePath: 'package.json',
    content,
    fileDirRelative: '.',
    nearestPackageJson: { dirRelative: '.', content },
    packageManager: 'npm',
    useWsl: false,
  })
  assert.deepEqual(
    actions.map((action) => action.label),
    ['dev', 'start', 'lint', 'test', 'typecheck'],
  )
  // kind 分类：lint/dev/start/typecheck → run（typecheck 不含 test 字样），test → test
  assert.deepEqual(
    actions.map((action) => action.kind),
    ['run', 'run', 'run', 'test', 'run'],
  )

  const resolved = resolveRunActions([packageScriptsProvider], {
    projectPath: 'D:/proj',
    relativePath: 'package.json',
    content,
    fileDirRelative: '.',
    nearestPackageJson: { dirRelative: '.', content },
    packageManager: 'npm',
    useWsl: false,
  })
  assert.equal(resolved.length, actions.length, '单 Provider 输出不应被去重削减')
})

test('resolveRunActions drops cross-provider same file+kind in favor of first provider', () => {
  // 两个 provider 都为同一文件提供 run 动作：只保留先注册者的。
  const first = {
    id: 'provider-a:package.json',
    label: 'A run',
    kind: 'run',
    source: { filePath: 'package.json' },
    execution: { type: 'shell-task', command: 'echo a', cwd: 'D:/proj' },
  }
  const second = {
    id: 'provider-b:package.json',
    label: 'B run',
    kind: 'run',
    source: { filePath: 'package.json' },
    execution: { type: 'shell-task', command: 'echo b', cwd: 'D:/proj' },
  }
  const providers = [
    { id: 'a', resolve: () => [first] },
    { id: 'b', resolve: () => [second] },
  ]
  const actions = resolveRunActions(providers, {
    projectPath: 'D:/proj',
    relativePath: 'package.json',
    content: '',
    fileDirRelative: '.',
    nearestPackageJson: null,
    packageManager: 'npm',
    useWsl: false,
  })
  assert.deepEqual(
    actions.map((action) => action.id),
    ['provider-a:package.json'],
  )
})

test('serializeRunActionCommand maps execution types to shell commands', () => {
  assert.equal(serializeRunActionCommand({ id: 'a', label: 'dev', kind: 'run', source: { filePath: 'package.json' }, execution: { type: 'package-script', scriptName: 'dev', packageManager: 'pnpm', cwd: 'D:/proj' } }), 'pnpm run dev')
  assert.equal(serializeRunActionCommand({ id: 'b', label: 'x.js', kind: 'run', source: { filePath: 'x.js' }, execution: { type: 'run-file', runtime: 'node', filePath: 'my scripts/x.js', args: [], cwd: 'D:/proj' } }), 'node "my scripts/x.js"')
  assert.equal(serializeRunActionCommand({ id: 'c', label: 'x.bat', kind: 'run', source: { filePath: 'x.bat' }, execution: { type: 'run-file', runtime: 'cmd', filePath: 'my scripts/x.bat', args: [], cwd: 'D:/proj' } }), 'cmd /c "my scripts\\x.bat"')
  assert.equal(serializeRunActionCommand({ id: 'd', label: 't', kind: 'run', source: { filePath: 'm' }, execution: { type: 'shell-task', command: 'make test', cwd: 'D:/proj' } }), 'make test')
})

test('resolveRunContext finds nearest package.json and resolves package manager (declared > lockfile > npm)', async () => {
  invalidateRunContextCache()
  const calls = []
  const deps = makeDeps({
    listDirectoryFiles: async (_projectPath, dir) => {
      calls.push(dir)
      if (dir === 'packages/app') return directoryResult(['package.json', 'pnpm-lock.yaml', 'src'], 'packages/app')
      return directoryResult(['src'])
    },
    readTextFile: async (_projectPath, relativePath) => (relativePath === 'packages/app/package.json' ? PKG_JSON : null),
  })
  const context = await resolveRunContext(deps, { projectPath: 'D:/proj', relativePath: 'packages/app/src/main.ts', content: '', useWsl: false })
  // 只探测必要祖先目录：文件目录 → 项目根，不扫整仓。
  assert.deepEqual(calls, ['packages/app/src', 'packages/app'])
  assert.equal(context.nearestPackageJson?.dirRelative, 'packages/app')
  assert.equal(context.packageManager, 'pnpm', '无声明字段时按 lockfile 命中 pnpm')
  assert.equal(context.fileDirRelative, 'packages/app/src')
})

test('resolveRunContext prefers declared packageManager field over lockfiles', async () => {
  invalidateRunContextCache()
  const deps = makeDeps({
    listDirectoryFiles: async () => directoryResult(['package.json', 'pnpm-lock.yaml']),
    readTextFile: async () => JSON.stringify({ name: 'demo', packageManager: 'bun@1.1.0', scripts: {} }),
  })
  const context = await resolveRunContext(deps, { projectPath: 'D:/proj', relativePath: 'main.ts', content: '', useWsl: true })
  assert.equal(context.packageManager, 'bun')
  assert.equal(context.useWsl, true)
})

test('resolveRunContext returns npm fallback without any manifest', async () => {
  invalidateRunContextCache()
  const context = await resolveRunContext(makeDeps(), { projectPath: 'D:/proj', relativePath: 'a/b.ts', content: '', useWsl: false })
  assert.equal(context.nearestPackageJson, null)
  assert.equal(context.packageManager, 'npm')
})

test('allocateScriptProcessKey picks the smallest free index', () => {
  assert.equal(allocateScriptProcessKey('p1', []), 'p1::script::0')
  assert.equal(allocateScriptProcessKey('p1', ['p1::script::0', 'p1::script::2', 'p1::dev']), 'p1::script::1')
  assert.equal(allocateScriptProcessKey('p1', ['p2::script::0']), 'p1::script::0')
})

test('executeRunAction launches embedded shell, renames, reveals and submits once', async () => {
  const events = []
  const deps = {
    getProcessKeys: () => ['p1::script::0'],
    resolveShellCommand: async () => 'pwsh -NoLogo',
    startProject: async (projectId, commandOverride, processId, useWsl, cwdOverride, mode) => {
      events.push(['start', projectId, commandOverride, processId, useWsl, cwdOverride, mode])
      return true
    },
    renameTerminal: (projectId, key, title) => events.push(['rename', projectId, key, title]),
    revealTerminal: (projectId, key) => events.push(['reveal', projectId, key]),
    sendInput: (key, data) => events.push(['input', key, data]),
    onProcessOutput: () => () => {},
    openPathTerminal: async () => true,
  }
  const action = {
    id: 'package-script:package.json:dev',
    label: 'dev',
    kind: 'run',
    source: { filePath: 'package.json', line: 4 },
    execution: { type: 'package-script', scriptName: 'dev', packageManager: 'npm', cwd: 'D:/proj' },
  }
  let failures = 0
  const ok = await executeRunAction(deps, {
    projectId: 'p1',
    action,
    useWsl: false,
    notifyLaunchFailure: () => {
      failures += 1
    },
  })
  assert.equal(ok, true)
  assert.equal(failures, 0)
  assert.deepEqual(events[0], ['start', 'p1', 'pwsh -NoLogo', 'p1::script::1', false, 'D:/proj', 'silent'])
  assert.deepEqual(events[1], ['rename', 'p1', 'p1::script::1', 'dev'])
  assert.deepEqual(events[2], ['reveal', 'p1', 'p1::script::1'])
})

test('executeRunAction reports launch failure without sending input', async () => {
  const events = []
  const deps = {
    getProcessKeys: () => [],
    resolveShellCommand: async () => {
      throw new Error('shell unavailable')
    },
    startProject: async () => true,
    renameTerminal: () => {},
    revealTerminal: () => {},
    sendInput: (key, data) => events.push(['input', key, data]),
    onProcessOutput: () => () => {},
    openPathTerminal: async () => true,
  }
  let failures = 0
  const ok = await executeRunAction(deps, {
    projectId: 'p1',
    action: { id: 'a', label: 'dev', kind: 'run', source: { filePath: 'package.json' }, execution: { type: 'package-script', scriptName: 'dev', packageManager: 'npm', cwd: 'D:/proj' } },
    useWsl: false,
    notifyLaunchFailure: () => {
      failures += 1
    },
  })
  assert.equal(ok, false)
  assert.equal(failures, 1)
  assert.deepEqual(events, [], '启动失败时不得发送命令输入')
})

test('parsePackageManagerField / resolvePackageManager re-export sanity (guard against accidental removal)', () => {
  assert.equal(typeof parsePackageManagerField, 'function')
  assert.equal(typeof resolvePackageManager, 'function')
})
