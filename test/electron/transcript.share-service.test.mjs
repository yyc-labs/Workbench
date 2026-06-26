import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { createTranscriptShareService } = loadTsModule(
  'src/core/electron/main/transcript/transcriptShareService.ts'
)

function tokenFromUrl(url) {
  const match = /\/t\/([^/]+)$/.exec(url)
  return match ? match[1] : ''
}

function createFakeServerFactory() {
  const servers = []

  return {
    createServer(handler) {
      let errorHandler = null
      let listenHost = null
      let listenPort = 0
      const server = {
        once(event, listener) {
          if (event === 'error') {
            errorHandler = listener
          }
        },
        listen(port, host, callback) {
          listenPort = port || 17374
          listenHost = host
          callback()
        },
        address() {
          return { port: listenPort || 17374 }
        },
        close(callback) {
          callback()
        },
        async dispatch(pathname) {
          return await new Promise((resolve, reject) => {
            let body = ''
            let statusCode = 200
            const req = { method: 'GET', url: pathname }
            const res = {
              writeHead(code) {
                statusCode = code
              },
              end(chunk = '') {
                body += chunk
                resolve({ statusCode, body })
              },
            }
            try {
              handler(req, res)
            } catch (error) {
              reject(error)
            }
          })
        },
        emitError(error) {
          errorHandler?.(error)
        },
        get listenHost() {
          return listenHost
        },
      }
      servers.push(server)
      return server
    },
    getLastServer() {
      return servers[servers.length - 1] || null
    },
  }
}

test('share lifecycle: start serves HTML, stop revokes the token', async () => {
  const fakeServerFactory = createFakeServerFactory()
  const service = createTranscriptShareService({
    port: 17374,
    preferredListenHosts: ['127.0.0.1'],
    createServer: fakeServerFactory.createServer,
  })
  try {
    const { entry } = await service.start({
      projectId: 'p1',
      transcriptId: 't1',
      title: 'Demo',
      html: '<!doctype html><html><body><h1>hello-share</h1></body></html>',
    })

    assert.match(entry.url, /^http:\/\/.+\/t\/[a-f0-9]+$/)
    assert.equal(entry.transcriptId, 't1')

    const server = fakeServerFactory.getLastServer()
    const ok = await server.dispatch(`/t/${entry.token}`)
    assert.equal(ok.statusCode, 200)
    const body = ok.body
    assert.match(body, /hello-share/)

    const afterStop = service.stop(entry.token)
    assert.equal(afterStop.entries.some((item) => item.token === entry.token), false)

    const gone = await server.dispatch(`/t/${entry.token}`)
    assert.equal(gone.statusCode, 404)
  } finally {
    await service.shutdown()
  }
})

test('share inlines file:// images as data URIs via placeholder', async () => {
  const fakeServerFactory = createFakeServerFactory()
  const service = createTranscriptShareService({
    port: 17374,
    preferredListenHosts: ['127.0.0.1'],
    createServer: fakeServerFactory.createServer,
  })
  try {
    const dir = mkdtempSync(join(tmpdir(), 'share-img-'))
    const imagePath = join(dir, 'pic.png')
    // 1x1 transparent PNG
    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
    writeFileSync(imagePath, Buffer.from(pngBase64, 'base64'))
    const fileUrl = `file://${imagePath.startsWith('/') ? imagePath : `/${imagePath.replace(/\\/g, '/')}`}`

    const { entry } = await service.start({
      projectId: 'p1',
      transcriptId: 't2',
      title: 'WithImage',
      html: '<!doctype html><html><body><img src="__IMG0__"></body></html>',
      images: [{ placeholder: '__IMG0__', fileUrl }],
    })

    const server = fakeServerFactory.getLastServer()
    const res = await server.dispatch(`/t/${entry.token}`)
    const body = res.body
    assert.match(body, /data:image\/png;base64,/)
    assert.equal(body.includes('__IMG0__'), false)
  } finally {
    await service.shutdown()
  }
})

test('multiple shares coexist with independent tokens', async () => {
  const fakeServerFactory = createFakeServerFactory()
  const service = createTranscriptShareService({
    port: 17374,
    preferredListenHosts: ['127.0.0.1'],
    createServer: fakeServerFactory.createServer,
  })
  try {
    const a = await service.start({ projectId: 'p', transcriptId: 'a', title: 'A', html: '<p>A</p>' })
    const b = await service.start({ projectId: 'p', transcriptId: 'b', title: 'B', html: '<p>B</p>' })

    assert.notEqual(tokenFromUrl(a.entry.url), tokenFromUrl(b.entry.url))
    const list = service.list()
    assert.equal(list.entries.length, 2)
    assert.equal(list.running, true)

    // Revoking one leaves the other reachable.
    service.stop(a.entry.token)
    const server = fakeServerFactory.getLastServer()
    const stillThere = await server.dispatch(`/t/${b.entry.token}`)
    assert.equal(stillThere.statusCode, 200)
  } finally {
    await service.shutdown()
  }
})

test('prefers 192.168.x.x LAN addresses over 10.x and exposes alternate hosts', async () => {
  const service = createTranscriptShareService({
    port: 17374,
    preferredListenHosts: ['0.0.0.0'],
    createServer: () => {
      let errorHandler = null
      return {
        once(event, listener) {
          if (event === 'error') errorHandler = listener
        },
        listen(_port, _host, callback) {
          callback()
        },
        address() {
          return { port: 17374 }
        },
        close(callback) {
          callback()
        },
        emitError(error) {
          errorHandler?.(error)
        },
      }
    },
    networkInterfaces: () => ({
      'Wi-Fi Direct': [
        { address: '192.168.31.1', family: 'IPv4', internal: false },
      ],
      'vEthernet (WSL)': [
        { address: '172.29.96.1', family: 'IPv4', internal: false },
      ],
      'Wi-Fi': [
        { address: '10.23.63.188', family: 'IPv4', internal: false },
      ],
      'Ethernet': [
        { address: '192.168.1.20', family: 'IPv4', internal: false },
      ],
    }),
  })

  try {
    const { entry, host, hosts, port } = await service.start({
      projectId: 'p',
      transcriptId: 'multi-host',
      title: 'Network test',
      html: '<p>network</p>',
    })

    assert.equal(host, '192.168.31.1')
    assert.equal(entry.url, `http://${host}:${port}/t/${entry.token}`)
    assert.deepEqual(
      hosts.map((item) => ({ host: item.host, kind: item.kind, interfaceName: item.interfaceName })),
      [
        { host: '192.168.31.1', kind: 'wifi', interfaceName: 'Wi-Fi Direct' },
        { host: '192.168.1.20', kind: 'ethernet', interfaceName: 'Ethernet' },
        { host: '10.23.63.188', kind: 'wifi', interfaceName: 'Wi-Fi' },
        { host: '172.29.96.1', kind: 'virtual', interfaceName: 'vEthernet (WSL)' },
      ]
    )
  } finally {
    await service.shutdown()
  }
})

test('falls back to loopback binding when LAN binding fails', async () => {
  let listenCount = 0
  const service = createTranscriptShareService({
    port: 17374,
    preferredListenHosts: ['0.0.0.0', '127.0.0.1'],
    createServer: () => {
      let errorHandler = null
      return {
        once(event, listener) {
          if (event === 'error') errorHandler = listener
        },
        listen(_port, host, callback) {
          listenCount += 1
          if (host === '0.0.0.0') {
            errorHandler?.(new Error('listen EPERM'))
            return
          }
          callback()
        },
        address() {
          return { port: 17374 }
        },
        close(callback) {
          callback()
        },
      }
    },
    networkInterfaces: () => ({
      Ethernet: [
        { address: '192.168.1.20', family: 'IPv4', internal: false },
      ],
    }),
  })

  try {
    const { host, hosts, bindingMode, entry } = await service.start({
      projectId: 'p',
      transcriptId: 'loopback',
      title: 'Loopback fallback',
      html: '<p>fallback</p>',
    })

    assert.equal(listenCount, 2)
    assert.equal(bindingMode, 'loopback')
    assert.equal(host, '127.0.0.1')
    assert.deepEqual(hosts, [
      { host: '127.0.0.1', interfaceName: 'loopback', kind: 'other' },
    ])
    assert.match(entry.url, /^http:\/\/127\.0\.0\.1:17374\/t\/[a-f0-9]+$/)
  } finally {
    await service.shutdown()
  }
})
