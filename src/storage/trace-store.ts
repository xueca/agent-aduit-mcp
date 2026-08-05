// trace 存储：Map + RingBuffer，trace 生命周期管理与淘汰
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
  private readonly maxTraces: number
  private readonly traceTtlMs: number | undefined
  private readonly traces = new Map<string, TraceEntry>()

  constructor(options: { maxBufferSize: number; maxTraces?: number; traceTtlMs?: number }) {
    const { maxBufferSize, maxTraces = 1000, traceTtlMs } = options
    this.maxBufferSize = maxBufferSize > 0 ? maxBufferSize : 1000
    this.maxTraces = maxTraces > 0 ? maxTraces : 1000
    this.traceTtlMs = traceTtlMs !== undefined && traceTtlMs > 0 ? traceTtlMs : undefined
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
    this.evictIfNeeded()
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
    this.evictIfNeeded()
    return entry.session
  }

  getTrail(traceId: string): { session: TraceSession; events: AgentLogEvent[] } {
    const entry = this.traces.get(traceId)
    if (entry === undefined) {
      throw new AuditError(AUDIT_ERROR_CODES.TRACE_NOT_FOUND, `trace 不存在: ${traceId}`)
    }
    return { session: entry.session, events: entry.buffer.toArray() }
  }

  private evictIfNeeded(): void {
    this.evictExpired()
    while (this.traces.size > this.maxTraces) {
      const oldestId = this.findOldestTerminalId()
      if (oldestId === undefined) {
        return
      }
      this.traces.delete(oldestId)
    }
  }

  private evictExpired(): void {
    if (this.traceTtlMs === undefined) {
      return
    }
    const cutoffMs = Date.now() - this.traceTtlMs
    for (const [traceId, entry] of this.traces) {
      if (entry.session.status === 'active') {
        continue
      }
      const endMs = Date.parse(entry.session.endTime ?? entry.session.startTime)
      if (endMs < cutoffMs) {
        this.traces.delete(traceId)
      }
    }
  }

  private findOldestTerminalId(): string | undefined {
    let oldestId: string | undefined
    let oldestMs = Infinity
    for (const [traceId, entry] of this.traces) {
      if (entry.session.status === 'active') {
        continue
      }
      const startMs = Date.parse(entry.session.startTime)
      if (startMs < oldestMs) {
        oldestMs = startMs
        oldestId = traceId
      }
    }
    return oldestId
  }
}
