// 单元测试：5 个审计工具 schema 输入长度上限（超长输入必须被 zod 拒绝）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { AuditService } from '../src/core/audit-service.js'
import { createStartTraceTool } from '../src/tools/start-trace.js'
import { createRecordEventTool } from '../src/tools/record-event.js'
import { createEndTraceTool } from '../src/tools/end-trace.js'
import { createGetAuditTrailTool } from '../src/tools/get-audit-trail.js'
import { createExportReportTool } from '../src/tools/export-report.js'

// 服务桩：正常路径返回合法结果，schema 校验失败时不应被调用
const serviceStub = {
  startTrace: async () => ({ traceId: 't1', agentName: 'a', taskIntent: 'i', status: 'active', startTime: '2026-08-04T00:00:00.000Z' }),
  recordEvent: async () => ({ eventId: 'e1', traceId: 't1', phase: 'EXECUTION', level: 'info', message: 'm' }),
  endTrace: async () => ({ traceId: 't1', status: 'completed', eventCount: 1, startTime: '2026-08-04T00:00:00.000Z', endTime: '2026-08-04T00:00:01.000Z' }),
  getTrail: async () => ({ session: {}, events: [] })
} as unknown as AuditService

function parseResult(result: CallToolResult): Record<string, unknown> {
  const content = result.content[0]
  if (content === undefined || content.type !== 'text') {
    throw new Error('工具响应不是 text 类型')
  }
  return JSON.parse(content.text ?? '') as Record<string, unknown>
}

test('startTrace：agentName 超 1024 被拒绝', async () => {
  const tool = createStartTraceTool(serviceStub)
  const result = await tool.handler({ agentName: 'a'.repeat(2000), taskIntent: '修复问题' })
  assert.equal(result.isError, true)
  const body = parseResult(result)
  assert.equal(body.code, 'AUDIT_INVALID_EVENT')
})

test('startTrace：taskIntent 与 context 超 1024 被拒绝', async () => {
  const tool = createStartTraceTool(serviceStub)
  const longTask = await tool.handler({ agentName: 'agent', taskIntent: 't'.repeat(2000) })
  assert.equal(longTask.isError, true)
  const longContext = await tool.handler({ agentName: 'agent', taskIntent: '修复', context: 'c'.repeat(2000) })
  assert.equal(longContext.isError, true)
})

test('startTrace：边界长度 1024 正常通过', async () => {
  const tool = createStartTraceTool(serviceStub)
  const result = await tool.handler({ agentName: 'a'.repeat(1024), taskIntent: 't'.repeat(1024) })
  const body = parseResult(result)
  assert.equal(body.ok, true)
})

test('recordEvent：message 超 64k 被拒绝', async () => {
  const tool = createRecordEventTool(serviceStub)
  const result = await tool.handler({ traceId: 't1', phase: 'EXECUTION', message: 'm'.repeat(70000) })
  assert.equal(result.isError, true)
  const body = parseResult(result)
  assert.equal(body.code, 'AUDIT_INVALID_EVENT')
})

test('recordEvent：traceId 超 128 与 error 超限被拒绝', async () => {
  const tool = createRecordEventTool(serviceStub)
  const longTrace = await tool.handler({ traceId: 't'.repeat(200), phase: 'EXECUTION', message: 'ok' })
  assert.equal(longTrace.isError, true)
  const longError = await tool.handler({
    traceId: 't1',
    phase: 'EXECUTION',
    message: 'ok',
    error: { code: 'X', message: 'e'.repeat(5000) }
  })
  assert.equal(longError.isError, true)
})

test('endTrace / getTrail / exportReport：traceId 超 128 被拒绝', async () => {
  const endTool = createEndTraceTool(serviceStub)
  const endResult = await endTool.handler({ traceId: 't'.repeat(200), outcome: 'completed' })
  assert.equal(endResult.isError, true)

  const trailTool = createGetAuditTrailTool(serviceStub)
  const trailResult = await trailTool.handler({ traceId: 't'.repeat(200) })
  assert.equal(trailResult.isError, true)

  const exportTool = createExportReportTool([])
  const exportResult = await exportTool.handler({ traceId: 't'.repeat(200) })
  assert.equal(exportResult.isError, true)
})
