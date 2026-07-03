import { useMemo, type ChangeEvent, type KeyboardEvent, type MouseEvent, type RefObject, type SyntheticEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Save } from 'lucide-react'
import type { LearningNote } from '../../../shared/types'
import { Button, type ButtonProps } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { ScrollArea } from '../../components/ui/scroll-area'
import { useEffectiveTheme } from '../../hooks/useEffectiveTheme'
import { useI18n } from '../../i18n'
import {
  createMarkdownComponents,
  shouldDisableMarkdownSyntaxHighlight,
} from '../code/code.markdown'
import { remarkBoxDrawingTables } from '../code/code.markdownBoxTables'
import type { LearningEditorDisplayMode } from './learningCenterTypes'

type LearningEditorPanelProps = {
  bothSidebarsCollapsed: boolean
  editorContent: string
  editorDisplayMode: LearningEditorDisplayMode
  editorTextareaRef: RefObject<HTMLTextAreaElement>
  editorTitle: string
  hasUnsavedChanges: boolean
  saveButtonDisabled: boolean
  saveButtonLabel: string
  saveButtonVariant: ButtonProps['variant']
  saving: boolean
  selectedNote: LearningNote | null
  onEditorChange: (event: ChangeEvent<HTMLTextAreaElement>) => void
  onEditorContextMenu: (event: MouseEvent<HTMLTextAreaElement>) => void
  onEditorDisplayModeChange: (mode: LearningEditorDisplayMode) => void
  onEditorKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onEditorSelectionSync: (event: SyntheticEvent<HTMLTextAreaElement>) => void
  onSave: () => void | Promise<void>
}

export function LearningEditorPanel({
  bothSidebarsCollapsed,
  editorContent,
  editorDisplayMode,
  editorTextareaRef,
  editorTitle,
  hasUnsavedChanges,
  saveButtonDisabled,
  saveButtonLabel,
  saveButtonVariant,
  saving,
  selectedNote,
  onEditorChange,
  onEditorContextMenu,
  onEditorDisplayModeChange,
  onEditorKeyDown,
  onEditorSelectionSync,
  onSave,
}: LearningEditorPanelProps) {
  const { t } = useI18n()
  const effectiveTheme = useEffectiveTheme()
  const enableMarkdownSyntaxHighlight = useMemo(
    () => !shouldDisableMarkdownSyntaxHighlight(editorContent),
    [editorContent]
  )

  const markdownComponents = useMemo(() => createMarkdownComponents({
    activeRelativePath: null,
    enableMarkdownSyntaxHighlight,
    projectPath: '',
    themeMode: effectiveTheme,
  }), [effectiveTheme, enableMarkdownSyntaxHighlight])

  const editorPreviewGridColumns = editorDisplayMode === 'preview'
    ? 'minmax(0,1fr)'
    : 'minmax(0,1fr) minmax(0,1fr)'

  return (
    <Card className={`min-h-0 overflow-hidden border-[color:var(--color-border)]/80 bg-[color:var(--color-card)]/94 ${
      bothSidebarsCollapsed ? 'mx-auto w-full max-w-[1360px]' : ''
    }`}>
      {selectedNote ? (
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--color-border)] px-5 py-4">
            <div className="min-w-0">
              <div className="line-clamp-1 text-sm font-semibold text-[color:var(--color-foreground)]">
                {editorTitle || t('learning.editor.untitledNote')}
              </div>
              <div className="text-xs text-[color:var(--color-muted-foreground)]">
                {editorDisplayMode === 'preview'
                  ? t('learning.editor.previewModeDescription')
                  : t('learning.editor.splitModeDescription')}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="quiet-control inline-flex items-center gap-1 rounded-full border border-[color:var(--color-border)]/80 bg-[color:var(--color-accent)]/55 p-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={editorDisplayMode === 'split'
                    ? 'bg-[color:var(--color-card)] text-[color:var(--color-foreground)] shadow-sm'
                    : 'text-[color:var(--color-muted-foreground)]'}
                  onClick={() => onEditorDisplayModeChange('split')}
                >
                  {t('learning.editor.split')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={editorDisplayMode === 'preview'
                    ? 'bg-[color:var(--color-card)] text-[color:var(--color-foreground)] shadow-sm'
                    : 'text-[color:var(--color-muted-foreground)]'}
                  onClick={() => onEditorDisplayModeChange('preview')}
                >
                  {t('learning.editor.previewOnly')}
                </Button>
              </div>
              <Button
                size="sm"
                variant={saveButtonVariant}
                className={`min-w-[104px] justify-center gap-1.5 ${
                  hasUnsavedChanges && !saving
                    ? 'shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-primary)_14%,transparent)]'
                    : ''
                }`}
                onClick={() => void onSave()}
                loading={saving}
                disabled={saveButtonDisabled}
              >
                <Save className="h-4 w-4" />
                {saveButtonLabel}
              </Button>
            </div>
          </div>

          <div
            className="grid h-full min-h-0"
            style={{ gridTemplateColumns: editorPreviewGridColumns }}
          >
            {editorDisplayMode === 'split' ? (
              <div className="flex min-h-0 flex-col border-r border-[color:var(--color-border)]">
                <div className="border-b border-[color:var(--color-border)] px-5 py-4">
                  <div className="text-sm font-semibold text-[color:var(--color-foreground)]">{t('learning.editor.editTitle')}</div>
                  <div className="text-xs text-[color:var(--color-muted-foreground)]">
                    {t('learning.editor.editDescription')}
                  </div>
                </div>
                <div className="min-h-0 flex-1 px-5 py-4">
                  <textarea
                    ref={editorTextareaRef}
                    value={editorContent}
                    onChange={onEditorChange}
                    onKeyDown={onEditorKeyDown}
                    onKeyUp={onEditorSelectionSync}
                    onMouseUp={onEditorSelectionSync}
                    onContextMenu={onEditorContextMenu}
                    className="h-full min-h-[420px] w-full resize-none rounded-[22px] border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-4 py-4 font-['JetBrains_Mono','SFMono-Regular',monospace] text-sm leading-6 text-[color:var(--color-foreground)] outline-none"
                    placeholder={t('learning.editor.placeholder')}
                  />
                </div>
              </div>
            ) : null}

            <div className="flex min-h-0 flex-col">
              <div className="border-b border-[color:var(--color-border)] px-5 py-4">
                <div className="text-sm font-semibold text-[color:var(--color-foreground)]">{t('learning.editor.previewTitle')}</div>
                <div className="text-xs text-[color:var(--color-muted-foreground)]">
                  {editorDisplayMode === 'preview'
                    ? t('learning.editor.previewOnlyDescription')
                    : t('learning.editor.previewDescription')}
                </div>
              </div>
              <ScrollArea
                className="min-h-0 flex-1"
                viewportClassName="h-full w-full code-markdown-preview-scroll-root"
                horizontalScrollbar
                horizontalScrollbarClassName="absolute left-[var(--scrollbar-edge-gap)] right-[var(--scrollbar-edge-gap)] bottom-[var(--scrollbar-edge-gap)] z-10 h-[var(--scrollbar-size)] rounded-full border-t-0 bg-[var(--scrollbar-track)]/92 backdrop-blur-md"
              >
                <article
                  className={`code-markdown-content code-markdown-content--viewport-scroll ${
                    editorDisplayMode === 'preview' ? 'px-5 py-5 sm:px-6' : 'px-3 py-4 sm:px-4'
                  }`}
                  style={{ margin: 0, maxWidth: 'none', minWidth: 0, width: '100%' }}
                >
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkBoxDrawingTables]}
                    components={markdownComponents}
                  >
                    {editorContent}
                  </ReactMarkdown>
                </article>
              </ScrollArea>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-[color:var(--color-muted-foreground)]">
          {t('learning.editor.emptyState')}
        </div>
      )}
    </Card>
  )
}
