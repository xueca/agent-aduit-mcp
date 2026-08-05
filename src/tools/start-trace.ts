// audit_start_trace 工具：开启一次新的审计追踪
import { z } from 'zod'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { AuditService } from '../core/audit-service.js'
import { toolError, toolOk } from './index.js'
import type { ToolDefinition } from './index.js'

const StartTraceInputSchema = z.object({
  agentName: z.string().min(1),
  taskIntent: z.string().min(1),
  context: z.string().optional()
})

export function createStartTraceTool(service: AuditService): ToolDefinition {
  return {
    name: 'audit_start_trace',
    description: '开始一次新的审计追踪，返回追踪会话信息',
    inputSchema: StartTraceInputSchema,
    handler: async (args: unknown) => {
      try {
        const input = StartTraceInputSchema.parse(args)
        return await runStartTrace(service, input)
      } catch (error) {
        return toolError(error)
      }
    }
  }
}

async function runStartTrace(service: AuditService, input: z.infer<typeof StartTraceInputSchema>) {
  const session = await service.startTrace({
    agentName: input.agentName,
    taskIntent: input.taskIntent,
    context: input.context
  })
  return toolOk({
    ok: true,
    traceId: session.traceId,
    agentName: session.agentName,
    taskIntent: session.taskIntent,
    status: session.status,
    startTime: session.startTime
  })
}