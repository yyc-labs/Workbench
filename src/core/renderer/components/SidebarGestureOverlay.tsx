import type { SidebarGestureOverlayState } from '../hooks/useSidebarGesture'

type SidebarGestureOverlayProps = {
  overlay: SidebarGestureOverlayState
}

export function SidebarGestureOverlay({ overlay }: SidebarGestureOverlayProps) {
  if (!overlay.visible) return null

  const pathPoints = overlay.cursor
    ? [...overlay.points, overlay.cursor]
    : overlay.points
  const polylinePoints = pathPoints.map((point) => `${point.x},${point.y}`).join(' ')
  const startPoint = pathPoints[0]
  const endPoint = pathPoints[pathPoints.length - 1]
  const strokeColor = overlay.status === 'ready'
    ? 'var(--color-success)'
    : overlay.status === 'invalid'
      ? 'var(--color-destructive)'
      : 'var(--color-muted-foreground)'

  return (
    <div className="pointer-events-none fixed inset-0 z-[10000]">
      <svg className="h-full w-full">
        {polylinePoints.length > 0 ? (
          <polyline
            points={polylinePoints}
            fill="none"
            stroke={strokeColor}
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ opacity: 0.82 }}
          />
        ) : null}
        {startPoint ? (
          <circle
            cx={startPoint.x}
            cy={startPoint.y}
            r={4}
            fill={strokeColor}
            style={{ opacity: 0.75 }}
          />
        ) : null}
        {endPoint ? (
          <circle
            cx={endPoint.x}
            cy={endPoint.y}
            r={5}
            fill={strokeColor}
          />
        ) : null}
      </svg>
    </div>
  )
}
