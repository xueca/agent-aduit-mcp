// trace 存储：Map + RingBuffer，trace 生命周期管理
import { RingBuffer } from '../buffer/ring-buffer.js'
import { uuidV7 } from '../utils/id.js'
import { nowIso } from '../utils/time.js'
import { AUDIT_ERROR_CODES, AuditError } from '../errors/audit-error.js'
import type { AgentLogEvent, TraceSession } from '../models/index.js'

interface TraceEntry {
  session: TraceSession
  buffer: RingBuffer<AgentLogEvent>
}

export class TraceStore {
  private readonly maxBufferSize: number
  private readonly traces = new Map<string, TraceEntry>()

  constructor(options: { maxBufferSize: number }) {
    const { maxBufferSize } = options
    this.maxBufferSize = maxBufferSize > 0 ? maxBufferSize : 1000
  }

  startTrace(input: { agentName: string; taskIntent: string }): TraceSession {
    const { agentName, taskIntent } = input
    const session: TraceSession = {
      traceId: uuidV7(),
      agentName,
      taskIntent,
      startTime: nowIso(),
      status: 'active',
      eventCount: 0
    }
    this.traces.set(session.traceId, {
      session,
      buffer: new RingBuffer<AgentLogEvent>({ maxSize: this.maxBufferSize })
    })
    return session
  }

  getSession(traceId: string): TraceSession | undefined {
    return this.traces.get(traceId)?.session
  }

  appendEvent(traceId: string, event: AgentLogEvent): void {
    const entry = this.traces.get(traceId)
    if (entry === undefined) {
      throw new AuditError(AUDIT_ERROR_CODES.TRACE_NOT_FOUND, `trace 不存在: ${traceId}`)
    }
    if (entry.session.status !== 'active') {
      throw new AuditError(AUDIT_ERROR_CODES.TRACE_CLOSED, `trace 已结束: ${traceId}`)
    }
    entry.buffer.push(event)
    entry.session.eventCount += 1
  }

  endTrace(traceId: string, status: 'completed' | 'failed'): TraceSession {
    const entry = this.traces.get(traceId)
    if (entry === undefined) {
      throw new AuditError(AUDIT_ERROR_CODES.TRACE_NOT_FOUND, `trace 不存在: ${traceId}`)
    }
    if (entry.session.status !== 'active') {
      throw new AuditError(AUDIT_ERROR_CODES.TRACE_CLOSED, `trace 已结束: ${traceId}`)
    }
    entry.session.status = status
    entry.session.endTime = nowIso()
    return entry.session
  }

  getTrail(traceId: string): { session: TraceSession; events: AgentLogEvent[] } {
    const entry = this.traces.get(traceId)
    if (entry === undefined) {
      throw new AuditError(AUDIT_ERROR_CODES.TRACE_NOT_FOUND, `trace 不存在: ${traceId}`)
    }
    return { session: entry.session, events: entry.buffer.toArray() }
  }
}