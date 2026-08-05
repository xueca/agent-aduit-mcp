import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AgentLogEventSchema, LevelSchema, levelRank } from '../src/models/event.js'
import { BlueprintRecordSchema } from '../src/models/blueprint.js'
import { TraceSessionSchema } from '../src/models/session.js'

test('AgentLogEventSchema parses a valid event', () => {
  const input = {
    eventId: 'evt-1',
    traceId: 'trace-1',
    parentEventId: 'parent-1',
    timestamp: '2026-08-04T10:00:00.000Z',
    phase: 'REASONING',
    level: 'info',
    message: 'agent is reasoning',
    metadata: { attempt: 2 },
    error: {
      code: 'E1',
      message: 'boom'
    }
  }
  const result = AgentLogEventSchema.safeParse(input)
  assert.equal(result.success, true)
  if (result.success) {
    const data = result.data
    assert.equal(data.eventId, 'evt-1')
    assert.equal(data.phase, 'REASONING')
  }
})

test('AgentLogEventSchema rejects missing required fields', () => {
  const result = AgentLogEventSchema.safeParse({})
  assert.equal(result.success, false)
})

test('AgentLogEventSchema rejects invalid phase', () => {
  const input = {
    eventId: 'evt-1',
    traceId: 'trace-1',
    timestamp: '2026-08-04T10:00:00.000Z',
    phase: 'GUESSING',
    level: 'info',
    message: 'x',
    metadata: {}
  }
  const result = AgentLogEventSchema.safeParse(input)
  assert.equal(result.success, false)
})

test('TraceSessionSchema parses a valid session', () => {
  const input = {
    traceId: 'trace-1',
    agentName: 'codex',
    taskIntent: 'fix the bug',
    startTime: '2026-08-04T10:00:00.000Z',
    status: 'active',
    eventCount: 5
  }
  const result = TraceSessionSchema.safeParse(input)
  assert.equal(result.success, true)
  if (result.success) {
    const data = result.data
    assert.equal(data.agentName, 'codex')
  }
})

test('TraceSessionSchema rejects missing required fields', () => {
  const result = TraceSessionSchema.safeParse({ traceId: 'trace-1' })
  assert.equal(result.success, false)
})

test('BlueprintRecordSchema parses a valid blueprint', () => {
  const input = {
    blueprintId: 'bp-1',
    traceId: 'trace-1',
    defectId: 'defect-1',
    layer: 'MODEL',
    understanding: 'clear',
    changeScope: ['a.ts'],
    affectedModules: ['a.ts'],
    risks: [],
    verificationPaths: ['tests/a.test.ts'],
    expectedEvents: ['evt-1']
  }
  const result = BlueprintRecordSchema.safeParse(input)
  assert.equal(result.success, true)
  if (result.success) {
    const data = result.data
    assert.equal(data.changeScope.length, 1)
  }
})

test('BlueprintRecordSchema fills missing arrays by default', () => {
  const input = {
    blueprintId: 'bp-1',
    traceId: 'trace-1',
    defectId: 'defect-1',
    layer: 'MODEL',
    understanding: 'clear'
  }
  const result = BlueprintRecordSchema.safeParse(input)
  assert.equal(result.success, true)
  if (result.success) {
    const data = result.data
    assert.deepEqual(data.changeScope, [])
    assert.deepEqual(data.expectedEvents, [])
  }
})

test('BlueprintRecordSchema rejects missing required fields', () => {
  const result = BlueprintRecordSchema.safeParse({ blueprintId: 'bp-1' })
  assert.equal(result.success, false)
})
test('LevelSchema accepts four levels and rejects others', () => {
  const levels = ['debug', 'info', 'warn', 'error']
  for (const level of levels) {
    const result = LevelSchema.safeParse(level)
    assert.equal(result.success, true)
  }
  const invalid = LevelSchema.safeParse('verbose')
  assert.equal(invalid.success, false)
})

test('levelRank follows debug < info < warn < error', () => {
  assert.equal(levelRank('debug'), 0)
  assert.equal(levelRank('info'), 1)
  assert.equal(levelRank('warn'), 2)
  assert.equal(levelRank('error'), 3)
})