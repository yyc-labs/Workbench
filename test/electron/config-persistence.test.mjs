import assert from 'node:assert/strict'
import { access, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const migrations = loadTsModule('src/core/electron/main/config/config-migrations.ts')
const persistence = loadTsModule('src/core/electron/main/config/config-persistence.ts')

test('config migration adds the current schema version and preserves unknown fields', () => {
  const result = migrations.migrateConfigDocument({ projects: [], futureFlag: true })
  assert.equal(result.version, 1)
  assert.equal(result.migrated, true)
  assert.deepEqual(result.document, { projects: [], futureFlag: true, configVersion: 1 })
})

test('config migration is idempotent for the current schema version', () => {
  const result = migrations.migrateConfigDocument({ configVersion: 1, projects: [] })
  assert.equal(result.migrated, false)
  assert.deepEqual(result.document, { configVersion: 1, projects: [] })
})

test('corrupt config backup keeps the original malformed bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ide-config-'))
  const filePath = join(root, 'project-launcher-config.json')
  const malformed = '{"projects": ['
  try {
    await writeFile(filePath, malformed, 'utf8')
    const backupPath = persistence.backupCorruptConfigSync(filePath, malformed, 123)
    assert.equal(await readFile(backupPath, 'utf8'), malformed)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('atomic write snapshots the pre-write content once per day', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ide-config-'))
  const filePath = join(root, 'project-launcher-config.json')
  try {
    await writeFile(filePath, '{"projects":["old"]}', 'utf8')
    await persistence.atomicWriteJson(filePath, '{"projects":["new"]}')
    const snapshotPath = persistence.dailySnapshotPath(filePath)
    assert.equal(await readFile(snapshotPath, 'utf8'), '{"projects":["old"]}')
    // 同日再次写入：当日快照保持当日首次写入前的状态，不被后续写入覆盖
    await persistence.atomicWriteJson(filePath, '{"projects":["newer"]}')
    assert.equal(await readFile(snapshotPath, 'utf8'), '{"projects":["old"]}')
    assert.equal(await readFile(filePath, 'utf8'), '{"projects":["newer"]}')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('daily snapshot prune keeps the newest N snapshots', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ide-config-'))
  const filePath = join(root, 'project-launcher-config.json')
  try {
    for (let i = 1; i <= 9; i += 1) {
      const stamp = String(i).padStart(8, '0')
      await writeFile(`${filePath}.daily-${stamp}`, `{"day":${i}}`, 'utf8')
    }
    await persistence.pruneDailySnapshots(filePath, 7)
    const entries = await readdir(root)
    const daily = entries.filter((name) => name.startsWith('project-launcher-config.json.daily-')).sort()
    assert.equal(daily.length, 7)
    assert.equal(daily[0], 'project-launcher-config.json.daily-00000003')
    assert.equal(daily[6], 'project-launcher-config.json.daily-00000009')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('atomic JSON write replaces the target with complete content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ide-config-'))
  const filePath = join(root, 'project-launcher-config.json')
  try {
    await persistence.atomicWriteJson(filePath, '{"configVersion":1}')
    assert.equal(await readFile(filePath, 'utf8'), '{"configVersion":1}')
    await persistence.atomicWriteJson(filePath, '{"configVersion":1,"projects":[]}')
    assert.equal(await readFile(filePath, 'utf8'), '{"configVersion":1,"projects":[]}')
    await access(`${filePath}.bak`)
    assert.equal(await readFile(`${filePath}.bak`, 'utf8'), '{"configVersion":1}')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
