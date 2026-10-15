import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { stubElectronApp } from '../helpers/electron-app-stub.mjs'
import { loadTsModule, resolveFromRepo } from '../helpers/load-ts-module.mjs'

const require = createRequire(import.meta.url)

// 独立进程：先把自定义上限写入 stub userData 的配置文件，再加载模块，
// 验证设置页的 codeTreeAutoLoadFileLimit 真正驱动自动加载决策。
const userData = mkdtempSync(join(tmpdir(), 'tree-limit-config-'))
writeFileSync(join(userData, 'project-launcher-config.json'), JSON.stringify({ codeTreeAutoLoadFileLimit: 5000 }), 'utf8')
stubElectronApp(userData)

const { getProjectFileAutoLoadDecision } = loadTsModule('src/core/electron/main/project-file/tree-service.ts')
// 用普通 require 拿 config.ts：与 tree-service 内部 `require('../config')` 共享同一实例与缓存
// （loadTsModule 每次调用会重新编译一份独立副本，updateConfig 的内存缓存将互不相通）。
const { updateConfig } = require(resolveFromRepo('src/core/electron/main/config.ts'))

function createProjectWithFiles(count) {
  const projectPath = mkdtempSync(join(tmpdir(), 'tree-limit-project-'))
  for (let index = 0; index < count; index += 1) {
    writeFileSync(join(projectPath, `f-${index}.ts`), 'x', 'utf8')
  }
  return projectPath
}

test('configured tree auto-load limit raises the threshold', async () => {
  const projectPath = createProjectWithFiles(4200)
  const decision = await getProjectFileAutoLoadDecision(projectPath)
  assert.equal(decision.limit, 5000)
  assert.equal(decision.shouldAutoLoad, true)
  assert.equal(decision.reason, 'ok')
})

test('updateConfig clamps the limit to [500, 20000] and decisions follow live config', async () => {
  assert.equal((await updateConfig({ codeTreeAutoLoadFileLimit: 400 })).codeTreeAutoLoadFileLimit, 500)
  assert.equal((await updateConfig({ codeTreeAutoLoadFileLimit: 25000 })).codeTreeAutoLoadFileLimit, 20000)
  const rounded = await updateConfig({ codeTreeAutoLoadFileLimit: 1234.6 })
  assert.equal(rounded.codeTreeAutoLoadFileLimit, 1235)

  // 决策读取的是最新配置：4200 个文件在 1235 上限下应被拦截。
  const projectPath = createProjectWithFiles(4200)
  const decision = await getProjectFileAutoLoadDecision(projectPath)
  assert.equal(decision.limit, 1235)
  assert.equal(decision.shouldAutoLoad, false)
  assert.equal(decision.reason, 'large-project')
})
