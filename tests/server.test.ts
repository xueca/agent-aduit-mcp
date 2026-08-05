// 集成测试：MCP 工具注册、全链路、通知、错误处理与 JSONL 落盘
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { LoggingMessageNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import {
  callToolOk,
  cleanup,
  dateKey,
  readText,
  setup,
  UUID_V7_PATTERN,
  waitFor
} from './server-helpers.js'
import type { TestContext } from './server-helpers.js'

async function startTrace(ctx: TestContext, taskIntent: string): Promise<string> {
  const start = await callToolOk(ctx, 'audit_start_trace', {
    agentName: 'code-guardian',
    taskIntent
  })
  assert.equal(start.ok, true)
  assert.equal(start.status, 'active')
  assert.equal(typeof start.traceId, 'string')
  const traceId = start.traceId as string
  assert.equal(start.agentName, 'code-guardian')
  assert.equal(start.taskIntent, taskIntent)
  assert.equal(typeof start.startTime, 'string')
  return traceId
}

async function recordEvent(ctx: TestContext, traceId: string, phase: string, message: string) {
  const record = await callToolOk(ctx, 'audit_record_event', {
    traceId,
    phase,
    level: 'info',
    message
  })
  assert.equal(record.ok, true)
  assert.match(record.eventId as string, UUID_V7_PATTERN)
  assert.equal(record.traceId, traceId)
  assert.equal(record.phase, phase)
  assert.equal(record.level, 'info')
  return record
}

test('listTools 返回 5 个审计工具', async (t) => {
  const ctx = await setup()
  t.after(() => cleanup(ctx))
  const result = await ctx.client.listTools()
  const names = result.tools.map((tool) => tool.name)
  assert.deepEqual(names, [
    'audit_start_trace',
    'audit_record_event',
    'audit_end_trace',
    'audit_get_trail',
    'audit_export_report'
  ])
})

test('全链路 start -> record -> get -> end', async (t) => {
  const ctx = await setup()
  t.after(() => cleanup(ctx))
  const traceId = await startTrace(ctx, '修复D1')
  await recordEvent(ctx, traceId, 'EXECUTION', '执行修复')
  const trail = await callToolOk(ctx, 'audit_get_trail', { traceId })
  assert.equal(trail.ok, true)
  assert.equal(trail.traceId, traceId)
  const events = trail.events as Array<Record<string, unknown>>
  assert.equal(events.length, 1)
  const event = events[0]
  assert.equal(event.phase, 'EXECUTION')
  const end = await callToolOk(ctx, 'audit_end_trace', { traceId, outcome: 'completed' })
  assert.equal(end.ok, true)
  assert.equal(end.status, 'completed')
  assert.equal(end.eventCount, 1)
  assert.equal(typeof end.endTime, 'string')
  const durationMs = end.durationMs as number
  assert.ok(durationMs >= 0)
})

test('DECISION 事件触发 notifications/message 通知', async (t) => {
  const ctx = await setup()
  t.after(() => cleanup(ctx))
  const notifications: Array<Record<string, unknown>> = []
  ctx.client.setNotificationHandler(LoggingMessageNotificationSchema, (notification) => {
    notifications.push(notification as unknown as Record<string, unknown>)
  })
  const traceId = await startTrace(ctx, '决策测试')
  const record = await recordEvent(ctx, traceId, 'DECISION', '提交决策')
  await waitFor(() => notifications.length >= 1)
  assert.equal(notifications.length, 1)
  const notification = notifications[0]
  const params = notification.params as Record<string, unknown>
  const data = params.data as Record<string, unknown>
  assert.equal(data.traceId, traceId)
  assert.equal(data.eventId, record.eventId)
  assert.equal(data.phase, 'DECISION')
})

test('record_event 到未知 traceId 返回 isError', async (t) => {
  const ctx = await setup()
  t.after(() => cleanup(ctx))
  const result = await ctx.client.callTool({
    name: 'audit_record_event',
    arguments: { traceId: 'unknown-trace', phase: 'EXECUTION', message: 'x' }
  })
  assert.ok('content' in result)
  assert.equal(result.isError, true)
  assert.ok(readText(result).includes('AUDIT_TRACE_NOT_FOUND'))
})

test('非法 phase 返回 isError', async (t) => {
  const ctx = await setup()
  t.after(() => cleanup(ctx))
  const result = await ctx.client.callTool({
    name: 'audit_record_event',
    arguments: { traceId: 't', phase: 'FOO', message: 'x' }
  })
  assert.ok('content' in result)
  assert.equal(result.isError, true)
})

test('end_trace 后 JSONL 文件行数等于事件数', async (t) => {
  const ctx = await setup()
  t.after(() => cleanup(ctx))
  const traceId = await startTrace(ctx, '文件写入验证')
  await recordEvent(ctx, traceId, 'REASONING', '分析原因')
  await recordEvent(ctx, traceId, 'VERIFICATION', '验证通过')
  await callToolOk(ctx, 'audit_end_trace', { traceId, outcome: 'completed' })
  const filePath = path.join(ctx.dir, `audit-${dateKey(new Date())}.jsonl`)
  const content = await fs.readFile(filePath, 'utf8')
  const rawLines = content.split('\n')
  const lines = rawLines.filter((line) => line.length > 0)
  assert.equal(lines.length, 2)
})