export type SaveState = 'idle' | 'saved' | 'error'

export type FrontmatterDialogMode = 'create' | 'edit'

export type LearningEditorDisplayMode = 'edit' | 'split' | 'preview'

export type LearningEditorContextMenuState = {
  x: number
  y: number
  selectionStart: number
  selectionEnd: number
}
