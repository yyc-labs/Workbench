/**
 * Decodes a `data:<mime>;base64,<payload>` URL into its raw bytes.
 * Returns an empty array when the URL does not carry a base64 payload.
 */
export function base64ToUint8Array(dataUrl: string): Uint8Array {
  const commaIndex = dataUrl.indexOf(',')
  const payload = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl
  if (!payload) return new Uint8Array(0)

  const binary = atob(payload)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}
