// audit_get_trail 工具：查询追踪会话的审计事件轨迹
import { z } from 'zod'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { AuditService } from '../core/audit-service.js'
import { EventPhaseSchema, LevelSchema } from '../models/event.js'
import { toolError, toolOk } from './index.js'
import type { ToolDefinition } from './index.js'

const GetTrailInputSchema = z.object({
  traceId: z.string().min(1).max(128),
  phase: EventPhaseSchema.optional(),
  level: LevelSchema.optional(),
  limit: z.number().int().positive().max(1000).optional()
})

export function createGetAuditTrailTool(service: AuditService): ToolDefinition {
  return {
    name: 'audit_get_trail',
    description: '查询指定追踪会话的审计事件列表',
    inputSchema: GetTrailInputSchema,
    handler: async (args: unknown) => {
      try {
        const input = GetTrailInputSchema.parse(args)
        return await runGetTrail(service, input)
      } catch (error) {
        return toolError(error)
      }
    }
  }
}

async function runGetTrail(service: AuditService, input: z.infer<typeof GetTrailInputSchema>) {
  const trail = await service.getTrail({
    traceId: input.traceId,
    phase: input.phase,
    level: input.level,
    limit: input.limit
  })
  return toolOk({
    ok: true,
    traceId: input.traceId,
    session: trail.session,
    events: trail.events
  })
}