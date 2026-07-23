/**
 * Provider-neutral stream transport boundary. Protocol adapters may consume
 * these helpers without coupling their SSE framing to the gateway server.
 */
export { decodeSseStream, drainSseEvents, encodeSseEvent } from './adapters/sse'
