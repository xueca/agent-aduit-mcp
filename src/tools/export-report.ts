// audit_export_report 工具：按需导出事件或时间线的 Markdown 报告
import { z } from 'zod'
import { AUDIT_ERROR_CODES, AuditError } from '../errors/audit-error.js'
import type { AgentLogEvent } from '../models/event.js'
import {
  buildEventReport,
  buildTraceReport,
  findEventById,
  findEventsByTraceId
} from '../report/report-builder.js'
import { toolError, toolOk } from './index.js'
import type { ToolDefinition } from './index.js'

const ExportReportInputSchema = z.object({
  eventId: z.string().min(1).max(128).optional(),
  traceId: z.string().min(1).max(128).optional()
})

export function createExportReportTool(storageDirs: string[]): ToolDefinition {
  return {
    name: 'audit_export_report',
    description: '按需导出审计事件或追踪时间线为 Markdown 报告',
    inputSchema: ExportReportInputSchema,
    handler: async (args: unknown) => {
      try {
        const input = ExportReportInputSchema.parse(args)
        const report = await runExportReport(storageDirs, input)
        return toolOk({ ok: true, report })
      } catch (error) {
        return toolError(error)
      }
    }
  }
}

async function runExportReport(
  storageDirs: string[],
  input: z.infer<typeof ExportReportInputSchema>
): Promise<string> {
  if (input.eventId === undefined && input.traceId === undefined) {
    throw new AuditError(AUDIT_ERROR_CODES.INVALID_EVENT, '必须提供 eventId 或 traceId')
  }
  if (input.eventId !== undefined) {
    const event = await findEventInDirs(storageDirs, input.eventId)
    if (event !== undefined) {
      return buildEventReport(event)
    }
  }
  if (input.traceId === undefined) {
    throw new AuditError(AUDIT_ERROR_CODES.NOT_FOUND, '未找到匹配的审计记录')
  }
  const events = await findTraceInDirs(storageDirs, input.traceId)
  if (events.length === 0) {
    throw new AuditError(AUDIT_ERROR_CODES.NOT_FOUND, '未找到匹配的审计记录')
  }
  return buildTraceReport(events)
}

async function findEventInDirs(storageDirs: string[], eventId: string): Promise<AgentLogEvent | undefined> {
  for (const dir of storageDirs) {
    const found = await findEventById(dir, eventId)
    if (found !== undefined) {
      return found
    }
  }
  return undefined
}

async function findTraceInDirs(storageDirs: string[], traceId: string): Promise<AgentLogEvent[]> {
  const events: AgentLogEvent[] = []
  for (const dir of storageDirs) {
    const dirEvents = await findEventsByTraceId(dir, traceId)
    events.push(...dirEvents)
  }
  return events
}
