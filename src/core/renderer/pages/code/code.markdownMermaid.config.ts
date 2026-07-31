import type { MermaidConfig } from 'mermaid'

type MermaidThemeMode = 'light' | 'dark'

type ProjectMermaidPalette = {
  border: string
  borderStrong: string
  canvas: string
  danger: string
  foreground: string
  muted: string
  primary: string
  primarySoft: string
  nodeBorders: readonly string[]
  nodeFills: readonly string[]
  series: readonly string[]
  surface: string
  surfaceRaised: string
  success: string
  warning: string
}

const PROJECT_MERMAID_PALETTES: Record<MermaidThemeMode, ProjectMermaidPalette> = {
  light: {
    border: '#d9d9de',
    borderStrong: '#b8b8c0',
    canvas: '#fbfbfc',
    danger: '#bf504a',
    foreground: '#1d1d1f',
    muted: '#6e6e73',
    primary: '#0a84ff',
    primarySoft: '#e8f3ff',
    nodeBorders: ['#79afe1', '#9399d4', '#ab91ca', '#ca91ae', '#d09587', '#c29e61', '#8ba96c', '#63ad94'],
    nodeFills: ['#eaf4fe', '#eff0fc', '#f5effb', '#faeef4', '#fbeeea', '#faf3e5', '#f0f6e9', '#e8f6f1'],
    series: ['#0a84ff', '#6e77d8', '#8b6bb8', '#b26086', '#bf6b57', '#b47b32', '#6f8b46', '#248a63'],
    surface: '#f1f1f4',
    surfaceRaised: '#ffffff',
    success: '#248a63',
    warning: '#a56a21',
  },
  dark: {
    border: '#48484d',
    borderStrong: '#636369',
    canvas: '#232326',
    danger: '#ff8a85',
    foreground: '#f5f5f7',
    muted: '#a1a1a6',
    primary: '#409cff',
    primarySoft: '#203a54',
    nodeBorders: ['#5da9ef', '#8c92df', '#ad87ce', '#d17da4', '#dc8977', '#d4a54f', '#91af67', '#55bd99'],
    nodeFills: ['#203a54', '#30324e', '#3b304b', '#492f3d', '#4a332e', '#463b27', '#30402b', '#234239'],
    series: ['#409cff', '#858ce8', '#a783d0', '#d178a1', '#df826d', '#d69549', '#8eaa5d', '#32d286'],
    surface: '#323236',
    surfaceRaised: '#2c2c2e',
    success: '#32d286',
    warning: '#ffd166',
  },
}

function createThemeVariables(palette: ProjectMermaidPalette): NonNullable<MermaidConfig['themeVariables']> {
  const [blue, indigo, purple, pink, coral, amber, green, teal] = palette.series
  const series = [blue, indigo, purple, pink, coral, amber, green, teal]
  const variables: Record<string, string | number | boolean> = {
    background: palette.canvas,
    primaryColor: palette.surfaceRaised,
    primaryTextColor: palette.foreground,
    primaryBorderColor: palette.borderStrong,
    secondaryColor: palette.primarySoft,
    secondaryTextColor: palette.foreground,
    secondaryBorderColor: palette.primary,
    tertiaryColor: palette.surface,
    tertiaryTextColor: palette.foreground,
    tertiaryBorderColor: palette.border,
    mainBkg: palette.surfaceRaised,
    nodeBkg: palette.surfaceRaised,
    nodeBorder: palette.borderStrong,
    nodeTextColor: palette.foreground,
    lineColor: palette.muted,
    arrowheadColor: palette.muted,
    textColor: palette.foreground,
    titleColor: palette.foreground,
    edgeLabelBackground: palette.canvas,
    clusterBkg: palette.surface,
    clusterBorder: palette.border,
    defaultLinkColor: palette.muted,
    noteBkgColor: palette.primarySoft,
    noteBorderColor: palette.primary,
    noteTextColor: palette.foreground,
    actorBkg: palette.surfaceRaised,
    actorBorder: palette.borderStrong,
    actorTextColor: palette.foreground,
    actorLineColor: palette.borderStrong,
    signalColor: palette.muted,
    signalTextColor: palette.foreground,
    labelBoxBkgColor: palette.surface,
    labelBoxBorderColor: palette.border,
    labelTextColor: palette.foreground,
    loopTextColor: palette.foreground,
    activationBkgColor: palette.primarySoft,
    activationBorderColor: palette.primary,
    sequenceNumberColor: palette.surfaceRaised,
    sectionBkgColor: palette.surface,
    altSectionBkgColor: palette.canvas,
    sectionBkgColor2: palette.primarySoft,
    excludeBkgColor: palette.surface,
    taskBkgColor: palette.primarySoft,
    taskBorderColor: palette.primary,
    taskTextColor: palette.foreground,
    taskTextOutsideColor: palette.foreground,
    taskTextLightColor: palette.surfaceRaised,
    taskTextDarkColor: palette.foreground,
    taskTextClickableColor: palette.primary,
    activeTaskBkgColor: palette.warning,
    activeTaskBorderColor: palette.warning,
    doneTaskBkgColor: palette.success,
    doneTaskBorderColor: palette.success,
    critBkgColor: palette.danger,
    critBorderColor: palette.danger,
    gridColor: palette.border,
    todayLineColor: palette.primary,
    vertLineColor: palette.border,
    personBkg: palette.surfaceRaised,
    personBorder: palette.borderStrong,
    rowOdd: palette.canvas,
    rowEven: palette.surface,
    stateBkg: palette.surfaceRaised,
    stateLabelColor: palette.foreground,
    transitionColor: palette.muted,
    transitionLabelColor: palette.foreground,
    labelBackgroundColor: palette.canvas,
    compositeBackground: palette.surface,
    compositeTitleBackground: palette.primarySoft,
    compositeBorder: palette.border,
    altBackground: palette.canvas,
    innerEndBackground: palette.foreground,
    specialStateColor: palette.primary,
    classText: palette.foreground,
    requirementBackground: palette.surfaceRaised,
    requirementBorderColor: palette.borderStrong,
    requirementTextColor: palette.foreground,
    relationColor: palette.muted,
    relationLabelBackground: palette.canvas,
    relationLabelColor: palette.foreground,
    pieTitleTextColor: palette.foreground,
    pieSectionTextColor: palette.surfaceRaised,
    pieLegendTextColor: palette.foreground,
    pieStrokeColor: palette.canvas,
    pieOuterStrokeColor: palette.border,
    vennTitleTextColor: palette.foreground,
    vennSetTextColor: palette.foreground,
    quadrant1Fill: palette.surface,
    quadrant2Fill: palette.primarySoft,
    quadrant3Fill: palette.canvas,
    quadrant4Fill: palette.surfaceRaised,
    quadrant1TextFill: palette.foreground,
    quadrant2TextFill: palette.foreground,
    quadrant3TextFill: palette.foreground,
    quadrant4TextFill: palette.foreground,
    quadrantPointFill: palette.primary,
    quadrantPointTextFill: palette.foreground,
    quadrantXAxisTextFill: palette.muted,
    quadrantYAxisTextFill: palette.muted,
    quadrantInternalBorderStrokeFill: palette.border,
    quadrantExternalBorderStrokeFill: palette.borderStrong,
    quadrantTitleFill: palette.foreground,
    archEdgeColor: palette.muted,
    archEdgeArrowColor: palette.primary,
    archGroupBorderColor: palette.border,
    wardleyEvolutionColor: palette.primary,
    wardley: palette.foreground,
    radar: palette.primary,
    branchLabelColor: palette.foreground,
    tagLabelColor: palette.foreground,
    tagLabelBackground: palette.primarySoft,
    tagLabelBorder: palette.primary,
    commitLabelColor: palette.foreground,
    commitLabelBackground: palette.canvas,
    emUiFill: palette.surfaceRaised,
    emUiStroke: palette.borderStrong,
    emProcessorFill: palette.primarySoft,
    emProcessorStroke: palette.primary,
    emReadModelFill: palette.surface,
    emReadModelStroke: palette.borderStrong,
    emCommandFill: palette.primarySoft,
    emCommandStroke: palette.primary,
    emEventFill: palette.surfaceRaised,
    emEventStroke: palette.success,
    emSwimlaneBackgroundOdd: palette.canvas,
    emSwimlaneBackgroundStroke: palette.border,
    emArrowhead: palette.muted,
    emRelationStroke: palette.muted,
    attributeBackgroundColorOdd: palette.canvas,
    attributeBackgroundColorEven: palette.surface,
    errorBkgColor: palette.danger,
    errorTextColor: palette.surfaceRaised,
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif",
    fontSize: '14px',
  }

  series.forEach((color, index) => {
    variables[`cScale${index}`] = color
    variables[`cScaleLabel${index}`] = palette.foreground
    variables[`cScaleInv${index}`] = palette.canvas
    variables[`fillType${index}`] = color
    variables[`git${index}`] = color
    variables[`gitBranchLabel${index}`] = palette.surfaceRaised
    variables[`gitInv${index}`] = palette.canvas
  })
  Array.from({ length: 12 }, (_, index) => {
    variables[`pie${index + 1}`] = series[index % series.length]
  })
  Array.from({ length: 8 }, (_, index) => {
    variables[`venn${index + 1}`] = series[index % series.length]
  })

  return variables as NonNullable<MermaidConfig['themeVariables']>
}

function createProjectMermaidThemeCss(palette: ProjectMermaidPalette): string {
  const nodeColorRules = palette.nodeFills
    .map((fill, index) => {
      const position = index + 1
      const border = palette.nodeBorders[index]
      return `
        .nodes > .node:nth-of-type(8n + ${position}) > :is(rect, circle, ellipse, polygon, path),
        .nodes > .node:nth-of-type(8n + ${position}) > g > :is(rect, circle, ellipse, polygon, path),
        .mindmap-node:nth-of-type(8n + ${position}) :is(rect, circle, ellipse, polygon, path),
        .timeline-node:nth-of-type(8n + ${position}) > .node-bkg,
        .kanban-item:nth-of-type(8n + ${position}),
        .treemap-node:nth-of-type(8n + ${position}) { fill: ${fill}; stroke: ${border}; }
      `
    })
    .join('')

  return `
  .titleText, .chart-title, .statediagramTitleText, .classTitle { font-weight: 650; letter-spacing: -0.01em; }
  .node rect, .node circle, .node ellipse, .node polygon, .node path, .actor, .entityBox, .requirementBox, .element { stroke-width: 1.15px; }
  .node rect, .cluster rect, .actor, .entityBox, .requirementBox, .element, .task, .section { rx: 10px; ry: 10px; }
  .cluster rect, .statediagram-cluster rect { rx: 14px; ry: 14px; }
  .edgeLabel rect, .labelBox, .note, .loopLine { rx: 7px; ry: 7px; }
  .edgePath path, .flowchart-link, .messageLine0, .messageLine1, .transition, .relation { stroke-linecap: round; stroke-linejoin: round; }
  .label, .nodeLabel, .edgeLabel, .messageText, .loopText, .noteText, .taskText, .sectionTitle, .commit-label, .branch-label { font-weight: 500; }
  .edgeLabel, .labelBox, .branch-label, .commit-label { filter: none; }
  .pieCircle, .pieOuterCircle, .slice, .venn-circle, .quadrant { stroke-linejoin: round; }
  .mindmap-node rect, .mindmap-node circle, .mindmap-node ellipse, .timeline-node, .kanban-item, .kanban-section, .treemap-node { stroke-width: 1.1px; }
  .packetBlock, .block, .architecture-service, .architecture-group, .radar-axis, .xychart-plot, .sankey-node { shape-rendering: geometricPrecision; }
  .nodes > .node .label, .nodes > .node .nodeLabel, .mindmap-node .label, .timeline-node text, .kanban-item text, .treemap-node text { fill: ${palette.foreground}; color: ${palette.foreground}; }
  .timeline-node text { font-weight: 600; }
  .lineWrapper line, .timeline-node > line { stroke: ${palette.muted}; }
  .lineWrapper marker path, marker[id$='arrowhead'] path { fill: ${palette.muted}; stroke: ${palette.muted}; }
  ${nodeColorRules}
  .mindmap-node.section-root :is(rect, path, circle, polygon) { fill: ${palette.primary} !important; stroke: ${palette.primary} !important; }
  .mindmap-node.section-root text,
  .mindmap-node.section-root .text-inner-tspan { fill: ${palette.surfaceRaised} !important; color: ${palette.surfaceRaised} !important; font-weight: 700; }
  .mindmap-node.section-root .label text { text-anchor: middle; }
  text { text-rendering: geometricPrecision; }
  `
}

export function createMermaidRenderConfig(themeMode: MermaidThemeMode): MermaidConfig {
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    themeVariables: createThemeVariables(PROJECT_MERMAID_PALETTES[themeMode]),
    themeCSS: createProjectMermaidThemeCss(PROJECT_MERMAID_PALETTES[themeMode]),
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif",
    // Mermaid 11 still reads top-level htmlLabels in some flowchart paths.
    htmlLabels: false,
    flowchart: {
      htmlLabels: false,
      curve: 'basis',
      padding: 14,
    },
    sequence: {
      actorMargin: 56,
      boxMargin: 12,
      diagramMarginX: 24,
      diagramMarginY: 20,
      messageMargin: 32,
      noteMargin: 12,
    },
  }
}
