// 单元测试：audit_export_report 报告导出（按 eventId / traceId，含分片文件与错误场景）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { AgentEventMetadata, AgentLogEvent, EventPhase } from '../src/models/event.js'
import { createExportReportTool } from '../src/tools/export-report.js'

const TRACE_ID = 'trace-export-001'
function makeEvent(input: { eventId: string; phase: EventPhase; message: string; timestamp: string; metadata?: AgentEventMetadata }): AgentLogEvent {
  return { eventId: input.eventId, traceId: TRACE_ID, timestamp: input.timestamp, phase: input.phase, level: 'info', message: input.message, metadata: input.metadata ?? {} }
}

async function writeEvents(dir: string, fileName: string, events: AgentLogEvent[]): Promise<void> {
  const lines = events.map((event) => JSON.stringify(event))
  await fs.writeFile(path.join(dir, fileName), lines.join('\n') + '\n', 'utf8')
}

function parseResult(result: CallToolResult): Record<string, unknown> {
  const content = result.content[0]
  if (content === undefined || content.type !== 'text') {
    throw new Error('工具响应不是 text 类型')
  }
  return JSON.parse(content.text ?? '') as Record<string, unknown>
}

test('按 eventId 导出单事件报告', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-export-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const inputEvent = makeEvent({ eventId: 'evt-1', phase: 'INPUT_SNAPSHOT', message: '输入快照', timestamp: '2026-08-04T01:00:00.000Z' })
  const execEvent = makeEvent({ eventId: 'evt-2', phase: 'EXECUTION', message: '执行修复', timestamp: '2026-08-04T01:00:01.000Z', metadata: { toolName: 'report-test' } })
  const verifyEvent = makeEvent({ eventId: 'evt-3', phase: 'VERIFICATION', message: '验证通过', timestamp: '2026-08-04T01:00:02.000Z' })
  await writeEvents(dir, 'audit-2026-08-04.jsonl', [inputEvent, execEvent, verifyEvent])
  const tool = createExportReportTool([dir])
  const result = await tool.handler({ eventId: 'evt-2' })
  const body = parseResult(result)
  assert.equal(body.ok, true)
  const report = body.report as string
  assert.ok(report.includes('执行修复'))
  assert.ok(report.includes('evt-2'))
  assert.ok(report.includes('"toolName":"report-test"'))
  assert.ok(!report.includes('输入快照'))
  assert.ok(!report.includes('验证通过'))
})

test('按 traceId 导出时间线报告', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-export-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const events = [
    makeEvent({ eventId: 'evt-1', phase: 'INPUT_SNAPSHOT', message: '输入快照', timestamp: '2026-08-04T01:00:00.000Z' }),
    makeEvent({ eventId: 'evt-2', phase: 'EXECUTION', message: '执行修复', timestamp: '2026-08-04T01:00:01.000Z' }),
    makeEvent({ eventId: 'evt-3', phase: 'VERIFICATION', message: '验证通过', timestamp: '2026-08-04T01:00:02.000Z' })
  ]
  await writeEvents(dir, 'audit-2026-08-04.jsonl', events)
  const tool = createExportReportTool([dir])
  const result = await tool.handler({ traceId: TRACE_ID })
  const body = parseResult(result)
  assert.equal(body.ok, true)
  const report = body.report as string
  assert.ok(report.includes('**事件总数**: 3'))
  assert.ok(report.includes(TRACE_ID))
  assert.ok(report.includes('INPUT_SNAPSHOT'))
  assert.ok(report.includes('VERIFICATION'))
  assert.ok(report.indexOf('INPUT_SNAPSHOT') < report.indexOf('VERIFICATION'))
})

test('分片文件中的事件可按 traceId 扫到', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-export-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const shardEvent = makeEvent({ eventId: 'evt-shard-1', phase: 'REASONING', message: '分片分析', timestamp: '2026-08-04T02:00:00.000Z' })
  await writeEvents(dir, 'audit-2026-08-04.1.jsonl', [shardEvent])
  const tool = createExportReportTool([dir])
  const result = await tool.handler({ traceId: TRACE_ID })
  const body = parseResult(result)
  assert.equal(body.ok, true)
  const report = body.report as string
  assert.ok(report.includes('REASONING'))
  assert.ok(report.includes('分片分析'))
})

test('eventId 未命中但 traceId 命中时回退时间线报告', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-export-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const events = [
    makeEvent({ eventId: 'evt-a', phase: 'INPUT_SNAPSHOT', message: '输入快照A', timestamp: '2026-08-04T03:00:00.000Z' }),
    makeEvent({ eventId: 'evt-b', phase: 'EXECUTION', message: '执行修复B', timestamp: '2026-08-04T03:00:01.000Z' })
  ]
  await writeEvents(dir, 'audit-2026-08-04.jsonl', events)
  const tool = createExportReportTool([dir])
  const result = await tool.handler({ eventId: 'evt-不存在', traceId: TRACE_ID })
  const body = parseResult(result)
  assert.equal(body.ok, true)
  const report = body.report as string
  assert.ok(report.includes('执行修复B'))
  assert.ok(report.includes('**事件总数**: 2'))
})

test('不存在的 traceId 返回 AUDIT_NOT_FOUND', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-export-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const event = makeEvent({ eventId: 'evt-1', phase: 'INPUT_SNAPSHOT', message: '输入快照', timestamp: '2026-08-04T01:00:00.000Z' })
  await writeEvents(dir, 'audit-2026-08-04.jsonl', [event])
  const tool = createExportReportTool([dir])
  const result = await tool.handler({ traceId: 'trace-missing' })
  assert.equal(result.isError, true)
  const body = parseResult(result)
  assert.equal(body.code, 'AUDIT_NOT_FOUND')
})


test('eventId 在多个文件中出现时返回最新文件的事件', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-export-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const oldEvent = makeEvent({ eventId: 'evt-dup', phase: 'EXECUTION', message: '旧文件事件', timestamp: '2026-08-03T01:00:00.000Z' })
  const newEvent = makeEvent({ eventId: 'evt-dup', phase: 'VERIFICATION', message: '新文件事件', timestamp: '2026-08-04T01:00:00.000Z' })
  await writeEvents(dir, 'audit-2026-08-03.jsonl', [oldEvent])
  await writeEvents(dir, 'audit-2026-08-04.jsonl', [newEvent])
  const tool = createExportReportTool([dir])
  const result = await tool.handler({ eventId: 'evt-dup' })
  const body = parseResult(result)
  assert.equal(body.ok, true)
  const report = body.report as string
  assert.ok(report.includes('新文件事件'))
  assert.ok(!report.includes('旧文件事件'))
})
test('eventId 与 traceId 都未提供返回 AUDIT_INVALID_EVENT', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-export-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const tool = createExportReportTool([dir])
  const result = await tool.handler({})
  assert.equal(result.isError, true)
  const body = parseResult(result)
  assert.equal(body.code, 'AUDIT_INVALID_EVENT')
})

test('大文件流式导出不 OOM（2 万条事件）', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-export-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const events: AgentLogEvent[] = []
  for (let i = 0; i < 20000; i += 1) {
    events.push(makeEvent({ eventId: 'evt-' + i, phase: 'EXECUTION', message: '事件' + i, timestamp: '2026-08-04T01:00:00.000Z' }))
  }
  await writeEvents(dir, 'audit-2026-08-04.jsonl', events)
  const tool = createExportReportTool([dir])
  const result = await tool.handler({ traceId: TRACE_ID })
  const body = parseResult(result)
  assert.equal(body.ok, true)
  const report = body.report as string
  assert.ok(report.includes('**事件总数**: 20000'))
})
