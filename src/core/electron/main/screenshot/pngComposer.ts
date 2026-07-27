import { deflateSync, inflateSync } from 'node:zlib'

type PngBitmap = { width: number; height: number; pixels: Buffer }
export type PngSlice = { buffer: Buffer; sourceTop: number; sourceBottom: number; destinationTop: number }

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (const value of buffer) {
    crc ^= value
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, 'ascii')
  const body = Buffer.concat([name, data])
  const checksum = Buffer.allocUnsafe(4)
  checksum.writeUInt32BE(crc32(body), 0)
  const length = Buffer.allocUnsafe(4)
  length.writeUInt32BE(data.length, 0)
  return Buffer.concat([length, body, checksum])
}

function unfilterScanlines(data: Buffer, width: number, height: number): Buffer {
  const rowSize = width * 4
  const output = Buffer.alloc(rowSize * height)
  let offset = 0
  for (let row = 0; row < height; row += 1) {
    const filter = data[offset++]
    const current = output.subarray(row * rowSize, (row + 1) * rowSize)
    const previous = row > 0 ? output.subarray((row - 1) * rowSize, row * rowSize) : null
    for (let column = 0; column < rowSize; column += 1) {
      const raw = data[offset++]
      const left = column >= 4 ? current[column - 4] : 0
      const above = previous ? previous[column] : 0
      const upperLeft = previous && column >= 4 ? previous[column - 4] : 0
      let value = raw
      if (filter === 1) value = (raw + left) & 0xff
      else if (filter === 2) value = (raw + above) & 0xff
      else if (filter === 3) value = (raw + Math.floor((left + above) / 2)) & 0xff
      else if (filter === 4) {
        const p = left + above - upperLeft
        const pa = Math.abs(p - left)
        const pb = Math.abs(p - above)
        const pc = Math.abs(p - upperLeft)
        value = (raw + (pa <= pb && pa <= pc ? left : pb <= pc ? above : upperLeft)) & 0xff
      } else if (filter !== 0) throw new Error(`Unsupported PNG filter ${filter}.`)
      current[column] = value
    }
  }
  return output
}

function decodePng(buffer: Buffer): PngBitmap {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('Invalid PNG signature.')
  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  const compressed: Buffer[] = []
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    offset += 12 + length
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'IDAT') compressed.push(data)
    else if (type === 'IEND') break
  }
  if (!width || !height || bitDepth !== 8 || colorType !== 6 || interlace !== 0) {
    throw new Error('Only non-interlaced 8-bit RGBA PNG images are supported.')
  }
  return { width, height, pixels: unfilterScanlines(inflateSync(Buffer.concat(compressed)), width, height) }
}

function encodePng(width: number, height: number, pixels: Buffer): Buffer {
  const rows = Buffer.alloc((width * 4 + 1) * height)
  const rowSize = width * 4
  for (let row = 0; row < height; row += 1) {
    rows[row * (rowSize + 1)] = 0
    pixels.copy(rows, row * (rowSize + 1) + 1, row * rowSize, (row + 1) * rowSize)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
}

export function composePngSlices(slices: PngSlice[], width: number, height: number): Buffer {
  if (!slices.length || width <= 0 || height <= 0) throw new Error('No screenshot slices to compose.')
  const output = Buffer.alloc(width * height * 4)
  for (const slice of slices) {
    const bitmap = decodePng(slice.buffer)
    const sourceTop = Math.max(0, Math.min(bitmap.height, Math.floor(slice.sourceTop)))
    const sourceBottom = Math.max(sourceTop, Math.min(bitmap.height, Math.ceil(slice.sourceBottom)))
    const copyHeight = Math.min(sourceBottom - sourceTop, height - Math.max(0, slice.destinationTop))
    if (copyHeight <= 0) continue
    const sourceWidth = Math.min(width, bitmap.width)
    const destinationTop = Math.max(0, slice.destinationTop)
    for (let row = 0; row < copyHeight; row += 1) {
      bitmap.pixels.copy(output, (destinationTop + row) * width * 4, (sourceTop + row) * bitmap.width * 4, (sourceTop + row) * bitmap.width * 4 + sourceWidth * 4)
    }
  }
  return encodePng(width, height, output)
}
