import { useMemo, type ChangeEvent, type KeyboardEvent, type MouseEvent, type RefObject, type SyntheticEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { FileText, PanelLeft, PanelRight, Save, Settings2 } from 'lucide-react'
import type { LearningNote } from '../../../../shared/types'
import { Button, type ButtonProps } from '../../../components/ui/button'
import { Card } from '../../../components/ui/card'
import { Input } from '../../../components/ui/input'
import { ScrollArea } from '../../../components/ui/scroll-area'
import { useEffectiveTheme } from '../../../hooks/useEffectiveTheme'
import { useI18n } from '../../../i18n'
import { createMarkdownComponents, shouldDisableMarkdownSyntaxHighlight } from '../../code/code.markdown'
import { remarkBoxDrawingTables } from '../../code/code.markdownBoxTables'
import type { LearningEditorDisplayMode, SaveState } from './learningCenterTypes'
import { useLearningMarkdownScrollSync } from './useLearningMarkdownScrollSync'

type LearningEditorPanelProps = {
  bothSidebarsCollapsed: boolean
  editorContent: string
  editorDisplayMode: LearningEditorDisplayMode
  editorTextareaRef: RefObject<HTMLTextAreaElement>
  editorTitle: string
  hasUnsavedChanges: boolean
  loading: boolean
  leftSidebarCollapsed: boolean
  rightSidebarCollapsed: boolean
  selectedCategoryName: string
  saveButtonDisabled: boolean
  saveButtonLabel: string
  saveButtonVariant: ButtonProps['variant']
  saveError: string | null
  saveState: SaveState
  saving: boolean
  selectedNote: LearningNote | null
  onEditorChange: (event: ChangeEvent<HTMLTextAreaElement>) => void
  onEditorContextMenu: (event: MouseEvent<HTMLTextAreaElement>) => void
  onEditorDisplayModeChange: (mode: LearningEditorDisplayMode) => void
  onEditorKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onEditorSelectionSync: (event: SyntheticEvent<HTMLTextAreaElement>) => void
  onEditorTitleChange: (value: string) => void
  onCreateNote: () => void
  onOpenNotesSidebar: () => void
  onToggleLeftSidebar: () => void
  onToggleRightSidebar: () => void
  onOpenBrowserAiPreferences: () => void
  onSave: () => void | Promise<void>
}

export function LearningEditorPanel({
  bothSidebarsCollapsed,
  editorContent,
  editorDisplayMode,
  editorTextareaRef,
  editorTitle,
  hasUnsavedChanges,
  loading,
  leftSidebarCollapsed,
  rightSidebarCollapsed,
  selectedCategoryName,
  saveButtonDisabled,
  saveButtonLabel,
  saveButtonVariant,
  saveError,
  saveState,
  saving,
  selectedNote,
  onEditorChange,
  onEditorContextMenu,
  onEditorDisplayModeChange,
  onEditorKeyDown,
  onEditorSelectionSync,
  onEditorTitleChange,
  onCreateNote,
  onOpenNotesSidebar,
  onToggleLeftSidebar,
  onToggleRightSidebar,
  onOpenBrowserAiPreferences,
  onSave,
}: LearningEditorPanelProps) {
  const { t } = useI18n()
  const effectiveTheme = useEffectiveTheme()
  const enableMarkdownSyntaxHighlight = useMemo(() => !shouldDisableMarkdownSyntaxHighlight(editorContent), [editorContent])
  const { handleEditorScroll, previewViewportRef } = useLearningMarkdownScrollSync({
    editorDisplayMode,
    editorTextareaRef,
    noteId: selectedNote?.id,
  })

  const markdownComponents = useMemo(
    () =>
      createMarkdownComponents({
        activeRelativePath: null,
        enableMarkdownSyntaxHighlight,
        projectPath: '',
        themeMode: effectiveTheme,
      }),
    [effectiveTheme, enableMarkdownSyntaxHighlight],
  )

  const editorPreviewGridColumns = editorDisplayMode === 'preview' || editorDisplayMode === 'edit' ? 'minmax(0,1fr)' : 'minmax(0,1fr) minmax(0,1fr)'

  return (
    <Card className={`learning-editor-stage min-h-0 overflow-hidden rounded-[18px] border-[color:var(--color-border)]/80 bg-[color:var(--color-card)]/94 shadow-none ${bothSidebarsCollapsed ? 'mx-auto w-full max-w-[1360px]' : ''}`}>
      {loading ? (
        <div className="flex h-full min-h-[320px] items-center justify-center text-sm text-[color:var(--color-muted-foreground)]">{t('common.loading')}</div>
      ) : selectedNote ? (
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex flex-wrap items-center gap-3 border-b border-[color:var(--color-border)] px-3 py-3 sm:px-4">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div className="hidden min-w-0 max-w-[360px] items-center gap-2 text-xs text-[color:var(--color-muted-foreground)] sm:flex">
                <span className="shrink-0 font-medium text-[color:var(--color-foreground)]">{t('learning.notes.notesTitle')}</span>
                <span aria-hidden="true">/</span>
                <span className="truncate">{selectedCategoryName}</span>
                <span aria-hidden="true">/</span>
              </div>
              <Input
                aria-label={t('learning.editor.titleLabel')}
                value={editorTitle}
                onChange={(event) => onEditorTitleChange(event.target.value)}
                placeholder={t('learning.editor.untitledNote')}
                className="h-9 min-w-0 max-w-xl flex-1 rounded-[10px] bg-transparent px-2 text-base font-semibold shadow-none focus-visible:bg-[color:var(--color-accent)]"
              />
              <div className="flex shrink-0 items-center gap-2 text-xs text-[color:var(--color-muted-foreground)]">
                <span className={`h-1.5 w-1.5 rounded-full ${saveState === 'error' ? 'bg-[color:var(--color-destructive)]' : hasUnsavedChanges ? 'bg-[color:var(--color-primary)]' : 'bg-[color:var(--color-success)]'}`} />
                <span className={saveState === 'error' ? 'text-[color:var(--color-destructive)]' : ''}>{saveState === 'error' ? saveError || t('learning.info.saveFailed') : hasUnsavedChanges ? t('learning.info.unsavedChanges') : t('learning.info.saved')}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={onToggleLeftSidebar}
                aria-label={t(leftSidebarCollapsed ? 'learning.sidebarRail.expandLeft' : 'learning.sidebarRail.collapseLeft')}
                title={t(leftSidebarCollapsed ? 'learning.sidebarRail.expandLeft' : 'learning.sidebarRail.collapseLeft')}
              >
                <PanelLeft className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={onToggleRightSidebar}
                aria-label={t(rightSidebarCollapsed ? 'learning.sidebarRail.expandRight' : 'learning.sidebarRail.collapseRight')}
                title={t(rightSidebarCollapsed ? 'learning.sidebarRail.expandRight' : 'learning.sidebarRail.collapseRight')}
              >
                <PanelRight className="h-4 w-4" />
              </Button>
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={onOpenBrowserAiPreferences} aria-label={t('learning.toolbar.browserAiPreferences')} title={t('learning.toolbar.browserAiPreferences')}>
                <Settings2 className="h-4 w-4" />
              </Button>
              <div className="quiet-control inline-flex items-center gap-1 rounded-full border border-[color:var(--color-border)]/80 bg-[color:var(--color-accent)]/55 p-1">
                <Button type="button" variant="ghost" size="sm" className={editorDisplayMode === 'edit' ? 'bg-[color:var(--color-card)] text-[color:var(--color-foreground)] shadow-sm' : 'text-[color:var(--color-muted-foreground)]'} onClick={() => onEditorDisplayModeChange('edit')}>
                  {t('learning.editor.editMode')}
                </Button>
                <Button type="button" variant="ghost" size="sm" className={editorDisplayMode === 'split' ? 'bg-[color:var(--color-card)] text-[color:var(--color-foreground)] shadow-sm' : 'text-[color:var(--color-muted-foreground)]'} onClick={() => onEditorDisplayModeChange('split')}>
                  {t('learning.editor.split')}
                </Button>
                <Button type="button" variant="ghost" size="sm" className={editorDisplayMode === 'preview' ? 'bg-[color:var(--color-card)] text-[color:var(--color-foreground)] shadow-sm' : 'text-[color:var(--color-muted-foreground)]'} onClick={() => onEditorDisplayModeChange('preview')}>
                  {t('learning.editor.previewOnly')}
                </Button>
              </div>
              <Button size="sm" variant={saveButtonVariant} className={`min-w-[104px] justify-center gap-1.5 ${hasUnsavedChanges && !saving ? 'shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-primary)_14%,transparent)]' : ''}`} onClick={() => void onSave()} loading={saving} disabled={saveButtonDisabled}>
                <Save className="h-4 w-4" />
                {saveButtonLabel}
              </Button>
            </div>
          </div>

          <div className="grid h-full min-h-0 gap-3 p-3 sm:gap-4 sm:p-4" style={{ gridTemplateColumns: editorPreviewGridColumns }}>
            {editorDisplayMode !== 'preview' ? (
              <div className="flex min-h-0 flex-col overflow-hidden rounded-[14px] border border-[color:var(--color-border)]/80 bg-[color:var(--color-background)]/45">
                <div className="min-h-0 flex-1">
                  <textarea
                    ref={editorTextareaRef}
                    value={editorContent}
                    onChange={onEditorChange}
                    onKeyDown={onEditorKeyDown}
                    onKeyUp={onEditorSelectionSync}
                    onMouseUp={onEditorSelectionSync}
                    onScroll={handleEditorScroll}
                    onContextMenu={onEditorContextMenu}
                    className="h-full min-h-[420px] w-full resize-none border-0 bg-transparent px-5 py-5 font-['JetBrains_Mono','SFMono-Regular',monospace] text-sm leading-6 text-[color:var(--color-foreground)] outline-none sm:px-6 sm:py-6"
                    placeholder={t('learning.editor.placeholder')}
                    wrap="off"
                  />
                </div>
              </div>
            ) : null}

            {editorDisplayMode !== 'edit' ? (
              <div className="flex min-h-0 flex-col">
                <ScrollArea
                  className="min-h-0 flex-1 overflow-hidden rounded-[14px] border border-[color:var(--color-border)]/80 bg-[color:var(--color-background)]/35"
                  viewportClassName="h-full w-full code-markdown-preview-scroll-root"
                  viewportRef={previewViewportRef}
                  horizontalScrollbar
                  horizontalScrollbarClassName="absolute left-[var(--scrollbar-edge-gap)] right-[var(--scrollbar-edge-gap)] bottom-[var(--scrollbar-edge-gap)] z-10 h-[var(--scrollbar-size)] rounded-full border-t-0 bg-[var(--scrollbar-track)]/92 backdrop-blur-md"
                >
                  <div className={editorDisplayMode === 'preview' ? 'learning-preview-reading-frame' : undefined}>
                    <article className={`code-markdown-content code-markdown-content--viewport-scroll learning-markdown-preview-content ${editorDisplayMode === 'preview' ? 'learning-preview-reading-content px-5 py-5 sm:px-6' : 'px-3 py-4 sm:px-4'}`} style={{ margin: 0, minWidth: 0, width: '100%' }}>
                      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBoxDrawingTables]} components={markdownComponents}>
                        {editorContent}
                      </ReactMarkdown>
                    </article>
                  </div>
                </ScrollArea>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-4 px-6 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[color:var(--color-accent)] text-[color:var(--color-primary)]">
            <FileText className="h-5 w-5" />
          </div>
          <div className="text-sm text-[color:var(--color-muted-foreground)]">{t('learning.editor.emptyState')}</div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button type="button" onClick={onCreateNote}>
              <Save />
              {t('learning.header.createNote')}
            </Button>
            <Button type="button" variant="outline" onClick={onOpenNotesSidebar}>
              <PanelLeft />
              {t('learning.editor.chooseNote')}
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}
