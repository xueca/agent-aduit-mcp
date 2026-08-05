// 审计配置的 zod 架构：所有字段带默认值
import { z } from 'zod'
import { LevelSchema } from '../models/event.js'

export const AgentAuditConfigSchema = z.object({
  transport: z.literal('stdio').default('stdio'),
  logLevel: LevelSchema.default('info'),
  buffer: z
    .object({
      maxSize: z.number().int().positive().default(1000),
      overflowStrategy: z.literal('drop-oldest').default('drop-oldest')
    })
    .default({}),
  flush: z
    .object({
      intervalMs: z.number().int().positive().default(5000),
      sizeThreshold: z.number().int().positive().default(100),
      pendingLimit: z.number().int().positive().optional(),
      retry: z
        .object({
          maxAttempts: z.number().int().nonnegative().default(3),
          baseDelayMs: z.number().int().nonnegative().default(100),
          backoffFactor: z.number().positive().default(3)
        })
        .optional()
    })
    .default({}),
  writers: z
    .array(
      z.object({
        type: z.string().min(1),
        filePath: z.string().min(1)
      })
    )
    .default([{ type: 'jsonl', filePath: './audit-events.jsonl' }]),
  redaction: z
    .object({
      fields: z.array(z.string()).default(['apiKey', 'token', 'password', 'secret'])
    })
    .default({}),
  notifications: z
    .object({
      enabled: z.boolean().default(true),
      minLevel: LevelSchema.default('warn')
    })
    .default({}),
  storage: z.literal('jsonl').default('jsonl')
})

export type AgentAuditConfig = z.infer<typeof AgentAuditConfigSchema>
