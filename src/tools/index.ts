// 工具注册入口：toolOk/toolError 统一包装，5 个审计工具注册到 MCP Server
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { AuditService } from '../core/audit-service.js'
import { AUDIT_ERROR_CODES, AuditError } from '../errors/audit-error.js'
import { createEndTraceTool } from './end-trace.js'
import { createExportReportTool } from './export-report.js'
import { createGetAuditTrailTool } from './get-audit-trail.js'
import { createRecordEventTool } from './record-event.js'
import { createStartTraceTool } from './start-trace.js'

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: z.ZodTypeAny
  handler: (args: unknown) => Promise<CallToolResult>
}

export function toolOk(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] }
}

export function toolError(error: unknown): CallToolResult {
  if (error instanceof AuditError) {
    const body = { ok: false, code: error.code, message: error.message }
    return { content: [{ type: 'text', text: JSON.stringify(body) }], isError: true }
  }
  const message = error instanceof Error ? error.message : String(error)
  const body = { ok: false, code: AUDIT_ERROR_CODES.INVALID_EVENT, message }
  return { content: [{ type: 'text', text: JSON.stringify(body) }], isError: true }
}

export function registerTools(server: McpServer, service: AuditService, storageDirs: string[]): void {
  const definitions: ToolDefinition[] = [
    createStartTraceTool(service),
    createRecordEventTool(service),
    createEndTraceTool(service),
    createGetAuditTrailTool(service),
    createExportReportTool(storageDirs)
  ]
  for (const def of definitions) {
    server.registerTool(
      def.name,
      { description: def.description, inputSchema: def.inputSchema },
      async (args) => def.handler(args)
    )
  }
}