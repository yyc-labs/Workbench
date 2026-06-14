import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const {
  sanitizeMermaidSvgCssText,
  sanitizeMermaidSvgMarkup,
} = loadTsModule('src/core/renderer/pages/code/code.markdownMermaid.sanitize.ts')

test('sanitizeMermaidSvgMarkup keeps safe Mermaid SVG structure', () => {
  const svg = [
    '<svg id="diagram" class="flowchart" viewBox="0 0 100 40" xmlns="http://www.w3.org/2000/svg">',
    '<style>#diagram .node{fill:#fff;stroke:#333}.edge{marker-end:url(#arrow)}</style>',
    '<defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="5" refY="5"><path d="M 0 0 L 10 5 L 0 10 z" /></marker></defs>',
    '<g transform="translate(4, 4)"><rect x="0" y="0" width="80" height="24" rx="4" /><text x="8" y="16">Start</text></g>',
    '</svg>',
  ].join('')

  const sanitized = sanitizeMermaidSvgMarkup(svg)

  assert.match(sanitized, /<svg id="diagram" class="flowchart" viewBox="0 0 100 40"/)
  assert.match(sanitized, /marker-end:url\(#arrow\)/)
  assert.match(sanitized, /<marker id="arrow" markerWidth="10" markerHeight="10"/)
  assert.match(sanitized, /<text x="8" y="16">Start<\/text>/)
})

test('sanitizeMermaidSvgMarkup strips executable SVG payloads', () => {
  const svg = [
    '<svg onload="alert(1)" viewBox="0 0 100 40">',
    '<style>@import url(https://example.test/x.css);.node{fill:red}</style>',
    '<script>alert(1)</script>',
    '<foreignObject><body onload="alert(2)"></body></foreignObject>',
    '<image href="https://example.test/tracker.png" />',
    '<a href="javascript:alert(3)"><text>link</text></a>',
    '<g onclick="alert(4)" data-id="node-a"><text>Node</text></g>',
    '</svg>',
  ].join('')

  const sanitized = sanitizeMermaidSvgMarkup(svg)

  assert.doesNotMatch(sanitized, /onload|onclick|<script|foreignObject|<image|javascript:|https:/i)
  assert.doesNotMatch(sanitized, /@import|example\.test/i)
  assert.match(sanitized, /data-id="node-a"/)
  assert.match(sanitized, /<text>Node<\/text>/)
})

test('sanitizeMermaidSvgMarkup sanitizes style element content', () => {
  const svg = [
    '<svg viewBox="0 0 100 40">',
    '<style nonce="ignored" data-theme="light">.edge{marker-end:url(#arrow);stroke:#333}</style>',
    '<style>.bad{fill:url(javascript:alert(1))}</style>',
    '</svg>',
  ].join('')

  const sanitized = sanitizeMermaidSvgMarkup(svg)

  assert.match(sanitized, /<style data-theme="light">\.edge\{marker-end:url\(#arrow\);stroke:#333\}<\/style>/)
  assert.doesNotMatch(sanitized, /nonce|javascript|\.bad/i)
})

test('sanitizeMermaidSvgMarkup only allows local fragment references', () => {
  const svg = [
    '<svg viewBox="0 0 100 40">',
    '<use href="#safe-node" />',
    '<use href="https://example.test/icon.svg#bad" />',
    '<path marker-end="url(#arrow)" filter="url(https://example.test/filter.svg#x)" d="M 0 0 L 1 1" />',
    '</svg>',
  ].join('')

  const sanitized = sanitizeMermaidSvgMarkup(svg)

  assert.match(sanitized, /<use href="#safe-node" \/>/)
  assert.doesNotMatch(sanitized, /example\.test|https:/)
  assert.match(sanitized, /marker-end="url\(#arrow\)"/)
  assert.doesNotMatch(sanitized, /filter=/)
})

test('sanitizeMermaidSvgCssText drops dangerous CSS while preserving local paint servers', () => {
  assert.equal(
    sanitizeMermaidSvgCssText('.edge{marker-end:url(#arrow);stroke:#333}'),
    '.edge{marker-end:url(#arrow);stroke:#333}'
  )
  assert.equal(sanitizeMermaidSvgCssText('@import url(https://example.test/x.css);.node{fill:red}'), '')
  assert.equal(sanitizeMermaidSvgCssText('.node{background:url(javascript:alert(1));fill:red}'), '')
})
