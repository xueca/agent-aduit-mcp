// 当前时间的 ISO 字符串
export function nowIso(): string {
  const now = new Date()
  return now.toISOString()
}