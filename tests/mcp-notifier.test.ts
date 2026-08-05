import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { McpNotifier } from '../src/notifications/mcp-notifier.js'
import type { AgentLogEvent, EventPhase, Level } from '../src/models/event.js'

class FakeServer {
  notifications: unknown[] = []

  async notification(message: unknown): Promise<void> {
    this.notifications.push(message)
  }
}

class ThrowingServer {
  async notification(): Promise<void> {
    throw new Error('mcp gone')
  }
}

function makeEvent(phase: EventPhase, level: Level): AgentLogEvent {
  return {
    eventId: 'evt-1',
    traceId: 'trace-1',
    timestamp: '2026-08-04T10:00:00.000Z',
    phase,
    level,
    message: 'hello',
    metadata: {}
  }
}

test('shouldNotify 判定矩阵', () => {
  const fakeServer = new FakeServer() as unknown as Server
  const cases = [
    { phase: 'DECISION', level: 'debug', minLevel: 'warn', expected: true },
    { phase: 'REASONING', level: 'info', minLevel: 'warn', expected: false },
    { phase: 'REASONING', level: 'warn', minLevel: 'warn', expected: true },
    { phase: 'REASONING', level: 'error', minLevel: 'warn', expected: true }
  ]
  for (const item of cases) {
    const notifier = new McpNotifier({
      server: fakeServer,
      enabled: true,
      minLevel: item.minLevel as Level
    })
    const event = makeEvent(item.phase as EventPhase, item.level as Level)
    assert.equal(notifier.shouldNotify(event), item.expected)
  }
})

test('enabled 为 false 时全部不通知', () => {
  const fakeServer = new FakeServer() as unknown as Server
  const notifier = new McpNotifier({ server: fakeServer, enabled: false, minLevel: 'warn' })
  const event = makeEvent('DECISION', 'debug')
  assert.equal(notifier.shouldNotify(event), false)
})

test('notify 发送 notifications/message 且 level 映射正确', async () => {
  const rawServer = new FakeServer()
  const fakeServer = rawServer as unknown as Server
  const notifier = new McpNotifier({ server: fakeServer, enabled: true, minLevel: 'warn' })
  const event = makeEvent('REASONING', 'warn')
  await notifier.notify(event)
  assert.equal(rawServer.notifications.length, 1)
  const message = rawServer.notifications[0] as {
    method: string
    params: { level: string; data: Record<string, unknown> }
  }
  assert.equal(message.method, 'notifications/message')
  assert.equal(message.params.level, 'warning')
  assert.equal(message.params.data.traceId, 'trace-1')
  assert.equal(message.params.data.eventId, 'evt-1')
  assert.equal(message.params.data.phase, 'REASONING')
  assert.equal(message.params.data.level, 'warn')
  assert.equal(message.params.data.message, 'hello')
})

test('notification 抛错时 notify 不抛出', async () => {
  const throwingServer = new ThrowingServer() as unknown as Server
  const notifier = new McpNotifier({ server: throwingServer, enabled: true, minLevel: 'warn' })
  const event = makeEvent('REASONING', 'error')
  await notifier.notify(event)
  assert.equal(notifier.shouldNotify(event), true)
})