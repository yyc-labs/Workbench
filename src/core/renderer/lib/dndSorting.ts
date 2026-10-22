import { type CollisionDetection, closestCenter, type Modifier, pointerWithin, rectIntersection } from '@dnd-kit/core'
import type { RefObject } from 'react'

/**
 * 高度不一致列表的碰撞判定：指针坐标优先。
 *
 * closestCenter 要求被拖项「中心」越过邻项中心才翻转，阈值 = (被拖高度 + 邻项高度 + 间距)/2；
 * 卡片高度不一致时（如快捷操作卡片带定时徽章更高）阈值可达 ~100px，视觉盖到位了仍判定未过线，
 * 松手 over 仍是自己导致「拖完弹回原位」。
 *
 * pointerWithin 用指针原始坐标 vs 拖拽前冻结的旧槽位 rect（不经 modifier，不受边界钳制影响）：
 * 指针进入邻项槽位即翻转，阈值与卡片高度无关，符合「把指针放到那张卡片上」的直觉。
 * 指针落在间隙时用重叠面积兜底，最后才退回最近中心。
 */
export const pointerFirstCollision: CollisionDetection = (args) => {
  const within = pointerWithin(args)
  if (within.length > 0) return within
  const intersecting = rectIntersection(args)
  if (intersecting.length > 0) return intersecting
  return closestCenter(args)
}

/**
 * 列表边界钳制：被拖项只能在列表容器内移动（并锁定横向），不能拖出列表无限向下。
 * 与 pointerFirstCollision 配合使用——判定走指针坐标，钳制只约束视觉位移，互不干扰。
 */
export function createListBoundsModifier(listRef: RefObject<HTMLElement | null>): Modifier {
  return ({ draggingNodeRect, transform }) => {
    const containerRect = listRef.current?.getBoundingClientRect()
    if (!draggingNodeRect || !containerRect) return transform
    return {
      ...transform,
      x: 0,
      y: Math.min(Math.max(transform.y, containerRect.top - draggingNodeRect.top), containerRect.bottom - draggingNodeRect.bottom),
    }
  }
}
