import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

// 大仓库 status 加速（阶段 6 / §7）：只写仓库本地配置，仓库外必须失败（防止误写全局配置）。
const { createGitService } = loadTsModule('src/core/electron/main/git/git-service.ts')

const service = createGitService({ getDefaultWslDistro: () => 'Ubuntu', getLocale: () => 'en' })

function runGit(cwd, ...args) {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString()
}

function createTempRepo(t) {
  const root = mkdtempSync(join(tmpdir(), 'wb-git-status-opt-'))
  t.after(() => {
    try {
      rmSync(root, { recursive: true, force: true })
    } catch {
      // Windows 下偶发只读文件清理失败不影响测试结论
    }
  })
  runGit(root, 'init', '-b', 'main')
  runGit(root, 'config', 'user.email', 'workbench-test@example.com')
  runGit(root, 'config', 'user.name', 'Workbench Test')
  writeFileSync(join(root, 'a.txt'), 'hello\n')
  runGit(root, 'add', '.')
  runGit(root, 'commit', '-m', 'init')
  return root
}

test('默认读数为 false，set 后写仓库本地配置', async (t) => {
  const repo = createTempRepo(t)
  const before = await service.getGitStatusOptimization(repo)
  assert.equal(before.untrackedCache, false)
  assert.equal(before.fsmonitor, false)

  const applied = await service.setGitStatusOptimization({ repoRoot: repo, untrackedCache: true })
  assert.equal(applied.ok, true)
  assert.equal(applied.state?.untrackedCache, true)
  assert.equal(applied.state?.fsmonitor, false)
  assert.equal(runGit(repo, 'config', '--local', '--get', 'core.untrackedCache').trim(), 'true')

  const both = await service.setGitStatusOptimization({ repoRoot: repo, fsmonitor: true })
  assert.equal(both.ok, true)
  assert.equal(both.state?.untrackedCache, true)
  assert.equal(both.state?.fsmonitor, true)

  const off = await service.setGitStatusOptimization({ repoRoot: repo, fsmonitor: false })
  assert.equal(off.ok, true)
  assert.equal(off.state?.fsmonitor, false)
  assert.equal(off.state?.untrackedCache, true)
})

test('仓库外 set 必须失败（--local 红线，绝不写全局）', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'wb-git-status-opt-norepo-'))
  t.after(() => {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // 忽略清理失败
    }
  })
  const result = await service.setGitStatusOptimization({ repoRoot: dir, untrackedCache: true })
  assert.equal(result.ok, false)
  assert.ok(result.error)
  const read = await service.getGitStatusOptimization(dir)
  assert.equal(read.untrackedCache, false)
  assert.equal(read.fsmonitor, false)
})

test('空 repoRoot 返回错误', async () => {
  const result = await service.setGitStatusOptimization({ repoRoot: '   ', untrackedCache: true })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'Repository root is required.')
})
