import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const {
  DEFAULT_BROWSER_AI_CONFIG,
  buildEdgeLaunchArgs,
  getDefaultEdgeExecutablePath,
  getDefaultEdgeExecutablePaths,
  isSupportedBrowserAiSiteUrl,
  isSupportedChatGptSiteUrl,
  normalizeBrowserAiConfig,
  resolveBrowserAiProfilePath,
} = loadTsModule('src/core/electron/main/browser-ai/browserAiConfig.ts')
const {
  BrowserAiContextError,
  MAX_BROWSER_AI_CONTEXT_CHARS,
  MAX_BROWSER_AI_SOURCE_CHARS,
  composeBrowserAiContext,
} = loadTsModule('src/core/electron/main/browser-ai/contextComposer.ts')
const { genericWebAiAdapter } = loadTsModule('src/core/electron/main/browser-ai/site-adapters/genericWebAiAdapter.ts')
const { createBrowserAiRepository } = loadTsModule('src/core/electron/main/browser-ai/browserAiRepository.ts')

test('browser AI config keeps CDP on loopback and normalizes invalid values', () => {
  const config = normalizeBrowserAiConfig({
    mode: 'external-cdp',
    cdpHost: '0.0.0.0',
    cdpPort: 99_999,
    responseTimeoutMs: 1,
  })

  assert.equal(config.cdpHost, '127.0.0.1')
  assert.equal(config.cdpPort, undefined)
  assert.equal(config.responseTimeoutMs, 10_000)
  assert.equal(config.site, DEFAULT_BROWSER_AI_CONFIG.site)
  assert.equal(config.siteUrl, DEFAULT_BROWSER_AI_CONFIG.siteUrl)
  assert.equal(config.activeSiteId, DEFAULT_BROWSER_AI_CONFIG.activeSiteId)
  assert.deepEqual(config.sites, DEFAULT_BROWSER_AI_CONFIG.sites)
})

test('browser AI migrates the legacy single-site URL into a site profile list', () => {
  const config = normalizeBrowserAiConfig({ site: 'chatgpt-web', siteUrl: 'https://chat.openai.com/' })
  assert.equal(config.sites.length, 1)
  assert.equal(config.sites[0].name, 'ChatGPT')
  assert.equal(config.sites[0].url, 'https://chat.openai.com/')
  assert.equal(config.siteUrl, 'https://chat.openai.com/')
})

test('browser AI keeps the selected site profile as the active dispatch target', () => {
  const config = normalizeBrowserAiConfig({
    sites: [
      { id: 'chatgpt-main', name: 'Main ChatGPT', url: 'https://chatgpt.com/' },
      { id: 'chatgpt-alt', name: 'Alternate ChatGPT', url: 'https://chat.openai.com/' },
    ],
    activeSiteId: 'chatgpt-alt',
  })
  assert.equal(config.activeSiteId, 'chatgpt-alt')
  assert.equal(config.site, 'chatgpt-web')
  assert.equal(config.siteUrl, 'https://chat.openai.com/')
})

test('browser AI accepts arbitrary HTTPS web AI sites while retaining ChatGPT URL validation', () => {
  const config = normalizeBrowserAiConfig({
    siteUrl: 'https://claude.ai/new',
    sites: [{ id: 'claude', name: 'Claude', url: 'https://claude.ai/new', site: 'generic-web' }],
  })
  assert.equal(config.siteUrl, 'https://claude.ai/new')
  assert.equal(config.site, 'generic-web')
  assert.equal(isSupportedBrowserAiSiteUrl('https://claude.ai/new'), true)
  assert.equal(isSupportedBrowserAiSiteUrl('https://example.com/'), true)
  assert.equal(isSupportedBrowserAiSiteUrl('http://example.com/'), false)
  assert.equal(isSupportedChatGptSiteUrl('https://chatgpt.com/'), true)
  assert.equal(isSupportedChatGptSiteUrl('https://example.com/'), false)
})

test('generic web AI adapter keeps page matching scoped to the configured HTTPS host', () => {
  assert.equal(genericWebAiAdapter.matchesPage('https://claude.ai/chat', 'https://claude.ai/'), true)
  assert.equal(genericWebAiAdapter.matchesPage('https://sub.claude.ai/chat', 'https://claude.ai/'), true)
  assert.equal(genericWebAiAdapter.matchesPage('https://example.com/chat', 'https://claude.ai/'), false)
  assert.equal(genericWebAiAdapter.matchesPage('http://claude.ai/chat', 'https://claude.ai/'), false)
})

test('browser AI launch args use an isolated profile and never expose a public CDP address', () => {
  const args = buildEdgeLaunchArgs(DEFAULT_BROWSER_AI_CONFIG, 45678, 'C:\\app-data\\browser-ai\\edge-profile')
  assert.ok(args.includes('--remote-debugging-address=127.0.0.1'))
  assert.ok(args.includes('--remote-debugging-port=45678'))
  assert.ok(args.includes('--user-data-dir=C:\\app-data\\browser-ai\\edge-profile'))
  assert.equal(args.some((value) => value.includes('0.0.0.0')), false)
  assert.equal(resolveBrowserAiProfilePath('C:\\app-data'), 'C:\\app-data\\browser-ai\\edge-profile')
})

test('browser AI Edge detection checks configured path before standard Windows locations', () => {
  const paths = getDefaultEdgeExecutablePaths({
    'ProgramFiles(x86)': 'X:\\Program Files (x86)',
    ProgramFiles: 'Y:\\Program Files',
  })
  assert.deepEqual(paths, [
    'X:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'Y:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ])
})

test('browser AI exposes a default browser executable path for settings', () => {
  assert.equal(
    getDefaultEdgeExecutablePath({
      'ProgramFiles(x86)': 'X:\\Program Files (x86)',
      ProgramFiles: 'Y:\\Program Files',
    }),
    'X:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  )
})

test('browser AI context preserves selected source order, redacts local paths, and marks sensitive sources', () => {
  const result = composeBrowserAiContext({
    site: 'chatgpt-web',
    task: 'Explain the key tradeoff.',
    responseFormat: 'Use three bullets.',
    sources: [
      { kind: 'learning-note', label: 'Note', content: 'Path C:\\Users\\me\\secret.md', included: true },
      { kind: 'personal-context', label: 'Personal', content: 'Keep it concise.', included: true },
      { kind: 'skill', label: 'Skill', content: 'Be precise.', included: true },
      { kind: 'learning-note', label: 'Excluded', content: 'Do not send.', included: false },
    ],
  })

  assert.deepEqual(result.sourceLabels, ['Skill', 'Personal', 'Note', 'Current task'])
  assert.match(result.prompt, /<skill>[\s\S]*Be precise\.[\s\S]*<\/skill>/)
  assert.match(result.prompt, /\[local-path\]/)
  assert.doesNotMatch(result.prompt, /Do not send/)
  assert.equal(result.sources.find((source) => source.label === 'Personal')?.sensitive, true)
  assert.match(result.prompt, /<task>[\s\S]*Explain the key tradeoff\.[\s\S]*<\/task>/)
  assert.match(result.prompt, /<response_format>[\s\S]*Use three bullets\.[\s\S]*<\/response_format>/)
})

test('browser AI context rejects oversized sources and total context without silent truncation', () => {
  assert.throws(
    () => composeBrowserAiContext({
      site: 'chatgpt-web',
      task: 'Task',
      sources: [{ kind: 'skill', label: 'Large', content: 'x'.repeat(MAX_BROWSER_AI_SOURCE_CHARS + 1), included: true }],
    }),
    (error) => error instanceof BrowserAiContextError && error.code === 'CONTEXT_TOO_LARGE',
  )

  assert.throws(
    () => composeBrowserAiContext({
      site: 'chatgpt-web',
      task: 'x'.repeat(MAX_BROWSER_AI_CONTEXT_CHARS),
      sources: [],
    }),
    (error) => error instanceof BrowserAiContextError && error.code === 'CONTEXT_TOO_LARGE',
  )
})

test('browser AI context allows source-only tasks and omits an empty task block', () => {
  const result = composeBrowserAiContext({
    site: 'chatgpt-web',
    sources: [{ kind: 'learning-note', label: 'Note', content: 'Use the existing API shape.', included: true }],
  })

  assert.deepEqual(result.sourceLabels, ['Note'])
  assert.doesNotMatch(result.prompt, /<task>/)
  assert.equal(result.sources.some((source) => source.kind === 'task'), false)
})

test('browser AI context rejects an empty task with no usable source', () => {
  assert.throws(
    () => composeBrowserAiContext({ site: 'chatgpt-web', task: '  ', sources: [] }),
    (error) => error instanceof BrowserAiContextError && error.code === 'CONTEXT_INVALID',
  )
})

test('browser AI task repository keeps detail files and a time-sorted summary index', async () => {
  const fs = await import('node:fs/promises')
  const os = await import('node:os')
  const path = await import('node:path')
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ide-browser-ai-'))
  const config = { enabled: true, mode: 'managed-edge', cdpHost: '127.0.0.1', site: 'generic-web', siteUrl: 'https://example.com', sites: [{ id: 'example', name: 'Example', url: 'https://example.com', site: 'generic-web' }], activeSiteId: 'example', keepBrowserRunning: false, headless: false, responseTimeoutMs: 10_000 }
  const repository = createBrowserAiRepository({
    loadConfig: () => config,
    saveConfig: async (nextConfig) => nextConfig,
    getRecordsRootPath: () => root,
  })
  const createRecord = (id, updatedAt) => ({
    id,
    title: id,
    createdAt: updatedAt - 100,
    updatedAt,
    startedAt: updatedAt - 100,
    completedAt: updatedAt,
    site: { site: 'generic-web', name: 'Example', url: 'https://example.com' },
    sources: [{ kind: 'learning-note', label: 'Note', included: true, sensitive: false, characterCount: 4 }],
    status: 'completed',
    answer: `Answer ${id}`,
    steps: [],
    input: { task: `Task ${id}`, sources: [], promptSaved: false },
  })

  await repository.saveTaskRecord(createRecord('older', 10))
  await repository.saveTaskRecord(createRecord('newer', 20))
  assert.deepEqual((await repository.listTaskRecords()).map((record) => record.id), ['newer', 'older'])
  assert.equal((await repository.getTaskRecord('newer')).answer, 'Answer newer')
  const renamed = await repository.renameTaskRecord('newer', 'Renamed task')
  assert.equal(renamed.title, 'Renamed task')
  assert.equal(await repository.deleteTaskRecord('older'), true)
  assert.deepEqual((await repository.listTaskRecords()).map((record) => record.id), ['newer'])
  await fs.rm(root, { recursive: true, force: true })
})
