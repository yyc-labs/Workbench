import { useEffect, useMemo, useState } from 'react'
import type { SkillEditorState } from './skillTypes'
import type { Skill } from '../../../shared/types'
import { useI18n } from '../../i18n'
import { useAppStore } from '../../stores/appStore'
import { SkillEditorPanel } from './SkillEditorPanel'
import { SkillListSidebar } from './SkillListSidebar'
import { skillEditorState } from './skillTypes'

type SkillManagementViewProps = { createRequest: number }

function normalizeTags(value: string): string[] {
  return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))]
}

export function SkillManagementView({ createRequest }: SkillManagementViewProps) {
  const { t } = useI18n()
  const skills = useAppStore((state) => state.skills)
  const categories = useAppStore((state) => state.skillCategories)
  const selectedSkill = useAppStore((state) => state.selectedSkill)
  const loadSkills = useAppStore((state) => state.loadSkills)
  const loadSkillCategories = useAppStore((state) => state.loadSkillCategories)
  const loadSkill = useAppStore((state) => state.loadSkill)
  const createSkill = useAppStore((state) => state.createSkill)
  const updateSkill = useAppStore((state) => state.updateSkill)
  const deleteSkill = useAppStore((state) => state.deleteSkill)
  const createSkillCategory = useAppStore((state) => state.createSkillCategory)
  const updateSkillCategory = useAppStore((state) => state.updateSkillCategory)
  const deleteSkillCategory = useAppStore((state) => state.deleteSkillCategory)
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null)
  const [editor, setEditor] = useState<SkillEditorState>(skillEditorState(null))
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategoryId, setSelectedCategoryId] = useState('all')
  const [categoryInput, setCategoryInput] = useState('')
  const [categoryEditInput, setCategoryEditInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void Promise.all([loadSkills(), loadSkillCategories()])
  }, [loadSkillCategories, loadSkills])

  useEffect(() => {
    if (!selectedSkillId && skills[0]) setSelectedSkillId(skills[0].id)
    if (selectedSkillId && !skills.some((skill) => skill.id === selectedSkillId)) setSelectedSkillId(skills[0]?.id ?? null)
  }, [selectedSkillId, skills])

  useEffect(() => {
    if (selectedSkillId) void loadSkill(selectedSkillId)
    else setEditor(skillEditorState(null))
  }, [loadSkill, selectedSkillId])

  useEffect(() => {
    setEditor(skillEditorState(selectedSkill))
    setCategoryEditInput(categories.find((category) => category.id === selectedSkill?.categoryId)?.name ?? '')
  }, [categories, selectedSkill])

  useEffect(() => {
    if (createRequest <= 0) return
    void handleCreateSkill()
    // The request is an incrementing UI event from the page header.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createRequest])

  const filteredSkills = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return skills.filter((skill) => {
      if (selectedCategoryId !== 'all' && skill.categoryId !== selectedCategoryId) return false
      if (!query) return true
      return [skill.title, skill.excerpt, ...skill.tags].some((value) => value.toLowerCase().includes(query))
    })
  }, [searchQuery, selectedCategoryId, skills])

  const selectedCategory = categories.find((category) => category.id === selectedCategoryId && selectedCategoryId !== 'all') ?? null

  const handleCreateSkill = async () => {
    setError(null)
    try {
      const baseTitle = t('learning.skills.create')
      const title = skills.some((skill) => skill.title.toLowerCase() === baseTitle.toLowerCase())
        ? `${baseTitle} ${skills.length + 1}`
        : baseTitle
      const created = await createSkill({ title, contentMd: `# ${title}\n\n` })
      setSelectedSkillId(created.id)
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : t('learning.skills.saveFailed'))
    }
  }

  const handleSave = async () => {
    if (!selectedSkillId) return
    setSaving(true)
    setError(null)
    try {
      const updated = await updateSkill({ skillId: selectedSkillId, title: editor.title, contentMd: editor.contentMd, categoryId: editor.categoryId || undefined, tags: normalizeTags(editor.tags), enabled: editor.enabled })
      setSelectedSkillId(updated.id)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('learning.skills.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selectedSkill) return
    if (!window.confirm(t('learning.skills.deleteConfirm', { value: selectedSkill.title }))) return
    setError(null)
    try {
      const deleted = await deleteSkill(selectedSkill.id)
      if (deleted) setSelectedSkillId(skills.find((skill) => skill.id !== selectedSkill.id)?.id ?? null)
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : t('learning.skills.deleteFailed'))
    }
  }

  const handleCreateCategory = async () => {
    const name = categoryInput.trim()
    if (!name) return
    try {
      const next = await createSkillCategory({ name })
      setCategoryInput('')
      const created = next.find((category) => category.name.toLowerCase() === name.toLowerCase())
      if (created) setSelectedCategoryId(created.id)
    } catch (categoryError) {
      setError(categoryError instanceof Error ? categoryError.message : t('learning.skills.saveFailed'))
    }
  }

  const handleRenameCategory = async () => {
    if (!selectedCategory || !categoryEditInput.trim()) return
    try { await updateSkillCategory({ categoryId: selectedCategory.id, name: categoryEditInput.trim() }) } catch (categoryError) { setError(categoryError instanceof Error ? categoryError.message : t('learning.skills.saveFailed')) }
  }

  const handleDeleteCategory = async () => {
    if (!selectedCategory || !window.confirm(t('learning.skills.deleteConfirm', { value: selectedCategory.name }))) return
    try { await deleteSkillCategory(selectedCategory.id); setSelectedCategoryId('all') } catch (categoryError) { setError(categoryError instanceof Error ? categoryError.message : t('learning.skills.deleteFailed')) }
  }

  return <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
    <SkillListSidebar categories={categories} filteredSkills={filteredSkills} selectedCategoryId={selectedCategoryId} selectedSkillId={selectedSkillId} searchQuery={searchQuery} categoryInput={categoryInput} selectedCategory={selectedCategory} categoryEditInput={categoryEditInput} onSearchQueryChange={setSearchQuery} onCategoryChange={setSelectedCategoryId} onSelectSkill={setSelectedSkillId} onCategoryInputChange={setCategoryInput} onCreateCategory={() => void handleCreateCategory()} onCategoryEditInputChange={setCategoryEditInput} onRenameCategory={() => void handleRenameCategory()} onDeleteCategory={() => void handleDeleteCategory()} />
    <SkillEditorPanel skill={selectedSkill} categories={categories} editor={editor} saving={saving} error={error} onChange={(patch) => setEditor((current) => ({ ...current, ...patch }))} onSave={() => void handleSave()} onDelete={() => void handleDelete()} />
  </div>
}
