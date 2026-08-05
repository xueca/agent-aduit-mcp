// 环境变量解析：AGENT_AUDIT_XXX -> 配置片段，非法值抛 CONFIG_INVALID
import { z } from 'zod'
import { LevelSchema } from '../models/event.js'
import { AUDIT_ERROR_CODES, AuditError } from '../errors/audit-error.js'
import type { AgentAuditConfig } from './schema.js'

const WritersSchema = z.array(
  z.object({
    type: z.literal('jsonl'),
    filePath: z.string().min(1)
  })
)

interface EnvPartial {
  flush?: { intervalMs?: number; sizeThreshold?: number }
  [key: string]: unknown
}

function parsePositiveInt(envKey: string, raw: string): number {
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) {
    throw new AuditError(AUDIT_ERROR_CODES.CONFIG_INVALID, `${envKey} 非法: ${raw}`)
  }
  return value
}

function parseTransport(raw: string): EnvPartial {
  if (raw !== 'stdio') {
    throw new AuditError(AUDIT_ERROR_CODES.CONFIG_INVALID, `AGENT_AUDIT_TRANSPORT 非法: ${raw}`)
  }
  return { transport: 'stdio' }
}

function parseLogLevel(raw: string): EnvPartial {
  const parsed = LevelSchema.safeParse(raw)
  if (!parsed.success) {
    throw new AuditError(AUDIT_ERROR_CODES.CONFIG_INVALID, `AGENT_AUDIT_LOG_LEVEL 非法: ${raw}`)
  }
  return { logLevel: parsed.data }
}

function parseBufferSize(raw: string): EnvPartial {
  return { buffer: { maxSize: parsePositiveInt('AGENT_AUDIT_BUFFER_SIZE', raw) } }
}

function parseSink(raw: string): EnvPartial {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new AuditError(AUDIT_ERROR_CODES.CONFIG_INVALID, `AGENT_AUDIT_SINK 非法: ${raw}`)
  }
  const result = WritersSchema.safeParse(parsed)
  if (!result.success) {
    throw new AuditError(AUDIT_ERROR_CODES.CONFIG_INVALID, `AGENT_AUDIT_SINK 非法: ${raw}`)
  }
  return { writers: result.data }
}

function parseRedactFields(raw: string): EnvPartial {
  const rawFields = raw.split(',')
  const fields = rawFields.map((field) => field.trim())
  return { redaction: { fields } }
}

function parseNotifications(raw: string): EnvPartial {
  if (raw === 'true') {
    return { notifications: { enabled: true } }
  }
  if (raw === 'false') {
    return { notifications: { enabled: false } }
  }
  throw new AuditError(AUDIT_ERROR_CODES.CONFIG_INVALID, `AGENT_AUDIT_NOTIFICATIONS 非法: ${raw}`)
}

const ENV_HANDLERS: Record<string, (raw: string) => EnvPartial> = {
  AGENT_AUDIT_TRANSPORT: parseTransport,
  AGENT_AUDIT_LOG_LEVEL: parseLogLevel,
  AGENT_AUDIT_BUFFER_SIZE: parseBufferSize,
  AGENT_AUDIT_SINK: parseSink,
  AGENT_AUDIT_REDACT_FIELDS: parseRedactFields,
  AGENT_AUDIT_NOTIFICATIONS: parseNotifications
}

export function parseEnvConfig(env: Record<string, string | undefined>): Partial<AgentAuditConfig> {
  let result: Partial<AgentAuditConfig> = {}
  for (const envKey of Object.keys(ENV_HANDLERS)) {
    const raw = env[envKey]
    if (raw === undefined) {
      continue
    }
    const partial = ENV_HANDLERS[envKey](raw)
    result = { ...result, ...partial } as Partial<AgentAuditConfig>
  }
  const flushInterval = env.AGENT_AUDIT_FLUSH_INTERVAL
  if (flushInterval !== undefined) {
    result.flush = {
      ...result.flush,
      intervalMs: parsePositiveInt('AGENT_AUDIT_FLUSH_INTERVAL', flushInterval)
    } as AgentAuditConfig['flush']
  }
  const flushThreshold = env.AGENT_AUDIT_FLUSH_THRESHOLD
  if (flushThreshold !== undefined) {
    result.flush = {
      ...result.flush,
      sizeThreshold: parsePositiveInt('AGENT_AUDIT_FLUSH_THRESHOLD', flushThreshold)
    } as AgentAuditConfig['flush']
  }
  return result
}