import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { buildScriptCommand, resolveExecutableScript } = loadTsModule('src/core/renderer/pages/code/code.executable.ts')

test('resolveExecutableScript maps extensions by environment', () => {
  // node / python 两种环境都展示
  assert.deepEqual(resolveExecutableScript('app.js', false), { runtime: 'node', extension: '.js' })
  assert.deepEqual(resolveExecutableScript('app.mjs', true), { runtime: 'node', extension: '.mjs' })
  assert.deepEqual(resolveExecutableScript('scripts/train.py', false), { runtime: 'python', extension: '.py' })

  // .sh 仅 WSL；.ps1 / .bat / .cmd 仅 Windows Native
  assert.deepEqual(resolveExecutableScript('run.sh', true), { runtime: 'bash', extension: '.sh' })
  assert.equal(resolveExecutableScript('run.sh', false), null)
  assert.deepEqual(resolveExecutableScript('deploy.ps1', false), { runtime: 'powershell', extension: '.ps1' })
  assert.equal(resolveExecutableScript('deploy.ps1', true), null)
  assert.deepEqual(resolveExecutableScript('setup.bat', false), { runtime: 'cmd', extension: '.bat' })
  assert.deepEqual(resolveExecutableScript('setup.cmd', false), { runtime: 'cmd', extension: '.cmd' })
  assert.equal(resolveExecutableScript('setup.bat', true), null)
})

test('resolveExecutableScript rejects traversal and non-script paths', () => {
  assert.equal(resolveExecutableScript('../outside/app.js', false), null)
  assert.equal(resolveExecutableScript('', false), null)
  assert.equal(resolveExecutableScript('README.md', false), null)
  assert.equal(resolveExecutableScript('a//b/../app.js', false), null)
})

test('buildScriptCommand quotes the validated relative path only', () => {
  assert.equal(buildScriptCommand({ runtime: 'node', extension: '.js' }, 'my scripts/a b.js'), 'node "my scripts/a b.js"')
  assert.equal(buildScriptCommand({ runtime: 'python', extension: '.py' }, 'scripts/train.py'), 'python "scripts/train.py"')
  assert.equal(buildScriptCommand({ runtime: 'bash', extension: '.sh' }, 'run.sh'), 'bash "run.sh"')
  assert.equal(buildScriptCommand({ runtime: 'powershell', extension: '.ps1' }, 'deploy.ps1'), 'pwsh "deploy.ps1"')
  // cmd 运行时使用反斜杠路径，避免 `/` 被当作开关
  assert.equal(buildScriptCommand({ runtime: 'cmd', extension: '.bat' }, 'my scripts/setup.bat'), 'cmd /c "my scripts\\setup.bat"')
})
