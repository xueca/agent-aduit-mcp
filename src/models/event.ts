import { z } from 'zod'

export const EventPhaseSchema = z.enum([
  'INPUT_SNAPSHOT',
  'REASONING',
  'DECISION',
  'EXECUTION',
  'VERIFICATION'
])

export type EventPhase = z.infer<typeof EventPhaseSchema>

export const LevelSchema = z.enum(['debug', 'info', 'warn', 'error'])

export type Level = z.infer<typeof LevelSchema>

export const AgentEventMetadataSchema = z
  .object({
    toolName: z.string().optional(),
    filePath: z.string().optional(),
    layer: z.string().optional(),
    durationMs: z.number().optional(),
    status: z.enum(['success', 'error', 'skipped']).optional(),
    before: z.unknown().optional(),
    after: z.unknown().optional()
  })
  .passthrough()

export type AgentEventMetadata = z.infer<typeof AgentEventMetadataSchema>

export function levelRank(level: Level): number {
  if (level === 'debug') {
    return 0
  }
  if (level === 'info') {
    return 1
  }
  if (level === 'warn') {
    return 2
  }
  return 3
}

export const AgentLogEventSchema = z.object({
  eventId: z.string().min(1),
  traceId: z.string().min(1),
  parentEventId: z.string().optional(),
  timestamp: z.string().datetime(),
  phase: EventPhaseSchema,
  level: LevelSchema,
  message: z.string().min(1),
  metadata: AgentEventMetadataSchema,
  error: z
    .object({
      code: z.string().min(1),
      message: z.string().min(1),
      stack: z.string().optional()
    })
    .optional()
})

export type AgentLogEvent = z.infer<typeof AgentLogEventSchema>