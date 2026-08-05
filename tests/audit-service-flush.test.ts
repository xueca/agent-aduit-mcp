import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_CONFIG } from '../src/config/defaults.js'
import type { AgentAuditConfig } from '../src/config/schema.js'
import { TraceStore } from '../src/storage/trace-store.js'
import type { IWriter } from '../src/writers/interface.js'
import type { McpNotifier } from '../src/notifications/mcp-notifier.js'
import { AuditService } from '../src/core/audit-service.js'
import type { AgentLogEvent } from '../src/models/event.js'

class FakeWriter implements IWriter {
  written: unknown[][] = []

  async initialize(): Promise<void> {}

  async write(events: unknown[]): Promise<void> {
    this.written.push([...events])
  }

  async flush(): Promise<void> {}

  async healthCheck(): Promise<boolean> {
    return true
  }

  async shutdown(): Promise<void> {}
}

class FakeNotifier {
  notifyCount = 0

  shouldNotify(_event: AgentLogEvent): boolean {
    return true
  }

  async notify(_event: AgentLogEvent): Promise<void> {
    this.notifyCount += 1
  }
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

test('DECISION 事件触发 notifier', async () => {
  const rawNotifier = new FakeNotifier()
  const notifier = rawNotifier as unknown as McpNotifier
  const config = makeConfig()
  const store = new TraceStore({ maxBufferSize: 100 })
  const writer = new FakeWriter()
  const service = new AuditService({ config, store, writer, notifier })
  await service.initialize()
  const session = store.startTrace({ agentName: 'codex', taskIntent: 'fix bug' })
  await service.recordEvent({ traceId: session.traceId, phase: 'DECISION', message: 'pick plan' })
  assert.equal(rawNotifier.notifyCount, 1)
  await service.shutdown()
})

test('warn 级别事件触发 warnSink', async () => {
  const warnings: string[] = []
  const config = makeConfig()
  const store = new TraceStore({ maxBufferSize: 100 })
  const writer = new FakeWriter()
  const service = new AuditService({
    config,
    store,
    writer,
    warnSink: (line) => warnings.push(line)
  })
  await service.initialize()
  const session = store.startTrace({ agentName: 'codex', taskIntent: 'fix bug' })
  await service.recordEvent({ traceId: session.traceId, phase: 'EXECUTION', level: 'warn', message: 'boom' })
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /\[agent-audit\] warn EXECUTION boom/)
  await service.shutdown()
})

test('到达 flush 间隔自动落盘', async () => {
  mock.timers.enable({ apis: ['setInterval'] })
  try {
    const config = makeConfig({ flush: { intervalMs: 5000, sizeThreshold: 1000 } })
    const store = new TraceStore({ maxBufferSize: 100 })
    const writer = new FakeWriter()
    const service = new AuditService({ config, store, writer })
    await service.initialize()
    const session = store.startTrace({ agentName: 'codex', taskIntent: 'fix bug' })
    await service.recordEvent({ traceId: session.traceId, phase: 'REASONING', message: 'a' })
    assert.equal(writer.written.length, 0)
    mock.timers.tick(5000)
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(writer.written.length, 1)
    await service.shutdown()
  } finally {
    mock.timers.reset()
  }
})