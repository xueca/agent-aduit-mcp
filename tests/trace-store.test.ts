import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TraceStore } from '../src/storage/trace-store.js'
import { AUDIT_ERROR_CODES, AuditError } from '../src/errors/audit-error.js'
import type { AgentLogEvent } from '../src/models/event.js'

const UUID_V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

function makeEvent(traceId: string, message: string): AgentLogEvent {
  return {
    eventId: `evt-${message}`,
    traceId,
    timestamp: '2026-08-04T10:00:00.000Z',
    phase: 'REASONING',
    level: 'info',
    message,
    metadata: {}
  }
}

test('startTrace 返回 v7 uuid、ISO 时间与初始计数', () => {
  const store = new TraceStore({ maxBufferSize: 10 })
  const session = store.startTrace({ agentName: 'codex', taskIntent: 'fix bug' })
  assert.match(session.traceId, UUID_V7_RE)
  assert.match(session.startTime, ISO_RE)
  assert.equal(session.status, 'active')
  assert.equal(session.eventCount, 0)
  assert.equal(session.agentName, 'codex')
  assert.equal(session.taskIntent, 'fix bug')
})

test('appendEvent 递增计数且 getTrail 按序返回', () => {
  const store = new TraceStore({ maxBufferSize: 10 })
  const session = store.startTrace({ agentName: 'codex', taskIntent: 'fix bug' })
  store.appendEvent(session.traceId, makeEvent(session.traceId, 'a'))
  store.appendEvent(session.traceId, makeEvent(session.traceId, 'b'))
  assert.equal(store.getSession(session.traceId)?.eventCount, 2)
  const trail = store.getTrail(session.traceId)
  assert.equal(trail.events.length, 2)
  assert.equal(trail.events[0].message, 'a')
  assert.equal(trail.events[1].message, 'b')
})

test('getSession 命中与未命中', () => {
  const store = new TraceStore({ maxBufferSize: 10 })
  const session = store.startTrace({ agentName: 'codex', taskIntent: 'fix bug' })
  assert.equal(store.getSession(session.traceId)?.traceId, session.traceId)
  assert.equal(store.getSession('missing'), undefined)
})

test('未知 trace 抛 TRACE_NOT_FOUND', () => {
  const store = new TraceStore({ maxBufferSize: 10 })
  assert.throws(() => store.appendEvent('missing', makeEvent('missing', 'a')), (error) => {
    assert.ok(error instanceof AuditError)
    assert.equal(error.code, AUDIT_ERROR_CODES.TRACE_NOT_FOUND)
    return true
  })
  assert.throws(() => store.endTrace('missing', 'completed'), (error) => {
    assert.ok(error instanceof AuditError)
    assert.equal(error.code, AUDIT_ERROR_CODES.TRACE_NOT_FOUND)
    return true
  })
})

test('endTrace 后 append 抛 TRACE_CLOSED，重复 endTrace 同样', () => {
  const store = new TraceStore({ maxBufferSize: 10 })
  const session = store.startTrace({ agentName: 'codex', taskIntent: 'fix bug' })
  const ended = store.endTrace(session.traceId, 'completed')
  assert.equal(ended.status, 'completed')
  assert.match(ended.endTime ?? '', ISO_RE)
  assert.throws(() => store.appendEvent(session.traceId, makeEvent(session.traceId, 'a')), (error) => {
    assert.ok(error instanceof AuditError)
    assert.equal(error.code, AUDIT_ERROR_CODES.TRACE_CLOSED)
    return true
  })
  assert.throws(() => store.endTrace(session.traceId, 'failed'), (error) => {
    assert.ok(error instanceof AuditError)
    assert.equal(error.code, AUDIT_ERROR_CODES.TRACE_CLOSED)
    return true
  })
})

test('endTrace 支持 failed 状态', () => {
  const store = new TraceStore({ maxBufferSize: 10 })
  const session = store.startTrace({ agentName: 'codex', taskIntent: 'fix bug' })
  const ended = store.endTrace(session.traceId, 'failed')
  assert.equal(ended.status, 'failed')
})

test('overflow 时 getTrail 只保留后 2 条', () => {
  const store = new TraceStore({ maxBufferSize: 2 })
  const session = store.startTrace({ agentName: 'codex', taskIntent: 'fix bug' })
  store.appendEvent(session.traceId, makeEvent(session.traceId, 'a'))
  store.appendEvent(session.traceId, makeEvent(session.traceId, 'b'))
  store.appendEvent(session.traceId, makeEvent(session.traceId, 'c'))
  const trail = store.getTrail(session.traceId)
  assert.equal(trail.events.length, 2)
  assert.equal(trail.events[0].message, 'b')
  assert.equal(trail.events[1].message, 'c')
  assert.equal(session.eventCount, 3)
})

test('getTrail 返回只读快照', () => {
  const store = new TraceStore({ maxBufferSize: 10 })
  const session = store.startTrace({ agentName: 'codex', taskIntent: 'fix bug' })
  store.appendEvent(session.traceId, makeEvent(session.traceId, 'a'))
  const first = store.getTrail(session.traceId)
  first.events.pop()
  const second = store.getTrail(session.traceId)
  assert.equal(second.events.length, 1)
})

test('maxTraces 超限时淘汰最老的 completed trace', () => {
  const store = new TraceStore({ maxBufferSize: 10, maxTraces: 2 })
  const t1 = store.startTrace({ agentName: 'a', taskIntent: '1' })
  const t2 = store.startTrace({ agentName: 'a', taskIntent: '2' })
  const t3 = store.startTrace({ agentName: 'a', taskIntent: '3' })
  store.endTrace(t1.traceId, 'completed')
  store.endTrace(t2.traceId, 'completed')
  store.endTrace(t3.traceId, 'completed')
  const t4 = store.startTrace({ agentName: 'a', taskIntent: '4' })
  assert.equal(store.getSession(t1.traceId), undefined)
  assert.equal(store.getSession(t2.traceId), undefined)
  assert.equal(store.getSession(t3.traceId)?.traceId, t3.traceId)
  assert.equal(store.getSession(t4.traceId)?.traceId, t4.traceId)
})

test('traceTtlMs 过期后 completed trace 被淘汰', async () => {
  const store = new TraceStore({ maxBufferSize: 10, maxTraces: 10, traceTtlMs: 10 })
  const t1 = store.startTrace({ agentName: 'a', taskIntent: '1' })
  store.endTrace(t1.traceId, 'completed')
  await new Promise((resolve) => setTimeout(resolve, 30))
  store.startTrace({ agentName: 'a', taskIntent: '2' })
  assert.equal(store.getSession(t1.traceId), undefined)
})
