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

test('share lifecycle: start serves HTML, stop revokes the token', async () => {
  const service = createTranscriptShareService({ port: 0 })
  try {
    const { entry } = await service.start({
      projectId: 'p1',
      transcriptId: 't1',
      title: 'Demo',
      html: '<!doctype html><html><body><h1>hello-share</h1></body></html>',
    })

    assert.match(entry.url, /^http:\/\/.+\/t\/[a-f0-9]+$/)
    assert.equal(entry.transcriptId, 't1')

    const ok = await fetch(entry.url)
    assert.equal(ok.status, 200)
    const body = await ok.text()
    assert.match(body, /hello-share/)

    const afterStop = service.stop(entry.token)
    assert.equal(afterStop.entries.some((item) => item.token === entry.token), false)

    const gone = await fetch(entry.url)
    assert.equal(gone.status, 404)
  } finally {
    await service.shutdown()
  }
})

test('share inlines file:// images as data URIs via placeholder', async () => {
  const service = createTranscriptShareService({ port: 0 })
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

    const res = await fetch(entry.url)
    const body = await res.text()
    assert.match(body, /data:image\/png;base64,/)
    assert.equal(body.includes('__IMG0__'), false)
  } finally {
    await service.shutdown()
  }
})

test('multiple shares coexist with independent tokens', async () => {
  const service = createTranscriptShareService({ port: 0 })
  try {
    const a = await service.start({ projectId: 'p', transcriptId: 'a', title: 'A', html: '<p>A</p>' })
    const b = await service.start({ projectId: 'p', transcriptId: 'b', title: 'B', html: '<p>B</p>' })

    assert.notEqual(tokenFromUrl(a.entry.url), tokenFromUrl(b.entry.url))
    const list = service.list()
    assert.equal(list.entries.length, 2)
    assert.equal(list.running, true)

    // Revoking one leaves the other reachable.
    service.stop(a.entry.token)
    const stillThere = await fetch(b.entry.url)
    assert.equal(stillThere.status, 200)
  } finally {
    await service.shutdown()
  }
})

test('prefers 192.168.x.x LAN addresses over 10.x and exposes alternate hosts', async () => {
  const service = createTranscriptShareService({
    port: 0,
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
