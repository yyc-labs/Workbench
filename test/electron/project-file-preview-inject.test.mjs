import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { HTML_PREVIEW_BOOTSTRAP_MARKER, injectHtmlPreviewBootstrap, isHtmlPreviewContentType } = loadTsModule('src/core/electron/main/project-file/project-file-preview-inject.ts')

const toUtf8 = (value) => injectHtmlPreviewBootstrap(Buffer.from(value, 'utf8')).toString('utf8')

test('isHtmlPreviewContentType only matches HTML documents', () => {
  assert.equal(isHtmlPreviewContentType('text/html'), true)
  assert.equal(isHtmlPreviewContentType('text/html; charset=utf-8'), true)
  assert.equal(isHtmlPreviewContentType('text/css'), false)
  assert.equal(isHtmlPreviewContentType('application/json'), false)
})

test('injectHtmlPreviewBootstrap defines fallback variables and skips existing injections', () => {
  const html = '<!doctype html><html><head><title>t</title></head><body>中文内容</body></html>'
  const injected = toUtf8(html)

  assert.match(injected, /--font-sans:/)
  assert.match(injected, /中文内容/)
  assert.match(injected, /--color-text-secondary:/)
  assert.match(injected, /--color-text-tertiary:/)
  // Injected before </head>.
  assert.ok(injected.indexOf(HTML_PREVIEW_BOOTSTRAP_MARKER) < injected.indexOf('</head>'))
  assert.match(injected, /<meta charset="utf-8">/)
  assert.ok(injected.indexOf('<meta charset="utf-8">') < injected.indexOf(HTML_PREVIEW_BOOTSTRAP_MARKER))
  // Tabler webfont loads asynchronously.
  assert.match(injected, /@tabler\/icons-webfont@3/)
  assert.match(injected, /rel="preload"/)
  assert.match(injected, /preview:mouse-gesture/)

  assert.equal(injectHtmlPreviewBootstrap(Buffer.from(injected, 'utf8')).toString('utf8'), injected)
})

test('injectHtmlPreviewBootstrap handles documents without a head tag', () => {
  const noHead = '<html><body><h1>hi</h1></body></html>'
  const injected = toUtf8(noHead)
  assert.ok(injected.indexOf(HTML_PREVIEW_BOOTSTRAP_MARKER) < injected.indexOf('<body'))
})

test('injectHtmlPreviewBootstrap applies the requested preview theme', () => {
  const html = '<html><head></head><body>theme</body></html>'
  const dark = injectHtmlPreviewBootstrap(Buffer.from(html, 'utf8'), 'dark').toString('utf8')
  const light = injectHtmlPreviewBootstrap(Buffer.from(html, 'utf8'), 'light').toString('utf8')

  assert.match(dark, /color-scheme: dark;/)
  assert.match(dark, /--color-background: #1c1c1e;/)
  assert.match(light, /color-scheme: light;/)
  assert.match(light, /--color-background: #f5f5f7;/)
})

test('injectHtmlPreviewBootstrap keeps the DOCTYPE first for documents without head or body', () => {
  const bare = '<!DOCTYPE html>\n<div>hi</div>'
  const injected = toUtf8(bare)
  assert.ok(injected.startsWith('<!DOCTYPE html>'))
  assert.match(injected, /--font-sans:/)
})

test('injectHtmlPreviewBootstrap transcodes non-UTF-8 documents to UTF-8', () => {
  // "中文" encoded as GBK: 0xD6 0xD0 0xCE 0xC4
  const gbkBytes = Buffer.from([0xd6, 0xd0, 0xce, 0xc4])
  const html = Buffer.concat([Buffer.from('<html><body><p>'), gbkBytes, Buffer.from('</p></body></html>')])

  const injected = injectHtmlPreviewBootstrap(html)
  const text = injected.toString('utf8')
  // Transcoding keeps the Chinese text readable and forces UTF-8 decoding.
  assert.match(text, /<p>中文<\/p>/)
  assert.match(text, /<meta charset="utf-8">/)
  assert.match(text, /--font-sans:/)
  // The UTF-8 charset meta must come before the bootstrap so it stays in the
  // first 1024 bytes the browser scans for a charset declaration.
  assert.ok(text.indexOf('<meta charset="utf-8">') < text.indexOf(HTML_PREVIEW_BOOTSTRAP_MARKER))
})
