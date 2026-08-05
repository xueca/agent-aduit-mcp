// UUID v7 生成：时间戳高位在前 + 版本/变体位
import { getRandomValues } from 'node:crypto'

export function uuidV7(): string {
  const bytes = new Uint8Array(16)
  getRandomValues(bytes)
  const nowMs = BigInt(Date.now())
  for (let i = 0; i < 6; i += 1) {
    bytes[i] = Number((nowMs >> BigInt(40 - i * 8)) & 0xffn)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hexPairs: string[] = []
  for (const byte of bytes) {
    const hexRaw = byte.toString(16)
    hexPairs.push(hexRaw.padStart(2, '0'))
  }
  const hex = hexPairs.join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}