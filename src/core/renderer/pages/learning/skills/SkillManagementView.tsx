import { useEffect, useMemo, useRef, useState } from 'react'
import type { SkillEditorState } from './skillTypes'
import type { Skill } from '../../../../shared/types'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { useI18n } from '../../../i18n'
import { useAppStore } from '../../../stores/appStore'
import { SkillEditorPanel } from './SkillEditorPanel'
import { SkillListSidebar } from './SkillListSidebar'
import { skillEditorState } from './skillTypes'

type SkillManagementViewProps = { createRequest: number; onCreateRequestHandled: () => void }
type SkillDeleteConfirmation = { type: 'skill' | 'category'; id: string; name: string }

function normalizeTags(value: string): string[] {
  return [
    ...new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ]
}

export function SkillManagementView({ createRequest, onCreateRequestHandled }: SkillManagementViewProps) {
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
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false)
  const [categoryEditInput, setCategoryEditInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<SkillDeleteConfirmation | null>(null)
  const handledCreateRequestRef = useRef(0)

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
    if (createRequest <= 0) {
      handledCreateRequestRef.current = 0
      return
    }
    if (handledCreateRequestRef.current === createRequest) return
    handledCreateRequestRef.current = createRequest
    onCreateRequestHandled()
    void handleCreateSkill()
    // The request is an incrementing UI event from the page header.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createRequest, onCreateRequestHandled])

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
      const title = skills.some((skill) => skill.title.toLowerCase() === baseTitle.toLowerCase()) ? `${baseTitle} ${skills.length + 1}` : baseTitle
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

  const handleDelete = () => {
    if (!selectedSkill || deleting) return
    setError(null)
    setDeleteConfirm({ type: 'skill', id: selectedSkill.id, name: selectedSkill.title })
  }

  const confirmDelete = async () => {
    const pendingDelete = deleteConfirm
    if (!pendingDelete) return
    setDeleting(true)
    setError(null)
    try {
      if (pendingDelete.type === 'skill') {
        const deleted = await deleteSkill(pendingDelete.id)
        if (deleted) setSelectedSkillId(skills.find((skill) => skill.id !== pendingDelete.id)?.id ?? null)
      } else {
        await deleteSkillCategory(pendingDelete.id)
        setSelectedCategoryId('all')
      }
      setDeleteConfirm(null)
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : t('learning.skills.deleteFailed'))
    } finally {
      setDeleting(false)
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
    try {
      await updateSkillCategory({ categoryId: selectedCategory.id, name: categoryEditInput.trim() })
    } catch (categoryError) {
      setError(categoryError instanceof Error ? categoryError.message : t('learning.skills.saveFailed'))
    }
  }

  const handleDeleteCategory = () => {
    if (!selectedCategory || deleting) return
    setError(null)
    setDeleteConfirm({ type: 'category', id: selectedCategory.id, name: selectedCategory.name })
  }

  return (
    <div className="learning-skills-grid grid min-h-0 flex-1 gap-3 lg:grid-cols-[264px_minmax(0,1fr)]">
      <SkillListSidebar
        categories={categories}
        filteredSkills={filteredSkills}
        selectedCategoryId={selectedCategoryId}
        selectedSkillId={selectedSkillId}
        searchQuery={searchQuery}
        categoryInput={categoryInput}
        categoryManagerOpen={categoryManagerOpen}
        selectedCategory={selectedCategory}
        categoryEditInput={categoryEditInput}
        onSearchQueryChange={setSearchQuery}
        onCategoryChange={setSelectedCategoryId}
        onSelectSkill={setSelectedSkillId}
        onCategoryInputChange={setCategoryInput}
        onCreateCategory={() => void handleCreateCategory()}
        onCategoryEditInputChange={setCategoryEditInput}
        onRenameCategory={() => void handleRenameCategory()}
        onDeleteCategory={handleDeleteCategory}
        onToggleCategoryManager={() => setCategoryManagerOpen((current) => !current)}
      />
      <SkillEditorPanel skill={selectedSkill} categories={categories} editor={editor} saving={saving} error={error} onChange={(patch) => setEditor((current) => ({ ...current, ...patch }))} onSave={() => void handleSave()} onDelete={handleDelete} onCreate={handleCreateSkill} />
      <ConfirmDialog
        open={Boolean(deleteConfirm)}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={confirmDelete}
        ariaLabel={deleteConfirm?.type === 'category' ? t('learning.skills.deleteCategory') : t('learning.skills.delete')}
        title={deleteConfirm?.type === 'category' ? t('learning.skills.deleteCategory') : t('learning.skills.delete')}
        description={deleteConfirm?.type === 'category' ? t('learning.skills.deleteCategoryConfirm', { value: deleteConfirm?.name ?? '' }) : t('learning.skills.deleteConfirm', { value: deleteConfirm?.name ?? '' })}
        confirmLabel={t('common.delete')}
        confirmVariant="destructive"
        busy={deleting}
      >
        {error ? <p className="text-sm text-[color:var(--color-destructive)]">{error}</p> : null}
      </ConfirmDialog>
    </div>
  )
}
