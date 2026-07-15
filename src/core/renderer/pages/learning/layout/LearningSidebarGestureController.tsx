import type { RefObject } from 'react'
import { SidebarGestureOverlay } from '../../../components/SidebarGestureOverlay'
import { useSidebarGesture } from '../../../hooks/useSidebarGesture'

type LearningSidebarGestureControllerProps = {
  pageRootRef: RefObject<HTMLElement | null>
  onBeforeToggle: () => void
  onToggleLeftSidebar: () => void
  onToggleRightSidebar: () => void
}

export function LearningSidebarGestureController({ pageRootRef, onBeforeToggle, onToggleLeftSidebar, onToggleRightSidebar }: LearningSidebarGestureControllerProps) {
  const overlay = useSidebarGesture({ pageRootRef, onBeforeToggle, onToggleLeftSidebar, onToggleRightSidebar })
  return <SidebarGestureOverlay overlay={overlay} />
}
