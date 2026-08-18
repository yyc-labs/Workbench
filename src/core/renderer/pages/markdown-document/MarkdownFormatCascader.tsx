import { useMemo, type ReactNode } from 'react'
import { Bold, Code2, FileCode2, Heading1, Heading2, Heading3, Image, Link2, List, ListChecks, ListOrdered, Minus, Quote, Strikethrough, Table2, Type } from 'lucide-react'
import { useI18n } from '../../i18n'
import { ContextCascader, type ContextCascaderSection } from '../../components/ui/ContextCascader'
import type { Editor } from '@milkdown/core'
import type { MarkdownDocumentCommandId, MarkdownDocumentSelectionContext } from './markdownDocumentCommands'
import { canRunMarkdownDocumentCommand, runMarkdownDocumentCommand } from './markdownDocumentCommands'

type MarkdownFormatCascaderProps = {
  editor: Editor | null
  selectionContext: MarkdownDocumentSelectionContext
  x: number
  y: number
  onClose: () => void
}

function createCommandItem(id: MarkdownDocumentCommandId, label: string, description: string, icon: ReactNode, editor: Editor | null, selectionContext: MarkdownDocumentSelectionContext, payload?: unknown) {
  return {
    id,
    label,
    description,
    icon,
    disabled: !editor || !canRunMarkdownDocumentCommand(id, selectionContext),
    onSelect: () => {
      if (!editor) return
      runMarkdownDocumentCommand(editor, { id, payload })
    },
  }
}

export function MarkdownFormatCascader({ editor, selectionContext, x, y, onClose }: MarkdownFormatCascaderProps) {
  const { t } = useI18n()

  const sections = useMemo<ContextCascaderSection[]>(() => {
    return [
      {
        id: 'text',
        label: t('markdownDocument.menu.text'),
        description: t('markdownDocument.menu.textDesc'),
        items: [
          createCommandItem('toggle-strong', t('markdownDocument.menu.bold'), t('markdownDocument.menu.boldDesc'), <Bold className="h-3.5 w-3.5" />, editor, selectionContext),
          createCommandItem('toggle-emphasis', t('markdownDocument.menu.italic'), t('markdownDocument.menu.italicDesc'), <Type className="h-3.5 w-3.5" />, editor, selectionContext),
          createCommandItem('toggle-strikethrough', t('markdownDocument.menu.strike'), t('markdownDocument.menu.strikeDesc'), <Strikethrough className="h-3.5 w-3.5" />, editor, selectionContext),
          createCommandItem('toggle-inline-code', t('markdownDocument.menu.inlineCode'), t('markdownDocument.menu.inlineCodeDesc'), <Code2 className="h-3.5 w-3.5" />, editor, selectionContext),
          createCommandItem('toggle-link', t('markdownDocument.menu.link'), t('markdownDocument.menu.linkDesc'), <Link2 className="h-3.5 w-3.5" />, editor, selectionContext),
          createCommandItem('clear-format', t('markdownDocument.menu.clearFormat'), t('markdownDocument.menu.clearFormatDesc'), <Minus className="h-3.5 w-3.5" />, editor, selectionContext),
        ],
      },
      {
        id: 'block',
        label: t('markdownDocument.menu.block'),
        description: t('markdownDocument.menu.blockDesc'),
        items: [
          createCommandItem('paragraph', t('markdownDocument.menu.paragraph'), t('markdownDocument.menu.paragraphDesc'), <Type className="h-3.5 w-3.5" />, editor, selectionContext),
          createCommandItem('heading-1', t('markdownDocument.menu.heading1'), t('markdownDocument.menu.headingDesc'), <Heading1 className="h-3.5 w-3.5" />, editor, selectionContext),
          createCommandItem('heading-2', t('markdownDocument.menu.heading2'), t('markdownDocument.menu.headingDesc'), <Heading2 className="h-3.5 w-3.5" />, editor, selectionContext),
          createCommandItem('heading-3', t('markdownDocument.menu.heading3'), t('markdownDocument.menu.headingDesc'), <Heading3 className="h-3.5 w-3.5" />, editor, selectionContext),
          createCommandItem('blockquote', t('markdownDocument.menu.quote'), t('markdownDocument.menu.quoteDesc'), <Quote className="h-3.5 w-3.5" />, editor, selectionContext),
          createCommandItem('code-block', t('markdownDocument.menu.codeBlock'), t('markdownDocument.menu.codeBlockDesc'), <FileCode2 className="h-3.5 w-3.5" />, editor, selectionContext),
          createCommandItem('horizontal-rule', t('markdownDocument.menu.hr'), t('markdownDocument.menu.hrDesc'), <Minus className="h-3.5 w-3.5" />, editor, selectionContext),
        ],
      },
      {
        id: 'list',
        label: t('markdownDocument.menu.list'),
        description: t('markdownDocument.menu.listDesc'),
        items: [
          createCommandItem('bullet-list', t('markdownDocument.menu.bulletList'), t('markdownDocument.menu.bulletListDesc'), <List className="h-3.5 w-3.5" />, editor, selectionContext),
          createCommandItem('ordered-list', t('markdownDocument.menu.orderedList'), t('markdownDocument.menu.orderedListDesc'), <ListOrdered className="h-3.5 w-3.5" />, editor, selectionContext),
          createCommandItem('sink-list-item', t('markdownDocument.menu.indent'), t('markdownDocument.menu.indentDesc'), <ListChecks className="h-3.5 w-3.5" />, editor, selectionContext),
          createCommandItem('lift-list-item', t('markdownDocument.menu.outdent'), t('markdownDocument.menu.outdentDesc'), <ListChecks className="h-3.5 w-3.5" />, editor, selectionContext),
        ],
      },
      {
        id: 'insert',
        label: t('markdownDocument.menu.insert'),
        description: t('markdownDocument.menu.insertDesc'),
        items: [
          createCommandItem('insert-link', t('markdownDocument.menu.insertLink'), t('markdownDocument.menu.insertLinkDesc'), <Link2 className="h-3.5 w-3.5" />, editor, selectionContext),
          createCommandItem('insert-image', t('markdownDocument.menu.insertImage'), t('markdownDocument.menu.insertImageDesc'), <Image className="h-3.5 w-3.5" />, editor, selectionContext),
          createCommandItem('insert-code-block', t('markdownDocument.menu.insertCodeBlock'), t('markdownDocument.menu.insertCodeBlockDesc'), <FileCode2 className="h-3.5 w-3.5" />, editor, selectionContext),
          {
            id: 'insert-table',
            label: t('markdownDocument.menu.insertTable'),
            description: t('markdownDocument.menu.insertTableDesc'),
            icon: <Table2 className="h-3.5 w-3.5" />,
            disabled: !editor || !canRunMarkdownDocumentCommand('insert-table', selectionContext),
            children: [
              {
                id: 'insert-table-size',
                label: t('markdownDocument.menu.insertTable'),
                tablePicker: {
                  maxRows: 6,
                  maxColumns: 6,
                  selectionSummary: (rows, columns) => t('markdownDocument.menu.tableSelectionSummary', { rows, columns }),
                  cellLabel: (rows, columns) => t('markdownDocument.menu.tableCellAria', { rows, columns }),
                  onSelect: (rows, columns) => {
                    if (editor) runMarkdownDocumentCommand(editor, { id: 'insert-table', payload: { row: rows, col: columns } })
                  },
                },
              },
            ],
          },
        ],
      },
    ]
  }, [editor, selectionContext, t])

  return <ContextCascader x={x} y={y} title={t('markdownDocument.menu.title')} sections={sections} onClose={onClose} />
}
