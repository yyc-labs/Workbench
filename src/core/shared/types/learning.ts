/** Learning Center domain contract. */
export type LearningNoteStatus = 'draft' | 'organized'

export interface LearningCategory {
  id: string
  name: string
  parentId?: string
  sort: number
  createdAt: number
  updatedAt: number
}

export interface LearningNoteSummary {
  id: string
  title: string
  categoryId?: string
  tags: string[]
  status: LearningNoteStatus
  createdAt: number
  updatedAt: number
  excerpt: string
}

export interface LearningNote extends LearningNoteSummary {
  contentMd: string
}

export type LearningSearchMatchKind = 'title' | 'tag' | 'content'

export interface LearningSearchResult extends LearningNoteSummary {
  matchKind: LearningSearchMatchKind
  matchExcerpt: string
  matchOffset?: number
}

export interface LearningCreateNotePayload {
  title?: string
  categoryId?: string
  tags?: string[]
  status?: LearningNoteStatus
  contentMd?: string
}

export interface LearningUpdateNotePayload {
  noteId: string
  title: string
  categoryId?: string
  tags: string[]
  status: LearningNoteStatus
  contentMd: string
}

export interface LearningCreateCategoryPayload {
  name: string
  parentId?: string
}

export interface LearningUpdateCategoryPayload {
  categoryId: string
  name: string
}
