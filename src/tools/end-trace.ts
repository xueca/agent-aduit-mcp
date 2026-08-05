// audit_end_trace 工具：结束追踪会话并返回汇总
import { z } from 'zod'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { AuditService } from '../core/audit-service.js'
import { toolError, toolOk } from './index.js'
import type { ToolDefinition } from './index.js'

const EndTraceInputSchema = z.object({
  traceId: z.string().min(1),
  outcome: z.enum(['completed', 'failed']).default('completed')
})

export function createEndTraceTool(service: AuditService): ToolDefinition {
  return {
    name: 'audit_end_trace',
    description: '结束指定追踪会话并返回事件汇总',
    inputSchema: EndTraceInputSchema,
    handler: async (args: unknown) => {
      try {
        const input = EndTraceInputSchema.parse(args)
        return await runEndTrace(service, input)
      } catch (error) {
        return toolError(error)
      }
    }
  }
}

async function runEndTrace(service: AuditService, input: z.infer<typeof EndTraceInputSchema>) {
  const session = await service.endTrace({
    traceId: input.traceId,
    outcome: input.outcome
  })
  const endTime = session.endTime ?? session.startTime
  const durationMs = Date.parse(endTime) - Date.parse(session.startTime)
  return toolOk({
    ok: true,
    traceId: session.traceId,
    status: session.status,
    eventCount: session.eventCount,
    endTime,
    durationMs
  })
}