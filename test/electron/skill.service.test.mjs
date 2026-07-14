import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTsModule } from '../helpers/load-ts-module.mjs'

const { createSkillService } = loadTsModule('src/core/electron/main/skill/skillService.ts')

function createRepository() {
  const categories = [{ id: 'sc-writing', name: 'Writing', sort: 0, createdAt: 1, updatedAt: 1 }]
  const skills = []
  let clearedCategoryId = null
  return {
    repository: {
      listCategories: async () => categories,
      saveCategories: async (next) => {
        categories.splice(0, categories.length, ...next)
      },
      listSkills: async () => skills.map((skill) => ({ ...skill })),
      getSkill: async (id) => skills.find((skill) => skill.id === id) ?? null,
      saveSkill: async (skill) => {
        const index = skills.findIndex((item) => item.id === skill.id)
        if (index >= 0) skills[index] = skill
        else skills.push(skill)
      },
      deleteSkill: async (id) => {
        const index = skills.findIndex((skill) => skill.id === id)
        if (index < 0) return false
        skills.splice(index, 1)
        return true
      },
      clearCategoryReferences: async (id) => { clearedCategoryId = id },
    },
    skills,
    getClearedCategoryId: () => clearedCategoryId,
  }
}

test('skill service normalizes new Skills and rejects duplicate titles', async () => {
  const fixture = createRepository()
  const service = createSkillService({ repository: fixture.repository })
  const created = await service.createSkill({
    title: '  Review  ',
    categoryId: 'sc-writing',
    tags: ['code', ' code ', 'review'],
    enabled: false,
    contentMd: '## Check\n\nUse risk levels.',
  })

  assert.match(created.id, /^sk-/)
  assert.equal(created.title, 'Review')
  assert.deepEqual(created.tags, ['code', 'review'])
  assert.equal(created.enabled, false)
  assert.equal(created.excerpt, 'Check Use risk levels.')
  await assert.rejects(() => service.createSkill({ title: 'review', contentMd: 'Other instructions.' }), /already exists/)
})

test('skill service validates updates and clears category references on category deletion', async () => {
  const fixture = createRepository()
  const service = createSkillService({ repository: fixture.repository })
  const created = await service.createSkill({ title: 'Plan', categoryId: 'sc-writing', contentMd: 'Plan the work.' })

  await assert.rejects(() => service.updateSkill({ skillId: created.id, title: 'Plan', categoryId: 'sc-writing', tags: [], enabled: true, contentMd: ' ' }), /cannot be empty/)
  const categories = await service.deleteCategory('sc-writing')
  assert.deepEqual(categories, [])
  assert.equal(fixture.getClearedCategoryId(), 'sc-writing')
})
