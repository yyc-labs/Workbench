import { Fragment, type ComponentPropsWithoutRef } from 'react'

type BoxFlowRow = {
  text: string
  note?: string
}

type BoxFlowBox = {
  title: string
  rows: BoxFlowRow[]
}

type BoxFlowConnectorDirection = 'left' | 'right' | 'none'

type BoxFlowConnector = {
  label: string
  direction: BoxFlowConnectorDirection
}

export type BoxFlowModel = {
  boxes: BoxFlowBox[]
  connectors: BoxFlowConnector[]
}

type VerticalFlowStepDetail = {
  text: string
}

type VerticalFlowStep = {
  title: string
  note?: string
  details?: VerticalFlowStepDetail[]
}

type VerticalFlowConnectorDirection = 'down' | 'up' | 'none'

type VerticalFlowConnector = {
  label: string
  direction: VerticalFlowConnectorDirection
}

export type VerticalFlowModel = {
  steps: VerticalFlowStep[]
  connectors: VerticalFlowConnector[]
}

type BoxFlowBlockProps = ComponentPropsWithoutRef<'div'> & {
  flow: BoxFlowModel
}

type VerticalFlowBlockProps = ComponentPropsWithoutRef<'div'> & {
  flow: VerticalFlowModel
}

type DecisionBranch = {
  label: string
  segments: string[]
}

type StepDetailPresentation =
  | {
    kind: 'pipeline'
    segments: string[]
  }
  | {
    kind: 'text'
    text: string
  }

const INLINE_ARROW_SPLIT_PATTERN = /\s*(?:->|=>|→|⇒|↦|⟶|⟹)\s*/

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isBoxFlowRow(value: unknown): value is BoxFlowRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.text !== 'string') return false
  if (candidate.note !== undefined && typeof candidate.note !== 'string') return false
  return true
}

function isBoxFlowBox(value: unknown): value is BoxFlowBox {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.title !== 'string') return false
  if (!Array.isArray(candidate.rows) || !candidate.rows.every((item) => isBoxFlowRow(item))) return false
  return true
}

function isBoxFlowConnector(value: unknown): value is BoxFlowConnector {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.label !== 'string') return false
  return candidate.direction === 'left' || candidate.direction === 'right' || candidate.direction === 'none'
}

function isVerticalFlowStepDetail(value: unknown): value is VerticalFlowStepDetail {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return typeof (value as { text?: unknown }).text === 'string'
}

function isVerticalFlowStep(value: unknown): value is VerticalFlowStep {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.title !== 'string') return false
  if (candidate.note !== undefined && typeof candidate.note !== 'string') return false
  if (candidate.details !== undefined) {
    if (!Array.isArray(candidate.details) || !candidate.details.every((item) => isVerticalFlowStepDetail(item))) {
      return false
    }
  }
  return true
}

function isVerticalFlowConnector(value: unknown): value is VerticalFlowConnector {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.label !== 'string') return false
  return candidate.direction === 'down' || candidate.direction === 'up' || candidate.direction === 'none'
}

export function parseBoxFlowProp(value: unknown): BoxFlowModel | null {
  if (typeof value !== 'string') return null

  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const boxes = (parsed as { boxes?: unknown }).boxes
    const connectors = (parsed as { connectors?: unknown }).connectors
    if (!Array.isArray(boxes) || !boxes.every((item) => isBoxFlowBox(item))) return null
    if (!Array.isArray(connectors) || !connectors.every((item) => isBoxFlowConnector(item))) return null
    if (boxes.length <= 0) return null

    return {
      boxes,
      connectors,
    }
  } catch {
    return null
  }
}

export function parseVerticalFlowProp(value: unknown): VerticalFlowModel | null {
  if (typeof value !== 'string') return null

  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const steps = (parsed as { steps?: unknown }).steps
    const connectors = (parsed as { connectors?: unknown }).connectors
    if (!Array.isArray(steps) || !steps.every((item) => isVerticalFlowStep(item))) return null
    if (!Array.isArray(connectors) || !connectors.every((item) => isVerticalFlowConnector(item))) return null
    if (steps.length <= 0) return null

    return {
      steps,
      connectors,
    }
  } catch {
    return null
  }
}

function countGraphemes(value: string): number {
  return Array.from(value).length
}

function splitArrowSegments(value: string): string[] {
  const trimmed = value.trim()
  if (!trimmed) return []
  return trimmed
    .split(INLINE_ARROW_SPLIT_PATTERN)
    .map((segment) => segment.trim())
    .filter(Boolean)
}

function isCompactLabel(value: string): boolean {
  return countGraphemes(value) <= 18
}

function getDecisionBranches(details: VerticalFlowStepDetail[]): DecisionBranch[] | null {
  if (details.length < 2) return null

  const branches: DecisionBranch[] = []

  for (const detail of details) {
    const segments = splitArrowSegments(detail.text)
    if (segments.length < 2) return null
    const [label, ...rest] = segments
    if (!label || rest.length <= 0 || !isCompactLabel(label)) {
      return null
    }
    branches.push({ label, segments: rest })
  }

  return branches
}

function getStepDetailPresentation(text: string): StepDetailPresentation {
  const segments = splitArrowSegments(text)
  if (segments.length >= 2) {
    return {
      kind: 'pipeline',
      segments,
    }
  }

  return {
    kind: 'text',
    text: text.trim(),
  }
}

function isInlineFlowCandidate(flow: VerticalFlowModel): boolean {
  return (
    flow.steps.length >= 3 &&
    flow.steps.length <= 8 &&
    flow.steps.every((step) => {
      if (step.note || (step.details?.length ?? 0) > 0) return false
      return countGraphemes(step.title) <= 28
    }) &&
    flow.connectors.every((connector) => !connector.label.trim() && connector.direction !== 'up')
  )
}

function getHorizontalConnectorGlyph(direction: BoxFlowConnectorDirection): string {
  if (direction === 'left') return '←'
  if (direction === 'none') return '•'
  return '→'
}

function getVerticalConnectorGlyph(direction: VerticalFlowConnectorDirection): string {
  if (direction === 'up') return '↑'
  if (direction === 'none') return '•'
  return '↓'
}

function formatStepIndex(index: number): string {
  return String(index + 1).padStart(2, '0')
}

function FlowPipeline({
  className,
  segments,
}: {
  className?: string
  segments: string[]
}) {
  const safeSegments = segments.map((segment) => segment.trim()).filter(Boolean)
  if (safeSegments.length <= 0) return null

  return (
    <div className={className}>
      {safeSegments.map((segment, index) => (
        <Fragment key={`${segment}-${index}`}>
          <span className="code-markdown-flow-pipeline-chip">{segment}</span>
          {index < safeSegments.length - 1 ? (
            <span className="code-markdown-flow-pipeline-arrow" aria-hidden="true">
              →
            </span>
          ) : null}
        </Fragment>
      ))}
    </div>
  )
}

function BoxFlowConnectorView({ connector }: { connector: BoxFlowConnector }) {
  return (
    <div className="code-markdown-flow-lane-connector" aria-hidden="true">
      <span className="code-markdown-flow-lane-connector-line" />
      {connector.label.trim() ? (
        <span className="code-markdown-flow-lane-connector-label">{connector.label}</span>
      ) : null}
      <span className="code-markdown-flow-lane-connector-orb">
        {getHorizontalConnectorGlyph(connector.direction)}
      </span>
      <span className="code-markdown-flow-lane-connector-line" />
    </div>
  )
}

export function BoxFlowBlock({
  className,
  flow,
  children: _children,
  ...props
}: BoxFlowBlockProps) {
  return (
    <div className={className} {...props}>
      <div className="code-markdown-flow-lane">
        {flow.boxes.map((box, index) => {
          const rows = box.rows.filter((row) => row.text.trim() || row.note?.trim())
          if (rows.length <= 0) return null

          return (
            <Fragment key={`${box.title}-${index}`}>
              <section className="code-markdown-flow-lane-node">
                {box.title.trim() ? (
                  <p className="code-markdown-flow-lane-node-eyebrow">{box.title}</p>
                ) : null}
                <div className="code-markdown-flow-lane-card">
                  {rows.map((row, rowIndex) => (
                    <div className="code-markdown-flow-lane-row" key={`${row.text}-${rowIndex}`}>
                      <span className="code-markdown-flow-lane-row-text">{row.text}</span>
                      {row.note?.trim() ? (
                        <span className="code-markdown-flow-inline-pill">{row.note}</span>
                      ) : null}
                    </div>
                  ))}
                </div>
              </section>

              {index < flow.boxes.length - 1 && flow.connectors[index] ? (
                <BoxFlowConnectorView connector={flow.connectors[index] as BoxFlowConnector} />
              ) : null}
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}

function VerticalFlowStepConnector({
  connector,
}: {
  connector: VerticalFlowConnector
}) {
  return (
    <div className="code-markdown-flow-stage-connector" aria-hidden="true">
      <span className="code-markdown-flow-stage-connector-line" />
      <span className="code-markdown-flow-stage-connector-orb">
        {getVerticalConnectorGlyph(connector.direction)}
      </span>
      {connector.label.trim() ? (
        <span className="code-markdown-flow-stage-connector-label">{connector.label}</span>
      ) : null}
    </div>
  )
}

function DecisionBranchCard({ branch }: { branch: DecisionBranch }) {
  return (
    <article className="code-markdown-flow-branch-card">
      <p className="code-markdown-flow-branch-label">{branch.label}</p>
      {branch.segments.length === 1 ? (
        <p className="code-markdown-flow-branch-text">{branch.segments[0]}</p>
      ) : (
        <FlowPipeline
          className="code-markdown-flow-branch-pipeline"
          segments={branch.segments}
        />
      )}
    </article>
  )
}

function VerticalFlowStepBody({ step }: { step: VerticalFlowStep }) {
  const details = step.details?.filter((detail) => detail.text.trim()) ?? []
  if (details.length <= 0) return null

  const branches = getDecisionBranches(details)
  if (branches) {
    return (
      <div className="code-markdown-flow-branch-grid">
        {branches.map((branch, index) => (
          <DecisionBranchCard key={`${branch.label}-${index}`} branch={branch} />
        ))}
      </div>
    )
  }

  const detailBlocks = details
    .map((detail) => getStepDetailPresentation(detail.text))
    .filter((detail) => (detail.kind === 'pipeline' ? detail.segments.length > 0 : detail.text.length > 0))

  if (detailBlocks.length <= 0) return null

  return (
    <div className="code-markdown-flow-detail-stack">
      {detailBlocks.map((detail, index) => (
        detail.kind === 'pipeline' ? (
          <FlowPipeline
            className="code-markdown-flow-detail-pipeline"
            key={`pipeline-${index}`}
            segments={detail.segments}
          />
        ) : (
          <p className="code-markdown-flow-detail-text" key={`text-${index}`}>
            {detail.text}
          </p>
        )
      ))}
    </div>
  )
}

function InlineFlowTrack({ flow }: { flow: VerticalFlowModel }) {
  return (
    <div className="code-markdown-flow-inline-shell">
      <div className="code-markdown-flow-inline-track">
        {flow.steps.map((step, index) => (
          <Fragment key={`${step.title}-${index}`}>
            <div className="code-markdown-flow-inline-node">
              <span className="code-markdown-flow-inline-node-index">{formatStepIndex(index)}</span>
              <span className="code-markdown-flow-inline-node-title">{step.title}</span>
            </div>
            {index < flow.steps.length - 1 ? (
              <span className="code-markdown-flow-inline-arrow" aria-hidden="true">
                →
              </span>
            ) : null}
          </Fragment>
        ))}
      </div>
    </div>
  )
}

export function VerticalFlowBlock({
  className,
  flow,
  children: _children,
  ...props
}: VerticalFlowBlockProps) {
  if (isInlineFlowCandidate(flow)) {
    return (
      <div className={className} {...props}>
        <InlineFlowTrack flow={flow} />
      </div>
    )
  }

  return (
    <div className={className} {...props}>
      <div className="code-markdown-flow-story">
        {flow.steps.map((step, index) => (
          <Fragment key={`${step.title}-${index}`}>
            <section className="code-markdown-flow-stage">
              <div className="code-markdown-flow-stage-index-rail" aria-hidden="true">
                <span className="code-markdown-flow-stage-index">{formatStepIndex(index)}</span>
              </div>

              <article className="code-markdown-flow-stage-card">
                <header className="code-markdown-flow-stage-card-header">
                  <h3 className="code-markdown-flow-stage-title">{step.title}</h3>
                  {step.note?.trim() ? (
                    <span className="code-markdown-flow-inline-pill">{step.note}</span>
                  ) : null}
                </header>

                <VerticalFlowStepBody step={step} />
              </article>
            </section>

            {index < flow.steps.length - 1 && flow.connectors[index] ? (
              <VerticalFlowStepConnector connector={flow.connectors[index] as VerticalFlowConnector} />
            ) : null}
          </Fragment>
        ))}
      </div>
    </div>
  )
}
