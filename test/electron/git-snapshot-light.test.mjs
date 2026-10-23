import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { createGitSnapshotReader } = loadTsModule('src/core/electron/main/git/git-snapshot.ts')

const HEAD_OID = '0a'.repeat(20)
const UPSTREAM_OID = 'b1'.repeat(20)

const STATUS_OUTPUT = ['# branch.oid ' + HEAD_OID, '# branch.head main', '# branch.upstream origin/main', '# branch.ab +1 -2', '1 M. N... 100644 100644 100644 1111111111111111111111111111111111111111 2222222222222222222222222222222222222222 src/app.ts', '? docs/notes.md'].join('\x00')

// 只实现 reader 用到的 runGitCommand；记录调用序列用于断言轻量快照的进程数
function createFakeRunner() {
  const calls = []
  const respond = (args) => {
    const [cmd] = args
    if (cmd === 'rev-parse' && args[1] === '--show-toplevel') return { code: 0, stdout: '/repo\n', stderr: '' }
    if (cmd === 'status') return { code: 0, stdout: STATUS_OUTPUT, stderr: '' }
    if (cmd === 'for-each-ref') {
      return {
        code: 0,
        stdout: [`refs/heads/main\x00${UPSTREAM_OID}\x00origin/main\x00*\x1e`, `refs/heads/feature\x00${HEAD_OID}\x00\x00\x1e`, `refs/remotes/origin/main\x00${UPSTREAM_OID}\x00\x00\x1e`, `refs/remotes/origin/HEAD\x00${UPSTREAM_OID}\x00\x00\x1e`].join(''),
        stderr: '',
      }
    }
    if (cmd === 'log' && args.some((arg) => arg.includes('%x00'))) {
      return { code: 0, stdout: `${HEAD_OID}\x00src/app.ts\x00`, stderr: '' }
    }
    if (cmd === 'log') {
      return { code: 0, stdout: `${HEAD_OID}\x1f0a0a0a0\x1ffeat: baseline\x1fTester\x1f2026-10-23T00:00:00+00:00\x1f\x1fbody\x1e`, stderr: '' }
    }
    if (cmd === 'rev-parse' && args[1] === '--verify') return { code: 0, stdout: UPSTREAM_OID + '\n', stderr: '' }
    throw new Error('unexpected git command: ' + args.join(' '))
  }
  const runGitCommand = async (cwd, args) => {
    calls.push(args)
    return respond(args)
  }
  return {
    calls,
    runGitCommand,
    async listGitLines(cwd, args) {
      const result = await runGitCommand(cwd, args)
      if (result.code !== 0) return []
      return result.stdout
        .replace(/\r/g, '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    },
  }
}

test('full snapshot fills recentCommits, upstreamOid and marks snapshotKind=full', async () => {
  const reader = createGitSnapshotReader(createFakeRunner())
  const snap = await reader.readGitRepositorySnapshot('/repo', 'ui-refresh')
  assert.equal(snap.snapshotKind, 'full')
  assert.equal(snap.isGitRepository, true)
  assert.equal(snap.recentCommits.length, 1)
  assert.equal(snap.recentCommits[0].hash, HEAD_OID)
  assert.deepEqual(snap.recentCommits[0].changedFiles, ['src/app.ts'])
  assert.equal(snap.branch.upstreamOid, UPSTREAM_OID)
  assert.equal(snap.branch.upstreamGone, false)
  assert.equal(snap.branch.current, 'main')
  assert.equal(snap.branch.ahead, 1)
  assert.equal(snap.branch.behind, 2)
  assert.deepEqual(snap.branch.localBranches, ['main', 'feature'])
  assert.deepEqual(snap.branch.remoteBranches, ['origin/main'])
  assert.equal(snap.changedFileCount, 2)
})

test('lightweight snapshot skips both logs and upstream oid, other fields match full', async () => {
  const runner = createFakeRunner()
  const light = await createGitSnapshotReader(runner).readGitRepositorySnapshot('/repo', 'precheck', { lightweight: true })
  assert.equal(light.snapshotKind, 'light')
  assert.deepEqual(light.recentCommits, [])
  assert.equal(light.branch.upstreamOid, undefined)
  // 轻量快照 = toplevel + status + for-each-ref，共 3 个进程，且不执行任何 log
  assert.equal(runner.calls.length, 3)
  assert.ok(!runner.calls.some((args) => args[0] === 'log'))
  // 除 recentCommits / upstreamOid / checkedAt 外逐字段与 full 一致
  const full = await createGitSnapshotReader(createFakeRunner()).readGitRepositorySnapshot('/repo', 'ui-refresh')
  assert.deepEqual(
    {
      ...light,
      snapshotKind: 'full',
      recentCommits: full.recentCommits,
      checkedAt: full.checkedAt,
      branch: { ...light.branch, upstreamOid: full.branch.upstreamOid },
    },
    full,
  )
})

test('changedFilesLimit overrides the display cap (app setting passthrough)', async () => {
  const reader = createGitSnapshotReader(createFakeRunner())
  const limited = await reader.readGitRepositorySnapshot('/repo', 'ui-refresh', { changedFilesLimit: 1 })
  assert.equal(limited.changedFileCount, 2)
  assert.equal(limited.changedFilesSuppressed, true)
  assert.deepEqual(limited.changedFiles, [])
  const generous = await reader.readGitRepositorySnapshot('/repo', 'ui-refresh', { changedFilesLimit: 100 })
  assert.equal(generous.changedFilesSuppressed, false)
  assert.equal(generous.changedFiles.length, 2)
  // 非法值回退默认 99
  const invalid = await reader.readGitRepositorySnapshot('/repo', 'ui-refresh', { changedFilesLimit: 0 })
  assert.equal(invalid.changedFilesSuppressed, false)
})

test('readGitRefOid is exported and validates 40-hex oids', async () => {
  const reader = createGitSnapshotReader(createFakeRunner())
  assert.equal(await reader.readGitRefOid('/repo', 'HEAD'), UPSTREAM_OID)
  const nonHex = {
    async runGitCommand() {
      return { code: 0, stdout: 'short\n', stderr: '' }
    },
  }
  assert.equal(await createGitSnapshotReader(nonHex).readGitRefOid('/repo', 'HEAD'), undefined)
  const failed = {
    async runGitCommand() {
      return { code: 128, stdout: '', stderr: 'fatal' }
    },
  }
  assert.equal(await createGitSnapshotReader(failed).readGitRefOid('/repo', 'HEAD'), undefined)
})
