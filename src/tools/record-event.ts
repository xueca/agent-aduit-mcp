// audit_record_event 工具：向指定追踪会话记录一条行为事件
import { z } from 'zod'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { AuditService } from '../core/audit-service.js'
import { AgentEventMetadataSchema, EventPhaseSchema, LevelSchema } from '../models/event.js'
import { toolError, toolOk } from './index.js'
import type { ToolDefinition } from './index.js'

const RecordEventInputSchema = z.object({
  traceId: z.string().min(1),
  phase: EventPhaseSchema,
  level: LevelSchema.optional(),
  message: z.string().min(1),
  metadata: AgentEventMetadataSchema.optional(),
  error: z
    .object({
      code: z.string().min(1),
      message: z.string().min(1),
      stack: z.string().optional()
    })
    .optional()
})

export function createRecordEventTool(service: AuditService): ToolDefinition {
  return {
    name: 'audit_record_event',
    description: '向指定追踪会话记录一条行为事件',
    inputSchema: RecordEventInputSchema,
    handler: async (args: unknown) => {
      try {
        const input = RecordEventInputSchema.parse(args)
        return await runRecordEvent(service, input)
      } catch (error) {
        return toolError(error)
      }
    }
  }
}

async function runRecordEvent(service: AuditService, input: z.infer<typeof RecordEventInputSchema>) {
  const event = await service.recordEvent({
    traceId: input.traceId,
    phase: input.phase,
    level: input.level,
    message: input.message,
    metadata: input.metadata,
    error: input.error
  })
  return toolOk({
    ok: true,
    eventId: event.eventId,
    traceId: event.traceId,
    phase: event.phase,
    level: event.level,
    message: event.message
  })
}