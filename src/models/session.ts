import { z } from 'zod'

export const TraceSessionSchema = z.object({
  traceId: z.string().min(1),
  agentName: z.string().min(1),
  taskIntent: z.string().min(1),
  startTime: z.string().datetime(),
  endTime: z.string().datetime().optional(),
  status: z.enum(['active', 'completed', 'failed']),
  eventCount: z.number().int().nonnegative()
})

export type TraceSession = z.infer<typeof TraceSessionSchema>