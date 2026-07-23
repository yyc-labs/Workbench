/**
 * Chat stream conversion boundary. Keeping these exports in a gateway-level
 * module makes protocol conversion dependencies explicit at the server edge.
 */
export {
  chatCompletionToAnthropicMessage,
  chatStreamChunkToAnthropicEvents,
  createAnthropicStreamStart,
  createAnthropicStreamState,
  createAnthropicStreamStop,
} from './adapters/chat-to-anthropic'
export {
  chatCompletionToResponses,
  chatStreamChunkToResponsesEvents,
  createResponsesStreamCreated,
  createResponsesStreamFinish,
  createResponsesStreamIds,
  createResponsesStreamStart,
  createResponsesStreamState,
  createResponsesStreamStop,
} from './adapters/chat-to-responses'
