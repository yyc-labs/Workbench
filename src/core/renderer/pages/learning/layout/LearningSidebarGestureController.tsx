import type { RefObject } from 'react'
import { SidebarGestureHost } from '../../../components/SidebarGestureHost'

type LearningSidebarGestureControllerProps = {
  pageRootRef: RefObject<HTMLElement | null>
  onBeforeToggle: () => void
  onToggleLeftSidebar: () => void
  onToggleRightSidebar: () => void
}

export function LearningSidebarGestureController({ pageRootRef, onBeforeToggle, onToggleLeftSidebar, onToggleRightSidebar }: LearningSidebarGestureControllerProps) {
  return <SidebarGestureHost pageRootRef={pageRootRef} onBeforeToggle={onBeforeToggle} onToggleLeftSidebar={onToggleLeftSidebar} onToggleRightSidebar={onToggleRightSidebar} />
}
