export const PROJECT_DETAIL_GESTURE_PANE_ORDER = ['code', 'aicommit', 'transcript'] as const

export type ProjectDetailGestureDirection = 'back' | 'forward'

type ProjectDetailGesturePane = (typeof PROJECT_DETAIL_GESTURE_PANE_ORDER)[number]

function normalizeProjectDetailGesturePane(segment: string | undefined): ProjectDetailGesturePane | null {
  if (!segment) return 'code'
  if (segment === 'git') return 'aicommit'
  if ((PROJECT_DETAIL_GESTURE_PANE_ORDER as readonly string[]).includes(segment)) {
    return segment as ProjectDetailGesturePane
  }
  return null
}

export function resolveProjectDetailGestureTarget(
  pathname: string,
  direction: ProjectDetailGestureDirection
): string | null {
  const segments = pathname.split('/').filter(Boolean)
  if (segments[0] !== 'project' || segments.length < 2) return null

  const projectId = segments[1]
  const currentPane = normalizeProjectDetailGesturePane(segments[2])
  if (!projectId || !currentPane) return null

  const currentIndex = PROJECT_DETAIL_GESTURE_PANE_ORDER.indexOf(currentPane)
  const nextPane = direction === 'forward'
    ? PROJECT_DETAIL_GESTURE_PANE_ORDER[currentIndex + 1]
    : PROJECT_DETAIL_GESTURE_PANE_ORDER[currentIndex - 1]

  return nextPane ? `/project/${projectId}/${nextPane}` : null
}
