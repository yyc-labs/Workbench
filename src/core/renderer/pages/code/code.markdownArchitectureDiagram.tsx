import { Fragment, type ComponentPropsWithoutRef } from 'react'

type ArchitectureDiagramNode = {
  title: string
  details?: string[]
  children?: ArchitectureDiagramNode[]
  connectors?: string[]
}

type ArchitectureDiagramRow = {
  nodes: ArchitectureDiagramNode[]
}

type ArchitectureDiagramSection = {
  title: string
  details?: string[]
  nodes: ArchitectureDiagramNode[]
  rows?: ArchitectureDiagramRow[]
}

export type ArchitectureDiagramModel = {
  sections: ArchitectureDiagramSection[]
}

type ArchitectureDiagramBlockProps = ComponentPropsWithoutRef<'div'> & {
  diagram: ArchitectureDiagramModel
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isArchitectureDiagramNode(value: unknown): value is ArchitectureDiagramNode {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.title !== 'string') return false
  if (candidate.details !== undefined && !isStringArray(candidate.details)) return false
  if (candidate.connectors !== undefined && !isStringArray(candidate.connectors)) return false
  if (candidate.children !== undefined) {
    if (!Array.isArray(candidate.children)) return false
    if (!candidate.children.every((item) => isArchitectureDiagramNode(item))) return false
  }
  return true
}

function isArchitectureDiagramSection(value: unknown): value is ArchitectureDiagramSection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.title !== 'string') return false
  if (candidate.details !== undefined && !isStringArray(candidate.details)) return false
  if (!Array.isArray(candidate.nodes) || !candidate.nodes.every((item) => isArchitectureDiagramNode(item))) {
    return false
  }
  if (candidate.rows !== undefined) {
    if (!Array.isArray(candidate.rows)) return false
    if (!candidate.rows.every((row) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return false
      const rowCandidate = row as { nodes?: unknown }
      return Array.isArray(rowCandidate.nodes)
        && rowCandidate.nodes.every((item) => isArchitectureDiagramNode(item))
    })) {
      return false
    }
  }
  return true
}

export function parseArchitectureDiagramProp(value: unknown): ArchitectureDiagramModel | null {
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const sections = (parsed as { sections?: unknown }).sections
    if (!Array.isArray(sections) || !sections.every((item) => isArchitectureDiagramSection(item))) {
      return null
    }
    if (sections.length <= 0) return null
    return { sections }
  } catch {
    return null
  }
}

function ArchitectureNodeCard({
  node,
  nested = false,
}: {
  node: ArchitectureDiagramNode
  nested?: boolean
}) {
  const details = node.details?.filter((item) => item.trim()) ?? []
  const children = node.children?.filter((item) => item.title.trim()) ?? []
  const connectors = node.connectors ?? []

  if (children.length > 0) {
    return (
      <div className={`code-markdown-architecture-node-group ${nested ? 'is-nested' : ''}`.trim()}>
        <div className="code-markdown-architecture-node-group-header">
          <p className="code-markdown-architecture-node-group-title">{node.title}</p>
          {details.length > 0 ? (
            <div className="code-markdown-architecture-node-group-details">
              {details.map((line, index) => (
                <p key={`${line}-${index}`}>{line}</p>
              ))}
            </div>
          ) : null}
        </div>

        <div className="code-markdown-architecture-node-group-flow">
          {children.map((child, index) => (
            <Fragment key={`${child.title}-${index}`}>
              <ArchitectureNodeCard node={child} nested />
              {index < children.length - 1 ? (
                <div className="code-markdown-architecture-inline-connector" aria-hidden="true">
                  <span className="code-markdown-architecture-inline-connector-line" />
                  <span className="code-markdown-architecture-inline-connector-arrow">→</span>
                  {connectors[index]?.trim() ? (
                    <span className="code-markdown-architecture-inline-connector-label">
                      {connectors[index]}
                    </span>
                  ) : null}
                  <span className="code-markdown-architecture-inline-connector-line" />
                </div>
              ) : null}
            </Fragment>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className={`code-markdown-architecture-node-card ${nested ? 'is-nested' : ''}`.trim()}>
      <p className="code-markdown-architecture-node-card-title">{node.title}</p>
      {details.length > 0 ? (
        <div className="code-markdown-architecture-node-card-details">
          {details.map((line, index) => (
            <p key={`${line}-${index}`}>{line}</p>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function ArchitectureDiagramBlock({
  className,
  diagram,
  children: _children,
  ...props
}: ArchitectureDiagramBlockProps) {
  return (
    <div className={className} {...props}>
      <div className="code-markdown-architecture-diagram-body">
        {diagram.sections.map((section, index) => {
          const sectionDetails = section.details?.filter((item) => item.trim()) ?? []
          const rows = section.rows?.filter((row) => row.nodes.some((node) => node.title.trim() || (node.children?.length ?? 0) > 0))
            ?? [{ nodes: section.nodes }]
          return (
            <Fragment key={`${section.title}-${index}`}>
              <section className="code-markdown-architecture-section">
                <header className="code-markdown-architecture-section-header">
                  <p className="code-markdown-architecture-section-title">{section.title}</p>
                  {sectionDetails.length > 0 ? (
                    <div className="code-markdown-architecture-section-details">
                      {sectionDetails.map((line, detailIndex) => (
                        <p key={`${line}-${detailIndex}`}>{line}</p>
                      ))}
                    </div>
                  ) : null}
                </header>

                <div className="code-markdown-architecture-section-rows">
                  {rows.map((row, rowIndex) => {
                    const rowNodes = row.nodes.filter((node) => node.title.trim() || (node.children?.length ?? 0) > 0)
                    if (rowNodes.length <= 0) return null

                    const hasSingleExpandedNode = rowNodes.length === 1 && Boolean(rowNodes[0]?.children?.length)
                    return (
                      <div
                        key={`${section.title}-row-${rowIndex}`}
                        className={`code-markdown-architecture-section-grid ${hasSingleExpandedNode ? 'is-single-expanded' : ''}`.trim()}
                        style={{ ['--architecture-columns' as string]: String(rowNodes.length) }}
                      >
                        {rowNodes.map((node, nodeIndex) => (
                          <ArchitectureNodeCard key={`${node.title}-${rowIndex}-${nodeIndex}`} node={node} />
                        ))}
                      </div>
                    )
                  })}
                </div>
              </section>

              {index < diagram.sections.length - 1 ? (
                <div className="code-markdown-architecture-section-connector" aria-hidden="true">
                  <span className="code-markdown-architecture-section-connector-line" />
                  <span className="code-markdown-architecture-section-connector-arrow">↓</span>
                  <span className="code-markdown-architecture-section-connector-line" />
                </div>
              ) : null}
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}
