import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Bold, BookMarked, ChevronRight, CircleHelp, Code, FileCode2, FileText, Heading1, Heading2, Heading3, Image, Link2, List, ListChecks, ListOrdered, ListTodo, Minus, NotebookTabs, Quote, Strikethrough, Table2, Type } from 'lucide-react'
import { useI18n } from '../../../i18n'
import type { LearningMarkdownInsertRequest, LearningMarkdownTemplateKey } from './learningMarkdownTemplates'

interface LearningMarkdownContextMenuProps {
  x: number
  y: number
  onApply: (request: LearningMarkdownInsertRequest) => void
  onClose: () => void
}

type MenuCategoryKey = 'basic' | 'structure' | 'learning' | 'table'

type MenuNode = {
  id: string
  label: string
  description?: string
  icon?: React.ReactNode
  template?: LearningMarkdownTemplateKey
  count?: number
  children?: MenuNode[]
}

type MenuCategory = {
  key: MenuCategoryKey
  label: string
  description: string
}

function clampMenuPosition(x: number, y: number, width: number, height: number) {
  const padding = 8
  return {
    left: Math.min(Math.max(padding, x), window.innerWidth - width - padding),
    top: Math.min(Math.max(padding, y), window.innerHeight - height - padding),
  }
}

function clampPanelLeft(left: number, width: number): number {
  const padding = 8
  return Math.min(left, window.innerWidth - width - padding)
}

function clampPanelTop(top: number, height: number): number {
  const padding = 8
  return Math.min(Math.max(padding, top), window.innerHeight - height - padding)
}

function preventMenuButtonFocus(event: React.MouseEvent<HTMLButtonElement>) {
  event.preventDefault()
}

function ContextFlyout({ left, top, title, items, activeItemId, onHoverItem, onSelectItem }: { left: number; top: number; title?: string; items: MenuNode[]; activeItemId?: string | null; onHoverItem: (node: MenuNode) => void; onSelectItem: (node: MenuNode) => void }) {
  const panelWidth = 220
  const panelMaxHeight = 360
  return (
    <div
      className="fixed z-[10000] overflow-hidden rounded-[16px] border border-[color:var(--color-border)] bg-[color:var(--color-popover)]/98 p-1.5 shadow-[var(--shadow-popover)] backdrop-blur-[18px]"
      style={{
        left: clampPanelLeft(left, panelWidth),
        top: clampPanelTop(top, panelMaxHeight),
        width: panelWidth,
        maxHeight: panelMaxHeight,
        WebkitBackdropFilter: 'saturate(170%) blur(18px)',
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {title ? <div className="px-2.5 pb-1.5 pt-1 text-[10px] font-medium uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">{title}</div> : null}
      <div className="max-h-[320px] overflow-auto">
        {items.map((item) => {
          const active = activeItemId === item.id
          const hasChildren = Boolean(item.children?.length)
          return (
            <button
              key={item.id}
              type="button"
              className={`group flex w-full items-center gap-3 rounded-[12px] px-3 py-2.5 text-left transition-colors ${active ? 'bg-[color:var(--color-primary)]/12' : 'hover:bg-[color:var(--color-accent)]'}`}
              onMouseDown={preventMenuButtonFocus}
              onMouseEnter={() => onHoverItem(item)}
              onFocus={() => onHoverItem(item)}
              onClick={() => onSelectItem(item)}
            >
              {item.icon ? (
                <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${active ? 'bg-[color:var(--color-primary)]/14 text-[color:var(--color-primary)]' : 'bg-[color:var(--color-accent)] text-[color:var(--color-muted-foreground)] group-hover:text-[color:var(--color-foreground)]'}`}>
                  {item.icon}
                </span>
              ) : null}
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-[color:var(--color-foreground)]">{item.label}</span>
                {item.description ? <span className="block text-[11px] text-[color:var(--color-muted-foreground)]">{item.description}</span> : null}
              </span>
              {hasChildren ? <ChevronRight className={`h-4 w-4 shrink-0 ${active ? 'text-[color:var(--color-primary)]' : 'text-[color:var(--color-muted-foreground)]'}`} /> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function LearningMarkdownContextMenu({ x, y, onApply, onClose }: LearningMarkdownContextMenuProps) {
  const { t } = useI18n()
  const [activeCategory, setActiveCategory] = useState<MenuCategoryKey>('basic')
  const [activeLevel2Id, setActiveLevel2Id] = useState<string | null>(null)
  const [activeLevel3Id, setActiveLevel3Id] = useState<string | null>(null)
  const [hoverRows, setHoverRows] = useState(3)
  const [hoverColumns, setHoverColumns] = useState(3)

  const menuCategories = useMemo<MenuCategory[]>(
    () => [
      {
        key: 'basic',
        label: t('learning.markdown.menu.categories.basic.label'),
        description: t('learning.markdown.menu.categories.basic.description'),
      },
      {
        key: 'structure',
        label: t('learning.markdown.menu.categories.structure.label'),
        description: t('learning.markdown.menu.categories.structure.description'),
      },
      {
        key: 'learning',
        label: t('learning.markdown.menu.categories.learning.label'),
        description: t('learning.markdown.menu.categories.learning.description'),
      },
      {
        key: 'table',
        label: t('learning.markdown.menu.categories.table.label'),
        description: t('learning.markdown.menu.categories.table.description'),
      },
    ],
    [t],
  )

  const listCountChildren = useMemo<MenuNode[]>(
    () =>
      Array.from({ length: 5 }, (_, index) => ({
        id: `count-${index + 1}`,
        label: t('learning.markdown.menu.listCountLabel', { count: index + 1 }),
        description: t('learning.markdown.menu.insert'),
        count: index + 1,
      })),
    [t],
  )

  const categoryNodesMap = useMemo<Record<Exclude<MenuCategoryKey, 'table'>, MenuNode[]>>(
    () => ({
      basic: [
        {
          id: 'heading',
          label: t('learning.markdown.menu.items.heading.label'),
          description: t('learning.markdown.menu.items.heading.description'),
          icon: <Heading1 className="h-3.5 w-3.5" />,
          children: [
            {
              id: 'heading1',
              label: t('learning.markdown.menu.items.heading1.label'),
              description: t('learning.markdown.menu.items.heading1.description'),
              icon: <Heading1 className="h-3.5 w-3.5" />,
              template: 'heading1',
            },
            {
              id: 'heading2',
              label: t('learning.markdown.menu.items.heading2.label'),
              description: t('learning.markdown.menu.items.heading2.description'),
              icon: <Heading2 className="h-3.5 w-3.5" />,
              template: 'heading2',
            },
            {
              id: 'heading3',
              label: t('learning.markdown.menu.items.heading3.label'),
              description: t('learning.markdown.menu.items.heading3.description'),
              icon: <Heading3 className="h-3.5 w-3.5" />,
              template: 'heading3',
            },
          ],
        },
        {
          id: 'bold',
          label: t('learning.markdown.menu.items.bold.label'),
          description: t('learning.markdown.menu.items.bold.description'),
          icon: <Bold className="h-3.5 w-3.5" />,
          template: 'bold',
        },
        {
          id: 'italic',
          label: t('learning.markdown.menu.items.italic.label'),
          description: t('learning.markdown.menu.items.italic.description'),
          icon: <Type className="h-3.5 w-3.5" />,
          template: 'italic',
        },
        {
          id: 'strikethrough',
          label: t('learning.markdown.menu.items.strikethrough.label'),
          description: t('learning.markdown.menu.items.strikethrough.description'),
          icon: <Strikethrough className="h-3.5 w-3.5" />,
          template: 'strikethrough',
        },
        {
          id: 'inlineCode',
          label: t('learning.markdown.menu.items.inlineCode.label'),
          description: t('learning.markdown.menu.items.inlineCode.description'),
          icon: <Code className="h-3.5 w-3.5" />,
          template: 'inlineCode',
        },
        {
          id: 'codeBlock',
          label: t('learning.markdown.menu.items.codeBlock.label'),
          description: t('learning.markdown.menu.items.codeBlock.description'),
          icon: <FileCode2 className="h-3.5 w-3.5" />,
          template: 'codeBlock',
        },
      ],
      structure: [
        {
          id: 'blockquote',
          label: t('learning.markdown.menu.items.blockquote.label'),
          description: t('learning.markdown.menu.items.blockquote.description'),
          icon: <Quote className="h-3.5 w-3.5" />,
          template: 'blockquote',
        },
        {
          id: 'list',
          label: t('learning.markdown.menu.items.list.label'),
          description: t('learning.markdown.menu.items.list.description'),
          icon: <List className="h-3.5 w-3.5" />,
          children: [
            {
              id: 'bulletList',
              label: t('learning.markdown.menu.items.bulletList.label'),
              description: t('learning.markdown.menu.items.bulletList.description'),
              icon: <List className="h-3.5 w-3.5" />,
              template: 'bulletList',
              children: listCountChildren,
            },
            {
              id: 'orderedList',
              label: t('learning.markdown.menu.items.orderedList.label'),
              description: t('learning.markdown.menu.items.orderedList.description'),
              icon: <ListOrdered className="h-3.5 w-3.5" />,
              template: 'orderedList',
              children: listCountChildren,
            },
            {
              id: 'taskList',
              label: t('learning.markdown.menu.items.taskList.label'),
              description: t('learning.markdown.menu.items.taskList.description'),
              icon: <ListChecks className="h-3.5 w-3.5" />,
              template: 'taskList',
              children: listCountChildren,
            },
          ],
        },
        {
          id: 'link',
          label: t('learning.markdown.menu.items.link.label'),
          description: t('learning.markdown.menu.items.link.description'),
          icon: <Link2 className="h-3.5 w-3.5" />,
          template: 'link',
        },
        {
          id: 'image',
          label: t('learning.markdown.menu.items.image.label'),
          description: t('learning.markdown.menu.items.image.description'),
          icon: <Image className="h-3.5 w-3.5" />,
          template: 'image',
        },
        {
          id: 'horizontalRule',
          label: t('learning.markdown.menu.items.horizontalRule.label'),
          description: t('learning.markdown.menu.items.horizontalRule.description'),
          icon: <Minus className="h-3.5 w-3.5" />,
          template: 'horizontalRule',
        },
      ],
      learning: [
        {
          id: 'knowledgePoints',
          label: t('learning.markdown.menu.items.knowledgePoints.label'),
          description: t('learning.markdown.menu.items.knowledgePoints.description'),
          icon: <BookMarked className="h-3.5 w-3.5" />,
          template: 'knowledgePoints',
        },
        {
          id: 'summarySection',
          label: t('learning.markdown.menu.items.summarySection.label'),
          description: t('learning.markdown.menu.items.summarySection.description'),
          icon: <NotebookTabs className="h-3.5 w-3.5" />,
          template: 'summarySection',
        },
        {
          id: 'reviewChecklist',
          label: t('learning.markdown.menu.items.reviewChecklist.label'),
          description: t('learning.markdown.menu.items.reviewChecklist.description'),
          icon: <ListTodo className="h-3.5 w-3.5" />,
          template: 'reviewChecklist',
        },
        {
          id: 'pitfallsSection',
          label: t('learning.markdown.menu.items.pitfallsSection.label'),
          description: t('learning.markdown.menu.items.pitfallsSection.description'),
          icon: <CircleHelp className="h-3.5 w-3.5" />,
          template: 'pitfallsSection',
        },
        {
          id: 'referencesSection',
          label: t('learning.markdown.menu.items.referencesSection.label'),
          description: t('learning.markdown.menu.items.referencesSection.description'),
          icon: <FileText className="h-3.5 w-3.5" />,
          template: 'referencesSection',
        },
      ],
    }),
    [listCountChildren, t],
  )

  const menuMaxHeight = Math.min(560, Math.max(360, window.innerHeight - 24))
  const menuHeaderHeight = 58
  const menuBodyHeight = menuMaxHeight - menuHeaderHeight
  const baseWidth = 520
  const position = clampMenuPosition(x, y, baseWidth, menuMaxHeight)

  const categoryNodes = activeCategory === 'table' ? [] : categoryNodesMap[activeCategory]
  const level2Node = useMemo(() => categoryNodes.find((item) => item.id === activeLevel2Id) ?? null, [activeLevel2Id, categoryNodes])
  const level3Node = useMemo(() => level2Node?.children?.find((item) => item.id === activeLevel3Id) ?? null, [activeLevel3Id, level2Node])

  const handleApplyTemplate = useCallback(
    (template: LearningMarkdownTemplateKey, count?: number) => {
      onApply({
        kind: 'template',
        template,
        count,
      })
    },
    [onApply],
  )

  const handleTableApply = useCallback(
    (rows: number, columns: number) => {
      onApply({
        kind: 'table',
        rows,
        columns,
      })
    },
    [onApply],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  useEffect(() => {
    const onPointerDown = () => onClose()
    const timer = window.setTimeout(() => {
      document.addEventListener('pointerdown', onPointerDown)
    }, 0)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [onClose])

  useEffect(() => {
    setActiveLevel2Id(null)
    setActiveLevel3Id(null)
  }, [activeCategory])

  const activeCategoryMeta = menuCategories.find((category) => category.key === activeCategory) ?? menuCategories[0]

  return createPortal(
    <>
      <div
        className="fixed z-[9998] overflow-hidden rounded-[18px] border border-[color:var(--color-border)] bg-[color:var(--color-popover)]/96 shadow-[var(--shadow-popover)] backdrop-blur-[22px]"
        style={{
          top: position.top,
          left: position.left,
          width: baseWidth,
          maxHeight: menuMaxHeight,
          WebkitBackdropFilter: 'saturate(170%) blur(22px)',
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
      >
        <div className="border-b border-[color:var(--color-border)]/80 px-4 py-3">
          <div className="text-xs font-medium text-[color:var(--color-foreground)]">{t('learning.markdown.menu.title')}</div>
          <div className="mt-0.5 text-[11px] text-[color:var(--color-muted-foreground)]">{t('learning.markdown.menu.subtitle')}</div>
        </div>

        <div className="grid grid-cols-[220px_minmax(0,1fr)]" style={{ height: menuBodyHeight }}>
          <aside className="border-r border-[color:var(--color-border)]/80 bg-[color:var(--color-card)]/40 p-2" style={{ height: menuBodyHeight }}>
            {menuCategories.map((category) => {
              const active = category.key === activeCategory
              const Icon = category.key === 'table' ? Table2 : ChevronRight
              return (
                <button
                  key={category.key}
                  type="button"
                  className={`flex w-full items-center gap-3 rounded-[14px] px-3 py-3 text-left transition-colors ${active ? 'bg-[color:var(--color-primary)]/12 text-[color:var(--color-foreground)]' : 'text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]'}`}
                  onMouseDown={preventMenuButtonFocus}
                  onMouseEnter={() => setActiveCategory(category.key)}
                  onFocus={() => setActiveCategory(category.key)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium">{category.label}</span>
                    <span className="block text-[11px] text-[color:var(--color-muted-foreground)]">{category.description}</span>
                  </span>
                  <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-[color:var(--color-primary)]' : 'text-[color:var(--color-muted-foreground)]'}`} />
                </button>
              )
            })}
          </aside>

          <section className="min-h-0 overflow-hidden p-3">
            <div className="px-1 pb-2">
              <div className="text-[13px] font-medium text-[color:var(--color-foreground)]">{activeCategoryMeta.label}</div>
              <div className="mt-0.5 text-[11px] text-[color:var(--color-muted-foreground)]">{activeCategoryMeta.description}</div>
            </div>

            {activeCategory === 'table' ? (
              <div className="h-[calc(100%-40px)] overflow-auto px-1">
                <div className="mb-3 text-[11px] text-[color:var(--color-muted-foreground)]">
                  {t('learning.markdown.menu.table.selectionSummary', {
                    rows: hoverRows,
                    columns: hoverColumns,
                  })}
                </div>
                <div className="grid grid-cols-6 gap-1.5">
                  {Array.from({ length: 36 }, (_, index) => {
                    const row = Math.floor(index / 6) + 1
                    const column = (index % 6) + 1
                    const active = row <= hoverRows && column <= hoverColumns
                    const sizeLabel = t('learning.markdown.menu.table.cellAria', {
                      rows: row,
                      columns: column,
                    })
                    return (
                      <button
                        key={`${row}-${column}`}
                        type="button"
                        className={`h-9 rounded-[9px] border transition-colors ${active ? 'border-[color:var(--color-primary)] bg-[color:var(--color-primary)]/18' : 'border-[color:var(--color-border)] bg-[color:var(--color-card)] hover:bg-[color:var(--color-accent)]'}`}
                        onMouseDown={preventMenuButtonFocus}
                        onMouseEnter={() => {
                          setHoverRows(row)
                          setHoverColumns(column)
                        }}
                        onFocus={() => {
                          setHoverRows(row)
                          setHoverColumns(column)
                        }}
                        onClick={() => handleTableApply(row, column)}
                        aria-label={sizeLabel}
                        title={sizeLabel}
                      />
                    )
                  })}
                </div>
                <div className="mt-4 rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-accent)]/45 px-3 py-3 text-[11px] leading-5 text-[color:var(--color-muted-foreground)]">{t('learning.markdown.menu.table.help')}</div>
              </div>
            ) : (
              <div className="grid max-h-[calc(100%-40px)] gap-1 overflow-auto">
                {categoryNodes.map((item) => {
                  const hasChildren = Boolean(item.children?.length)
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className="group flex w-full items-center gap-3 rounded-[12px] px-3 py-2.5 text-left transition-colors hover:bg-[color:var(--color-accent)]"
                      onMouseDown={preventMenuButtonFocus}
                      onMouseEnter={() => {
                        if (hasChildren) {
                          setActiveLevel2Id(item.id)
                          setActiveLevel3Id(null)
                        } else {
                          setActiveLevel2Id(null)
                          setActiveLevel3Id(null)
                        }
                      }}
                      onFocus={() => {
                        if (hasChildren) {
                          setActiveLevel2Id(item.id)
                          setActiveLevel3Id(null)
                        } else {
                          setActiveLevel2Id(null)
                          setActiveLevel3Id(null)
                        }
                      }}
                      onClick={() => {
                        if (item.template) {
                          handleApplyTemplate(item.template)
                        }
                      }}
                    >
                      {item.icon ? <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-accent)] text-[color:var(--color-muted-foreground)] group-hover:text-[color:var(--color-foreground)]">{item.icon}</span> : null}
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-medium text-[color:var(--color-foreground)]">{item.label}</span>
                        {item.description ? <span className="block text-[11px] text-[color:var(--color-muted-foreground)]">{item.description}</span> : null}
                      </span>
                      {hasChildren ? <ChevronRight className="h-4 w-4 shrink-0 text-[color:var(--color-muted-foreground)]" /> : null}
                    </button>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      </div>

      {activeCategory !== 'table' && level2Node?.children?.length ? (
        <ContextFlyout
          left={position.left + baseWidth - 10}
          top={position.top + 92}
          title={level2Node.label}
          items={level2Node.children}
          activeItemId={activeLevel3Id}
          onHoverItem={(node) => {
            if (node.children?.length) {
              setActiveLevel3Id(node.id)
            } else {
              setActiveLevel3Id(null)
            }
          }}
          onSelectItem={(node) => {
            if (node.children?.length) {
              setActiveLevel3Id(node.id)
              return
            }
            if (node.template) {
              handleApplyTemplate(node.template)
            }
          }}
        />
      ) : null}

      {activeCategory !== 'table' && level3Node?.children?.length ? (
        <ContextFlyout
          left={position.left + baseWidth + 200}
          top={position.top + 124}
          title={level3Node.label}
          items={level3Node.children}
          activeItemId={null}
          onHoverItem={() => undefined}
          onSelectItem={(node) => {
            if (level3Node.template) {
              handleApplyTemplate(level3Node.template, node.count)
            }
          }}
        />
      ) : null}
    </>,
    document.body,
  )
}
