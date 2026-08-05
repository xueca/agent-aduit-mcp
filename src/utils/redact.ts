// 敏感字段递归脱敏：按字段名匹配（大小写不敏感），循环引用输出 [Circular]
export function redact(value: unknown, fields: readonly string[]): unknown {
  const sensitive = new Set(fields.map((field) => field.toLowerCase()))
  return redactValue(value, sensitive, new Map(), new WeakSet())
}

function redactValue(value: unknown, sensitive: Set<string>, completed: Map<object, unknown>, inProgress: WeakSet<object>): unknown {
  if (typeof value !== 'object' || value === null) {
    return value
  }
  if (inProgress.has(value)) {
    return '[Circular]'
  }
  const done = completed.get(value)
  if (done !== undefined) {
    return done
  }
  inProgress.add(value)
  let result: unknown
  if (Array.isArray(value)) {
    result = value.map((item) => redactValue(item, sensitive, completed, inProgress))
  } else {
    const record = value as Record<string, unknown>
    const redacted: Record<string, unknown> = {}
    for (const key of Object.keys(record)) {
      redacted[key] = sensitive.has(key.toLowerCase())
        ? '[REDACTED]'
        : redactValue(record[key], sensitive, completed, inProgress)
    }
    result = redacted
  }
  inProgress.delete(value)
  completed.set(value, result)
  return result
}
