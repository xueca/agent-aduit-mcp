import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_CONFIG } from '../src/config/defaults.js'
import type { AgentAuditConfig } from '../src/config/schema.js'
import { TraceStore } from '../src/storage/trace-store.js'
import type { IWriter } from '../src/writers/interface.js'
import type { McpNotifier } from '../src/notifications/mcp-notifier.js'
import { AuditService } from '../src/core/audit-service.js'
import { AUDIT_ERROR_CODES, AuditError } from '../src/errors/audit-error.js'
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

class AlwaysFailWriter implements IWriter {
  fail = true
  written: unknown[][] = []

  async initialize(): Promise<void> {}

  async write(events: unknown[]): Promise<void> {
    if (this.fail) {
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

test('writer 持续失败：重试耗尽后抛 WRITE_FAILED 且批次回填不丢', async () => {
  const config = makeConfig({ flush: { intervalMs: 5000, sizeThreshold: 1, retry: { maxAttempts: 3, baseDelayMs: 1, backoffFactor: 3 } } })
  const store = new TraceStore({ maxBufferSize: 100 })
  const writer = new AlwaysFailWriter()
  const service = new AuditService({ config, store, writer })
  await service.initialize()
  const session = store.startTrace({ agentName: 'codex', taskIntent: 'fix bug' })
  await assert.rejects(service.recordEvent({ traceId: session.traceId, phase: 'REASONING', message: 'a' }), (error) => error instanceof AuditError && error.code === AUDIT_ERROR_CODES.WRITE_FAILED)
  writer.fail = false
  await service.shutdown()
  assert.equal(writer.written.reduce((sum, batch) => sum + batch.length, 0), 1)
})

test('pending 队列超限抛 AUDIT_PENDING_OVERFLOW', async () => {
  const config = makeConfig({ flush: { intervalMs: 5000, sizeThreshold: 100, pendingLimit: 2 } })
  const store = new TraceStore({ maxBufferSize: 100 })
  const writer = new FakeWriter()
  const service = new AuditService({ config, store, writer })
  await service.initialize()
  const session = store.startTrace({ agentName: 'codex', taskIntent: 'fix bug' })
  await service.recordEvent({ traceId: session.traceId, phase: 'REASONING', message: 'a' })
  await service.recordEvent({ traceId: session.traceId, phase: 'REASONING', message: 'b' })
  await assert.rejects(service.recordEvent({ traceId: session.traceId, phase: 'REASONING', message: 'c' }), (error) => error instanceof AuditError && error.code === 'AUDIT_PENDING_OVERFLOW')
  await service.shutdown()
})

test('buildEvent 递归脱敏且循环引用输出 [Circular]', async () => {
  const config = makeConfig({ redaction: { fields: ['apiKey', 'token', 'password', 'secret', 'stack'] } })
  const store = new TraceStore({ maxBufferSize: 100 })
  const writer = new FakeWriter()
  const service = new AuditService({ config, store, writer })
  await service.initialize()
  const session = store.startTrace({ agentName: 'codex', taskIntent: 'fix bug' })
  const meta: Record<string, unknown> = { apiKey: 'secret-1', nested: { Token: 'secret-2', keep: 'visible' }, count: 3 }
  meta.self = meta
  const event = await service.recordEvent({ traceId: session.traceId, phase: 'EXECUTION', message: 'run', metadata: meta, error: { code: 'E1', message: 'boom', stack: 'at x' } })
  const nested = event.metadata.nested as Record<string, unknown>
  assert.equal(event.metadata.apiKey, '[REDACTED]')
  assert.equal(nested.Token, '[REDACTED]')
  assert.equal(nested.keep, 'visible')
  assert.equal(event.metadata.self, '[Circular]')
  assert.equal(event.error?.stack, '[REDACTED]')
  await service.shutdown()
})
