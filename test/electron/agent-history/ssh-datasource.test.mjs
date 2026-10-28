import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../../helpers/load-ts-module.mjs'

const sshMod = loadTsModule('src/core/electron/main/agent-history/datasource/ssh.ts')
const scanMod = loadTsModule('src/core/electron/main/agent-history/scan-service.ts')

test('quoteRemotePath: absolute-only, single-quote escaping', () => {
  const { quoteRemotePath } = sshMod
  assert.equal(quoteRemotePath('/home/u/.claude/projects'), "'/home/u/.claude/projects'")
  assert.equal(quoteRemotePath("/home/u/it's"), "'/home/u/it'\\''s'")
  assert.throws(() => quoteRemotePath('relative/path'), /absolute/)
})

test('ssh:// project path parsing: user/host/port/remotePath', () => {
  const { extractSshInfo } = scanMod
  assert.deepEqual(extractSshInfo('ssh://dev@build.example.com/home/u/proj'), {
    host: 'build.example.com',
    user: 'dev',
    port: undefined,
    remotePath: '/home/u/proj',
  })
  assert.deepEqual(extractSshInfo('ssh://build.example.com:2222/home/u/proj'), {
    host: 'build.example.com',
    port: 2222,
    user: undefined,
    remotePath: '/home/u/proj',
  })
  assert.equal(extractSshInfo('ssh://bad path/x'), null)
  assert.equal(extractSshInfo('D:/local/project'), null)
  // Environment routing picks it up.
  const svc = scanMod
  assert.equal(typeof svc.extractSshInfo, 'function')
})

test('ssh datasource: watch unsupported, namespace carries host identity', () => {
  const ds = sshMod.createSshDataSource({ target: { host: 'Build.Example.com', user: 'dev' } })
  assert.equal(ds.supportsWatch, false)
  assert.equal(ds.watch, undefined)
  assert.equal(ds.namespaceId, 'ssh:dev@build.example.com')
})
