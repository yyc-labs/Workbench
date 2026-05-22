import { Background, BackgroundVariant, ReactFlow, type OnInit } from '@xyflow/react'
import { type Dispatch, type SetStateAction } from 'react'
import { FLOW_NODE_TYPES } from './detail.aiFlowNodeTypes'
import {
  FLOW_CANVAS_HEIGHT,
  FLOW_NODE_HEIGHT,
  FLOW_NODE_START_X,
  FLOW_NODE_START_Y,
  FLOW_NODE_WIDTH,
  formatCommitDate,
} from './detail.aiFlow'
import type {
  AiCommitStatus,
  AiFlowEdge,
  AiFlowNode,
  FlowViewportApi,
  LatestCommitInfo,
  RightPaneMode,
} from './detail.types'

type DetailAiCommitPanelProps = {
  rightPaneMode: RightPaneMode
  setRightPaneMode: Dispatch<SetStateAction<RightPaneMode>>
  flowNodes: AiFlowNode[]
  flowEdges: AiFlowEdge[]
  aiRawText: string
  statusClass: string
  statusText: string
  recentCommits: LatestCommitInfo[]
  activeCommitHash: string | null
  setActiveCommitHash: Dispatch<SetStateAction<string | null>>
  flowApiRef: React.MutableRefObject<FlowViewportApi | null>
  flowViewportReadyRef: React.MutableRefObject<boolean>
  flowInitialFocusDoneRef: React.MutableRefObject<boolean>
  flowLastFocusedStepRef: React.MutableRefObject<string | null>
  aiCommitStatus: AiCommitStatus
}

function DetailAiCommitPanel({
  rightPaneMode,
  setRightPaneMode,
  flowNodes,
  flowEdges,
  aiRawText,
  statusClass,
  statusText,
  recentCommits,
  activeCommitHash,
  setActiveCommitHash,
  flowApiRef,
  flowViewportReadyRef,
  flowInitialFocusDoneRef,
  flowLastFocusedStepRef,
}: DetailAiCommitPanelProps) {
  return (
    <aside className="min-h-0 min-w-0 rounded-[24px] surface-card">
      <div className="h-full min-h-0 overflow-auto p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="section-label">AI Commit</p>
            <p className="mt-0.5 text-xs text-[color:var(--color-muted-foreground)]">Process timeline and diagnostics</p>
          </div>
          <div className="quiet-control flex items-center gap-1 rounded-full border-0 p-1">
            <button
              className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${rightPaneMode === 'flow'
                ? 'bg-primary text-white'
                : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'
                }`}
              onClick={() => setRightPaneMode('flow')}
            >
              流程
            </button>
            <button
              className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${rightPaneMode === 'raw'
                ? 'bg-primary text-white'
                : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'
                }`}
              onClick={() => setRightPaneMode('raw')}
            >
              原始日志
            </button>
          </div>
        </div>

        <div>
          {rightPaneMode === 'flow' ? (
            <div className="space-y-3">
              <div
                className="relative overflow-hidden rounded-[20px] border"
                style={{
                  height: `${FLOW_CANVAS_HEIGHT}px`,
                  borderColor: 'color-mix(in srgb, var(--color-border) 78%, transparent)',
                  background:
                    'linear-gradient(180deg, color-mix(in srgb, var(--color-background) 97%, transparent) 0%, color-mix(in srgb, var(--color-background-sunken) 48%, transparent) 100%)',
                }}
              >
                <ReactFlow
                  nodes={flowNodes}
                  edges={flowEdges}
                  nodeTypes={FLOW_NODE_TYPES}
                  fitView
                  fitViewOptions={{ padding: 0.16, minZoom: 0.8, maxZoom: 1.2 }}
                  minZoom={0.95}
                  maxZoom={0.95}
                  nodesDraggable={false}
                  nodesConnectable={false}
                  elementsSelectable={false}
                  panOnDrag={false}
                  panOnScroll={false}
                  zoomOnScroll={false}
                  zoomOnPinch={false}
                  zoomOnDoubleClick={false}
                  nodesFocusable={false}
                  edgesFocusable={false}
                  autoPanOnNodeFocus={false}
                  preventScrolling={false}
                  proOptions={{ hideAttribution: true }}
                  onInit={((instance) => {
                    flowApiRef.current = instance
                    flowViewportReadyRef.current = true
                    flowInitialFocusDoneRef.current = true
                    flowLastFocusedStepRef.current = 'start'
                    const startCenterX = FLOW_NODE_START_X + FLOW_NODE_WIDTH / 2
                    const startCenterY = FLOW_NODE_START_Y + FLOW_NODE_HEIGHT / 2
                    void instance.setCenter(startCenterX, startCenterY, {
                      zoom: 0.95,
                      duration: 0,
                    })
                  }) as OnInit}
                >
                  <Background
                    variant={BackgroundVariant.Lines}
                    gap={24}
                    size={0.55}
                    color="color-mix(in srgb, var(--color-border) 80%, transparent)"
                  />
                </ReactFlow>
                <div className="pointer-events-none absolute inset-x-4 top-4 flex items-center justify-between">
                  <p className="text-[11px] font-medium tracking-[0.02em] text-[color:var(--color-muted-foreground)]">
                    AI Commit Flow
                  </p>
                  <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] ${statusClass}`}>
                    {statusText}
                  </span>
                </div>
              </div>

              <div
                className="rounded-[16px] border px-4 py-3 surface-card"
                style={{
                  borderColor: 'color-mix(in srgb, var(--color-border) 82%, transparent)',
                  background: 'color-mix(in srgb, var(--color-card) 94%, transparent)',
                }}
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">
                  最近提交
                </p>
                {recentCommits.length > 0 ? (
                  <div className="relative isolate mt-2 space-y-2">
                    {recentCommits.map((commit) => (
                      <div
                        key={commit.hash}
                        className="group relative z-0 cursor-pointer rounded-[12px] border border-[color:var(--color-border)] bg-[color:var(--color-card)] px-3 py-2 transition-all duration-200 hover:z-40 hover:border-[color:var(--color-primary)]/35 hover:bg-[color:var(--color-background)]"
                        style={{ boxShadow: 'var(--shadow-card)' }}
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          setActiveCommitHash((prev) => (prev === commit.hash ? null : commit.hash))
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            setActiveCommitHash((prev) => (prev === commit.hash ? null : commit.hash))
                            return
                          }
                          if (event.key === 'Escape') {
                            setActiveCommitHash(null)
                          }
                        }}
                      >
                        <p className="truncate text-sm font-semibold tracking-[-0.01em] text-[color:var(--color-foreground)]">
                          {commit.subject}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[color:var(--color-muted-foreground)]">
                          <span className="rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)] px-2 py-0.5 font-mono">
                            {commit.shortHash}
                          </span>
                          <span>{formatCommitDate(commit.committedAt)}</span>
                        </div>

                        <div
                          className={`absolute -top-2 left-3 right-3 z-50 -translate-y-full transition-all duration-150 ${activeCommitHash === commit.hash
                            ? 'pointer-events-auto scale-100 opacity-100'
                            : 'pointer-events-none scale-[0.985] opacity-0'
                            }`}
                        >
                          <div
                            className="rounded-[14px] border px-3 py-2.5 backdrop-blur-xl"
                            style={{
                              borderColor: 'color-mix(in srgb, var(--color-border) 92%, transparent)',
                              background: 'color-mix(in srgb, var(--color-background) 94%, var(--color-card) 6%)',
                              boxShadow: '0 24px 52px rgba(0, 0, 0, 0.24)',
                            }}
                          >
                            <p className="text-[12.5px] font-semibold tracking-[-0.01em] text-[color:var(--color-foreground)]">
                              {commit.subject}
                            </p>
                            <p className="mt-1 text-[10.5px] text-[color:var(--color-muted-foreground)]">
                              {commit.shortHash} · {formatCommitDate(commit.committedAt)}
                            </p>
                            {commit.bullets.length > 0 && (
                              <div className="mt-2 space-y-1">
                                {commit.bullets.map((line, idx) => (
                                  <div key={`${commit.hash}-b-${idx}`} className="flex items-start gap-1.5 text-[11.5px] leading-5 text-[color:var(--color-foreground)]">
                                    <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[color:var(--color-muted-foreground)]/70" />
                                    <span className="min-w-0 break-words">{line.replace(/^-+\s*/, '')}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-[color:var(--color-muted-foreground)]">暂无提交记录</p>
                )}
              </div>
            </div>
          ) : (
            <div className="max-h-[500px] overflow-auto rounded-[16px] p-4 quiet-control">
              <pre className="whitespace-pre-wrap break-words text-[11px] leading-5 text-[color:var(--color-foreground)]/85">
                {aiRawText || '暂无原始日志'}
              </pre>
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}

export { DetailAiCommitPanel }
