export type SaveState = 'idle' | 'saved' | 'error'

export type GesturePoint = {
  x: number
  y: number
}

export type FrontmatterDialogMode = 'create' | 'edit'

export type LearningEditorDisplayMode = 'split' | 'preview'

export type LearningEditorContextMenuState = {
  x: number
  y: number
  selectionStart: number
  selectionEnd: number
}

export type LearningSidebarGestureOverlayState = {
  visible: boolean
  status: 'pending' | 'ready' | 'invalid'
  action: 'left' | 'right' | null
  points: GesturePoint[]
  cursor: GesturePoint | null
}

export const EMPTY_LEARNING_SIDEBAR_GESTURE_OVERLAY: LearningSidebarGestureOverlayState = {
  visible: false,
  status: 'pending',
  action: null,
  points: [],
  cursor: null,
}
