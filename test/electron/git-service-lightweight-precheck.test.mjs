import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

// 轻量预检（O2）的 skip 语义回归：对照 plan-detail §1.4 预检字段依赖表，
// 用真实临时仓库断言各 operation 的 skip 结论与原实现一致。
const { createGitService } = loadTsModule('src/core/electron/main/git/git-service.ts')

const service = createGitService({ getDefaultWslDistro: () => 'Ubuntu', getLocale: () => 'en' })

function runGit(cwd, ...args) {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString()
}

function createTempRepo(t, { bare = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'wb-git-svc-'))
  t.after(() => {
    try {
      rmSync(root, { recursive: true, force: true })
    } catch {
      // Windows 下偶发只读文件清理失败不影响测试结论
    }
  })
  runGit(root, 'init', bare ? '--bare' : '.', ...(bare ? ['-b', 'main'] : ['-b', 'main']))
  if (!bare) {
    runGit(root, 'config', 'user.email', 'workbench-test@example.com')
    runGit(root, 'config', 'user.name', 'Workbench Test')
    writeFileSync(join(root, 'a.txt'), 'hello\n')
    runGit(root, 'add', '.')
    runGit(root, 'commit', '-m', 'init')
  }
  return root
}

test('commit: nothing staged skips (other)', async (t) => {
  const repo = createTempRepo(t)
  const result = await service.runGitOperation({ repoRoot: repo, operation: 'commit', message: 'x' })
  assert.equal(result.skipped, true)
  assert.equal(result.skipReason, 'other')
})

test('commit: staged changes commit and commitHead comes from rev-parse HEAD (O1)', async (t) => {
  const repo = createTempRepo(t)
  writeFileSync(join(repo, 'b.txt'), 'new\n')
  runGit(repo, 'add', '.')
  const result = await service.runGitOperation({ repoRoot: repo, operation: 'commit', message: 'second' })
  assert.equal(result.ok, true)
  assert.equal(result.commitHead, runGit(repo, 'rev-parse', 'HEAD').trim())
})

test('pull: missing upstream skips (missing-upstream)', async (t) => {
  const repo = createTempRepo(t)
  const result = await service.runGitOperation({ repoRoot: repo, operation: 'pull' })
  assert.equal(result.skipped, true)
  assert.equal(result.skipReason, 'missing-upstream')
})

test('push: upstream set and nothing ahead skips (nothing-to-push)', async (t) => {
  const repo = createTempRepo(t)
  const remote = createTempRepo(t, { bare: true })
  runGit(repo, 'remote', 'add', 'origin', remote)
  runGit(repo, 'push', '-u', 'origin', 'main')
  const result = await service.runGitOperation({ repoRoot: repo, operation: 'push' })
  assert.equal(result.skipped, true)
  assert.equal(result.skipReason, 'nothing-to-push')
})

test('merge: dirty worktree skips (dirty-worktree)', async (t) => {
  const repo = createTempRepo(t)
  writeFileSync(join(repo, 'a.txt'), 'dirty\n')
  const result = await service.runGitOperation({ repoRoot: repo, operation: 'merge', targetBranch: 'other' })
  assert.equal(result.skipped, true)
  assert.equal(result.skipReason, 'dirty-worktree')
})

test('switch: target equals current skips (already-on-target)', async (t) => {
  const repo = createTempRepo(t)
  const result = await service.runGitOperation({ repoRoot: repo, operation: 'switch', targetBranch: 'main' })
  assert.equal(result.skipped, true)
  assert.equal(result.skipReason, 'already-on-target')
})

test('undo-commit: stale expectedHead skips (other)', async (t) => {
  const repo = createTempRepo(t)
  const result = await service.runGitOperation({ repoRoot: repo, operation: 'undo-commit', expectedHead: 'f'.repeat(40) })
  assert.equal(result.skipped, true)
  assert.equal(result.skipReason, 'other')
})

test('create-local-branch: existing local branch skips (already-on-target)', async (t) => {
  const repo = createTempRepo(t)
  const result = await service.runGitOperation({ repoRoot: repo, operation: 'create-local-branch', targetBranch: 'main' })
  assert.equal(result.skipped, true)
  assert.equal(result.skipReason, 'already-on-target')
})

test('delete-local-branch: current branch skips (target-is-current)', async (t) => {
  const repo = createTempRepo(t)
  const result = await service.runGitOperation({ repoRoot: repo, operation: 'delete-local-branch', targetBranch: 'main' })
  assert.equal(result.skipped, true)
  assert.equal(result.skipReason, 'target-is-current')
})

test('set-upstream: unknown remote ref skips (target-not-found)', async (t) => {
  const repo = createTempRepo(t)
  const result = await service.runGitOperation({ repoRoot: repo, operation: 'set-upstream', targetBranch: 'origin/nope' })
  assert.equal(result.skipped, true)
  assert.equal(result.skipReason, 'target-not-found')
})
