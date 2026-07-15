import { createElement } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import type { Components, ExtraProps } from 'react-markdown'
import type { Element as HastElement } from 'hast'
import { ArchitectureDiagramBlock, parseArchitectureDiagramProp } from './code.markdownArchitectureDiagram'
import { BoxDiagramBlock, parseBoxDiagramLinesProp } from './code.markdownBoxDiagram'
import { BoxFlowBlock, parseBoxFlowProp, parseVerticalFlowProp, VerticalFlowBlock } from './code.markdownFlowDiagram'
import { useMarkdownNearViewport } from './code.markdownVisibility'

export type SourceLineDataProps = {
  'data-source-start-line': number
  'data-source-end-line': number
}

export type MarkdownStructuredBlockKind = 'table' | 'box-flow' | 'vertical-flow' | 'box-diagram' | 'mermaid' | 'architecture-diagram'

export type MarkdownStructuredBlockClickPayload = {
  kind: MarkdownStructuredBlockKind
  startLine: number
  endLine: number
}

type SourceTrackedMarkdownNode = Pick<HastElement, 'position'>
type MarkdownBlockProps<TagName extends keyof JSX.IntrinsicElements> = JSX.IntrinsicElements[TagName] & ExtraProps

export function getSourceLineDataProps(node: SourceTrackedMarkdownNode | null | undefined, lineOffset: number): SourceLineDataProps | undefined {
  const startLine = node?.position?.start.line
  const endLine = node?.position?.end.line
  if (typeof startLine !== 'number' || typeof endLine !== 'number') {
    return undefined
  }

  return {
    'data-source-start-line': Math.max(1, Math.floor(startLine) + lineOffset),
    'data-source-end-line': Math.max(1, Math.floor(endLine) + lineOffset),
  }
}

export function createSourceTrackedBlockComponent<TagName extends keyof JSX.IntrinsicElements>(tagName: TagName, lineOffset: number): NonNullable<Components[TagName]> {
  return function SourceTrackedBlock({ children, node, ...props }: MarkdownBlockProps<TagName>) {
    const sourceLineProps = getSourceLineDataProps(node as HastElement | undefined, lineOffset)
    return createElement(tagName, { ...props, ...sourceLineProps }, children)
  } as NonNullable<Components[TagName]>
}

function normalizeMarkdownClassNames(value: unknown): string[] {
  if (typeof value === 'string') {
    return value
      .split(/\s+/)
      .map((item) => item.trim())
      .filter(Boolean)
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => normalizeMarkdownClassNames(item))
  }
  return []
}

function resolveStructuredBlockKind(tagName: 'div' | 'table', className: unknown): MarkdownStructuredBlockKind | null {
  if (tagName === 'table') {
    return 'table'
  }

  const classNames = new Set(normalizeMarkdownClassNames(className))
  if (classNames.has('code-markdown-box-flow')) return 'box-flow'
  if (classNames.has('code-markdown-vertical-flow')) return 'vertical-flow'
  if (classNames.has('code-markdown-architecture-diagram')) return 'architecture-diagram'
  if (classNames.has('code-markdown-box-diagram')) return 'box-diagram'
  return null
}

export function shouldIgnoreStructuredBlockActivation(target: EventTarget | null, currentTarget: EventTarget | null): boolean {
  const selection = window.getSelection()
  if (selection && !selection.isCollapsed && selection.toString().trim()) {
    return true
  }

  if (!(target instanceof Element) || !(currentTarget instanceof Element)) {
    return false
  }

  const interactiveAncestor = target.closest('a,button,input,select,textarea,summary,[role="button"],[role="link"]')
  return Boolean(interactiveAncestor && interactiveAncestor !== currentTarget && currentTarget.contains(interactiveAncestor))
}

function buildStructuredBlockInteractiveProps(structuredBlockKind: MarkdownStructuredBlockKind, title: string | undefined, activate: () => void) {
  const ariaLabel = `Open larger ${structuredBlockKind} preview`
  const resolvedTitle = [title, 'Click to enlarge'].filter(Boolean).join('\n')

  return {
    ariaLabel,
    resolvedTitle: resolvedTitle || undefined,
    sharedProps: {
      tabIndex: 0,
      'data-structured-block-kind': structuredBlockKind,
      onClick: (event: ReactMouseEvent<HTMLElement>) => {
        if (shouldIgnoreStructuredBlockActivation(event.target, event.currentTarget)) return
        activate()
      },
      onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        activate()
      },
    },
  }
}

export function createStructuredBlockComponent<TagName extends 'div' | 'table'>(tagName: TagName, lineOffset: number, onStructuredBlockClick?: (payload: MarkdownStructuredBlockClickPayload) => void): NonNullable<Components[TagName]> {
  return function StructuredMarkdownBlock({ children, node, ...props }: MarkdownBlockProps<TagName>) {
    const [visibilityRef, isNearViewport] = useMarkdownNearViewport<HTMLElement>()
    const sourceLineProps = getSourceLineDataProps(node as HastElement | undefined, lineOffset)
    const rawClassName = (props as { className?: unknown }).className
    const structuredBlockKind = resolveStructuredBlockKind(tagName, rawClassName)

    if (!structuredBlockKind || !sourceLineProps) {
      return createElement(tagName, { ...props, ...sourceLineProps }, children)
    }

    if (tagName === 'div' && !isNearViewport) {
      return createElement(
        tagName,
        {
          ...props,
          ...sourceLineProps,
          'aria-busy': true,
          className: [...normalizeMarkdownClassNames(rawClassName), 'code-markdown-visibility-placeholder'].join(' '),
          ref: visibilityRef,
        },
        null,
      )
    }

    if (!onStructuredBlockClick) {
      if (tagName === 'div' && structuredBlockKind === 'box-flow' && normalizeMarkdownClassNames(rawClassName).includes('code-markdown-box-flow')) {
        const flow = parseBoxFlowProp((props as { ['data-box-flow']?: unknown })['data-box-flow'])
        if (flow) {
          return <BoxFlowBlock {...props} {...sourceLineProps} className={rawClassName as string | undefined} flow={flow} />
        }
      }
      if (tagName === 'div' && structuredBlockKind === 'vertical-flow' && normalizeMarkdownClassNames(rawClassName).includes('code-markdown-vertical-flow')) {
        const flow = parseVerticalFlowProp((props as { ['data-vertical-flow']?: unknown })['data-vertical-flow'])
        if (flow) {
          return <VerticalFlowBlock {...props} {...sourceLineProps} className={rawClassName as string | undefined} flow={flow} />
        }
      }
      if (tagName === 'div' && structuredBlockKind === 'architecture-diagram' && normalizeMarkdownClassNames(rawClassName).includes('code-markdown-architecture-diagram')) {
        const diagram = parseArchitectureDiagramProp((props as { ['data-architecture-diagram']?: unknown })['data-architecture-diagram'])
        if (diagram) {
          return <ArchitectureDiagramBlock {...props} {...sourceLineProps} className={rawClassName as string | undefined} diagram={diagram} />
        }
      }
      if (tagName === 'div' && structuredBlockKind === 'box-diagram' && normalizeMarkdownClassNames(rawClassName).includes('code-markdown-box-diagram')) {
        const diagramLines = parseBoxDiagramLinesProp((props as { ['data-diagram-lines']?: unknown })['data-diagram-lines'])
        return <BoxDiagramBlock {...props} {...sourceLineProps} className={rawClassName as string | undefined} lines={diagramLines} />
      }
      return createElement(tagName, { ...props, ...sourceLineProps }, children)
    }

    const resolvedClassName = [...normalizeMarkdownClassNames(rawClassName), 'code-markdown-zoomable-structure'].join(' ')
    const activate = () => {
      onStructuredBlockClick({
        kind: structuredBlockKind,
        startLine: sourceLineProps['data-source-start-line'],
        endLine: sourceLineProps['data-source-end-line'],
      })
    }
    const { ariaLabel, resolvedTitle, sharedProps } = buildStructuredBlockInteractiveProps(structuredBlockKind, (props as { title?: string }).title, activate)

    if (tagName === 'div' && structuredBlockKind === 'box-flow' && normalizeMarkdownClassNames(rawClassName).includes('code-markdown-box-flow')) {
      const flow = parseBoxFlowProp((props as { ['data-box-flow']?: unknown })['data-box-flow'])
      if (flow) {
        return <BoxFlowBlock {...props} {...sourceLineProps} className={resolvedClassName || undefined} flow={flow} title={resolvedTitle} aria-label={ariaLabel} role="button" {...sharedProps} />
      }
    }

    if (tagName === 'div' && structuredBlockKind === 'vertical-flow' && normalizeMarkdownClassNames(rawClassName).includes('code-markdown-vertical-flow')) {
      const flow = parseVerticalFlowProp((props as { ['data-vertical-flow']?: unknown })['data-vertical-flow'])
      if (flow) {
        return <VerticalFlowBlock {...props} {...sourceLineProps} className={resolvedClassName || undefined} flow={flow} title={resolvedTitle} aria-label={ariaLabel} role="button" {...sharedProps} />
      }
    }

    if (tagName === 'div' && structuredBlockKind === 'architecture-diagram' && normalizeMarkdownClassNames(rawClassName).includes('code-markdown-architecture-diagram')) {
      const diagram = parseArchitectureDiagramProp((props as { ['data-architecture-diagram']?: unknown })['data-architecture-diagram'])
      if (diagram) {
        return <ArchitectureDiagramBlock {...props} {...sourceLineProps} className={resolvedClassName || undefined} diagram={diagram} title={resolvedTitle} aria-label={ariaLabel} role="button" {...sharedProps} />
      }
    }

    if (tagName === 'div' && structuredBlockKind === 'box-diagram' && normalizeMarkdownClassNames(rawClassName).includes('code-markdown-box-diagram')) {
      const diagramLines = parseBoxDiagramLinesProp((props as { ['data-diagram-lines']?: unknown })['data-diagram-lines'])
      return <BoxDiagramBlock {...props} {...sourceLineProps} className={resolvedClassName || undefined} lines={diagramLines} title={resolvedTitle} aria-label={ariaLabel} role="button" {...sharedProps} />
    }

    return createElement(
      tagName,
      {
        ...props,
        ...sourceLineProps,
        className: resolvedClassName || undefined,
        title: resolvedTitle,
        'aria-label': ariaLabel,
        ...(tagName === 'div' ? { role: 'button' as const } : {}),
        ...sharedProps,
      },
      children,
    )
  } as NonNullable<Components[TagName]>
}
