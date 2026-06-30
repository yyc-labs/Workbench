import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const {
  buildWslTempScriptPathCommand,
  buildNativeSshCommand,
  describeWslCommandForDebug,
  buildWslTempScriptWriteCommand,
  buildWslSshRunnerScript,
  buildWtWslExecArgs,
  decodeWslProcessOutput,
  getWslSshSetupTimeoutMs,
  mapWslSshFailure,
  openSshTerminal,
  resolveSshOpenRoute,
} = loadTsModule('src/core/electron/main/shell/openers.ts')

test('buildWslSshRunnerScript avoids wt heredoc parsing, preserves special characters, and keeps expect stdin attached to the terminal', () => {
  const script = buildWslSshRunnerScript({
    host: "example'host",
    port: 2222,
    username: "dev'user",
    password: "pa'ss$word",
  })

  assert.match(script, /^#!\/usr\/bin\/env bash/m)
  assert.match(script, /rm -f -- "\$0"/)
  assert.match(script, /export IDE_ELECTRON_SSH_USER='dev'\\''user'/)
  assert.match(script, /export IDE_ELECTRON_SSH_HOST='example'\\''host'/)
  assert.match(script, /export IDE_ELECTRON_SSH_PORT='2222'/)
  assert.match(script, /export IDE_ELECTRON_SSH_PASS='pa'\\''ss\$word'/)
  assert.match(script, /expect_script=\$\(mktemp \/tmp\/ide-electron-ssh-expect\.XXXXXX\.exp\)/)
  assert.match(script, /cat > "\$expect_script" <<'EOF_EXPECT'/)
  assert.match(script, /set ssh_pass \$env\(IDE_ELECTRON_SSH_PASS\)/)
  assert.match(script, /-re "\(\?i\)password:" \{ send "\$ssh_pass\\r" \}/)
  assert.match(script, /^expect "\$expect_script"$/m)
  assert.doesNotMatch(script, /expect <<'EOF_EXPECT'/)
})

test('buildWslTempScriptPathCommand creates the temp script path in /tmp', () => {
  assert.equal(buildWslTempScriptPathCommand(), 'mktemp /tmp/ide-electron-ssh.XXXXXX.sh')
})

test('buildWslTempScriptWriteCommand writes the script through base64 instead of heredoc', () => {
  const command = buildWslTempScriptWriteCommand('/tmp/ide-electron-ssh.abcd12.sh', '#!/usr/bin/env bash\necho ok\n')

  assert.match(command, /printf %s '.*' \| base64 -d > '\/tmp\/ide-electron-ssh\.abcd12\.sh'/)
  assert.match(command, /test -s '\/tmp\/ide-electron-ssh\.abcd12\.sh'/)
  assert.doesNotMatch(command, /\$tmpfile/)
  assert.doesNotMatch(command, /<<'/)
})

test('describeWslCommandForDebug redacts the temp script write command to avoid leaking SSH secrets', () => {
  const script = buildWslSshRunnerScript({
    host: 'example.com',
    port: 22,
    username: 'dev',
    password: 'super-secret-password',
  })
  const command = buildWslTempScriptWriteCommand('/tmp/ide-electron-ssh.abcd12.sh', script)
  const preview = describeWslCommandForDebug(command)

  assert.match(preview, /redacted/i)
  assert.doesNotMatch(preview, /super-secret-password/)
  assert.doesNotMatch(preview, /IDE_ELECTRON_SSH_PASS/)
})

test('describeWslCommandForDebug truncates long non-sensitive commands', () => {
  const preview = describeWslCommandForDebug(`echo ${'x'.repeat(300)}`)

  assert.match(preview, /\.\.\.\(305 chars\)$/)
  assert.ok(preview.length < 270)
})

test('buildWtWslExecArgs uses the same wt wsl launch shape as other WSL terminals', () => {
  assert.deepEqual(
    buildWtWslExecArgs('Ubuntu', ['bash', '/tmp/ide-electron-ssh.abc123.sh']),
    ['wsl', '-d', 'Ubuntu', '--', 'bash', '/tmp/ide-electron-ssh.abc123.sh']
  )
})

test('WSL SSH setup allows a cold-start window only for the first distro entry', () => {
  assert.equal(getWslSshSetupTimeoutMs('verify-wsl-distro'), 30000)
  assert.equal(getWslSshSetupTimeoutMs('verify-bash'), 5000)
  assert.equal(getWslSshSetupTimeoutMs('verify-expect'), 5000)
  assert.equal(getWslSshSetupTimeoutMs('create-temp-script-path'), 5000)
})

test('resolveSshOpenRoute only keeps the WSL route on Windows hosts', () => {
  assert.equal(resolveSshOpenRoute('wsl', 'win32'), 'wsl')
  assert.equal(resolveSshOpenRoute('windows', 'win32'), 'native')
  assert.equal(resolveSshOpenRoute('wsl', 'linux'), 'native')
  assert.equal(resolveSshOpenRoute('windows', 'linux'), 'native')
})

test('buildNativeSshCommand only includes an explicit port when needed', () => {
  assert.equal(
    buildNativeSshCommand({
      host: 'example.com',
      port: 22,
      username: 'dev',
    }),
    'ssh dev@example.com'
  )
  assert.equal(
    buildNativeSshCommand({
      host: 'example.com',
      port: 2200,
      username: 'dev',
    }),
    'ssh -p 2200 dev@example.com'
  )
})

test('openSshTerminal rejects invalid input before attempting terminal launch', async () => {
  const result = await openSshTerminal('Ubuntu', {
    host: '',
    username: 'dev',
    password: 'secret',
    route: 'wsl',
  })

  assert.equal(result.ok, false)
  assert.equal(result.mode, 'native-ssh')
  assert.equal(result.autoLogin, false)
  assert.equal(result.reason, 'invalid-input')
  assert.match(result.message ?? '', /required/i)
})

test('decodeWslProcessOutput preserves utf16le wsl.exe diagnostics', () => {
  const raw = '检测到 localhost 代理配置，但是未镜像到 WSL。NAT 模式下 WSL 不支持 localhost 代理。'
  const decoded = decodeWslProcessOutput(Buffer.from(raw, 'utf16le'))
  assert.equal(decoded, raw)
})

test('decodeWslProcessOutput preserves mixed WSL and bash stderr chunks', () => {
  const warning = 'wsl: 检测到 localhost 代理配置，但未镜像到 WSL。NAT 模式下的 WSL 不支持 localhost 代理。\r\n'
  const bashError = 'bash: line 1: : No such file or directory\nWSL SSH temp script is empty: \n'
  const decoded = decodeWslProcessOutput([
    Buffer.from(warning, 'utf16le'),
    Buffer.from(bashError, 'utf8'),
  ])

  assert.equal(decoded, `${warning}${bashError}`)
})

test('mapWslSshFailure returns specific reasons for common WSL setup failures', () => {
  assert.deepEqual(
    mapWslSshFailure('Ubuntu', new Error('WSL_DISTRO_UNAVAILABLE')),
    {
      reason: 'wsl-distro-unavailable',
      message: 'WSL SSH is unavailable because distro "Ubuntu" was not found.',
    }
  )

  assert.deepEqual(
    mapWslSshFailure('Ubuntu', new Error('WSL_EXPECT_UNAVAILABLE')),
    {
      reason: 'wsl-expect-unavailable',
      message: 'WSL SSH is unavailable because `expect` is not installed in distro "Ubuntu".',
    }
  )
})

test('mapWslSshFailure treats temp script write failures as terminal launch failures', () => {
  const result = mapWslSshFailure(
    'Ubuntu',
    new Error('WSL SSH temp script is empty: /tmp/ide-electron-ssh.abcd.sh')
  )

  assert.equal(result.reason, 'terminal-launch-failed')
  assert.match(result.message, /failed to create a temporary login script/i)
})

test('mapWslSshFailure treats mktemp failures as temp script creation errors', () => {
  const result = mapWslSshFailure(
    'Ubuntu',
    new Error("mktemp: failed to create file via template '/tmp/ide-electron-ssh.XXXXXX.sh': Permission denied")
  )

  assert.equal(result.reason, 'terminal-launch-failed')
  assert.match(result.message, /failed to create a temporary login script/i)
})
