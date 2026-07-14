import type { AiGatewayLogRoute } from '../../../shared/types'
import type { JsonObject } from './protocol-types'

export type RouteKind = 'anthropic' | 'responses' | 'chat'

export type RoutedPath = {
  path: string
  profileId?: string
}

export function routeErrorPayload(
  kind: RouteKind,
  message: string,
  code = 'ai_gateway_error',
  details?: JsonObject
): JsonObject {
  if (kind === 'anthropic') {
    return {
      type: 'error',
      error: {
        type: code,
        message,
        ...details,
      },
    }
  }

  return {
    error: {
      message,
      type: code,
      code,
      ...details,
    },
  }
}

export function routeTitle(route: AiGatewayLogRoute): string {
  if (route === 'anthropic') return 'Anthropic request'
  if (route === 'responses') return 'Responses request'
  if (route === 'chat') return 'Chat Completions request'
  return 'Gateway request'
}

export function parseRoutedPath(pathname: string): RoutedPath {
  const match = pathname.match(/^\/profiles\/([^/]+)(\/.*)?$/)
  if (!match) return { path: pathname }
  return {
    profileId: decodeURIComponent(match[1] ?? ''),
    path: match[2] || '/',
  }
}
