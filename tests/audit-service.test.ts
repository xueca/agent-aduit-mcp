import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_CONFIG } from '../src/config/defaults.js'
import type { AgentAuditConfig } from '../src/config/schema.js'
import { TraceStore } from '../src/storage/trace-store.js'
import type { IWriter } from '../src/writers/interface.js'
import { AuditService } from '../src/core/audit-service.js'

const UUID_V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

class FakeWriter implements IWriter {
  written: unknown[][] = []
  failNext = false

  async initialize(): Promise<void> {}

  async write(events: unknown[]): Promise<void> {
    if (this.failNext) {
      this.failNext = false
      throw new Error('disk full')
    }
    this.written.push([...events])
  }

  async flush(): Promise<void> {}

  async healthCheck(): Promise<boolean> {
    return true
  }

  async shutdown(): Promise<void> {}
}

function makeConfig(overrides: Partial<AgentAuditConfig> = {}): AgentAuditConfig {
  const config = structuredClone(DEFAULT_CONFIG)
  return {
    ...config,
    ...overrides,
    buffer: { ...config.buffer, ...overrides.buffer },
    flush: { ...config.flush, ...overrides.flush },
    redaction: { ...config.redaction, ...overrides.redaction },
    notifications: { ...config.notifications, ...overrides.notifications }
  }
}

test('recordEvent 补齐字段与默认值', async () => {
  const config = makeConfig()
  const store = new TraceStore({ maxBufferSize: 100 })
  const writer = new FakeWriter()
  const service = new AuditService({ config, store, writer })
  await service.initialize()
  const session = store.startTrace({ agentName: 'codex', taskIntent: 'fix bug' })
  const event = await service.recordEvent({ traceId: session.traceId, phase: 'REASONING', message: 'step1' })
  assert.match(event.eventId, UUID_V7_RE)
  assert.match(event.timestamp, ISO_RE)
  assert.equal(event.level, 'info')
  assert.deepEqual(event.metadata, {})
  await service.shutdown()
})

test('达到 sizeThreshold 立即写一批', async () => {
  const config = makeConfig({ flush: { intervalMs: 5000, sizeThreshold: 2 } })
  const store = new TraceStore({ maxBufferSize: 100 })
  const writer = new FakeWriter()
  const service = new AuditService({ config, store, writer })
  await service.initialize()
  const session = store.startTrace({ agentName: 'codex', taskIntent: 'fix bug' })
  await service.recordEvent({ traceId: session.traceId, phase: 'REASONING', message: 'a' })
  assert.equal(writer.written.length, 0)
  await service.recordEvent({ traceId: session.traceId, phase: 'REASONING', message: 'b' })
  assert.equal(writer.written.length, 1)
  assert.equal(writer.written[0].length, 2)
  await service.shutdown()
})

test('endTrace 与 shutdown 都会落盘剩余事件', async () => {
  const store = new TraceStore({ maxBufferSize: 100 })
  const writer = new FakeWriter()
  const service = new AuditService({ config: makeConfig(), store, writer })
  await service.initialize()
  const session = store.startTrace({ agentName: 'codex', taskIntent: 'fix bug' })
  await service.recordEvent({ traceId: session.traceId, phase: 'REASONING', message: 'a' })
  await service.endTrace({ traceId: session.traceId, outcome: 'completed' })
  assert.equal(writer.written.length, 1)
  await service.shutdown()

  const store2 = new TraceStore({ maxBufferSize: 100 })
  const writer2 = new FakeWriter()
  const service2 = new AuditService({ config: makeConfig(), store: store2, writer: writer2 })
  await service2.initialize()
  const session2 = store2.startTrace({ agentName: 'codex', taskIntent: 'fix bug' })
  await service2.recordEvent({ traceId: session2.traceId, phase: 'REASONING', message: 'a' })
  await service2.shutdown()
  assert.equal(writer2.written.length, 1)
})
test('writer 抛错时 warnSink 收到且不抛出', async () => {
  const warnings: string[] = []
  const config = makeConfig({ flush: { intervalMs: 5000, sizeThreshold: 1 } })
  const store = new TraceStore({ maxBufferSize: 100 })
  const writer = new FakeWriter()
  writer.failNext = true
  const service = new AuditService({
    config,
    store,
    writer,
    warnSink: (line) => warnings.push(line)
  })
  await service.initialize()
  const session = store.startTrace({ agentName: 'codex', taskIntent: 'fix bug' })
  await service.recordEvent({ traceId: session.traceId, phase: 'REASONING', message: 'a' })
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /写入失败/)
  await service.shutdown()
})
test('startTrace 带 context 记录 INPUT_SNAPSHOT', async () => {
  const config = makeConfig()
  const store = new TraceStore({ maxBufferSize: 100 })
  const writer = new FakeWriter()
  const service = new AuditService({ config, store, writer })
  await service.initialize()
  const session = await service.startTrace({ agentName: 'codex', taskIntent: 'fix bug', context: 'snapshot-1' })
  const trail = await service.getTrail({ traceId: session.traceId })
  assert.equal(trail.events.length, 1)
  assert.equal(trail.events[0].phase, 'INPUT_SNAPSHOT')
  assert.equal(trail.events[0].message, 'snapshot-1')
  await service.shutdown()
})
test('getTrail 支持 phase/level/limit 过滤', async () => {
  const config = makeConfig()
  const store = new TraceStore({ maxBufferSize: 100 })
  const writer = new FakeWriter()
  const service = new AuditService({ config, store, writer })
  await service.initialize()
  const session = store.startTrace({ agentName: 'codex', taskIntent: 'fix bug' })
  await service.recordEvent({ traceId: session.traceId, phase: 'REASONING', level: 'debug', message: 'r1' })
  await service.recordEvent({ traceId: session.traceId, phase: 'DECISION', message: 'd1' })
  await service.recordEvent({ traceId: session.traceId, phase: 'EXECUTION', level: 'warn', message: 'e1' })
  const byPhase = await service.getTrail({ traceId: session.traceId, phase: 'DECISION' })
  assert.equal(byPhase.events.length, 1)
  assert.equal(byPhase.events[0].message, 'd1')
  const byLevel = await service.getTrail({ traceId: session.traceId, level: 'warn' })
  assert.equal(byLevel.events.length, 1)
  assert.equal(byLevel.events[0].message, 'e1')
  const limited = await service.getTrail({ traceId: session.traceId, limit: 2 })
  assert.equal(limited.events.length, 2)
  assert.equal(limited.events[0].message, 'd1')
  assert.equal(limited.events[1].message, 'e1')
  await service.shutdown()
})