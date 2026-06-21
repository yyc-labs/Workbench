import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { readLocalImageAsDataUrl } = loadTsModule('src/core/electron/main/local-image-service.ts')

test('readLocalImageAsDataUrl reads a local png file url as data uri', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'local-image-'))
  const imagePath = join(dir, 'demo.png')
  const pngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
  writeFileSync(imagePath, Buffer.from(pngBase64, 'base64'))

  const fileUrl = `file://${imagePath.startsWith('/') ? imagePath : `/${imagePath.replace(/\\/g, '/')}`}`
  const dataUrl = await readLocalImageAsDataUrl(fileUrl)

  assert.match(dataUrl, /^data:image\/png;base64,/)
})
