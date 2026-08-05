// 审计服务：事件记录、批量落盘、定时 flush、通知与告警
import { AUDIT_ERROR_CODES, AuditError } from '../errors/audit-error.js'
import type { AgentAuditConfig } from '../config/schema.js'
import type { TraceStore } from '../storage/trace-store.js'
import type { IWriter } from '../writers/interface.js'
import type { McpNotifier } from '../notifications/mcp-notifier.js'
import type { AgentLogEvent, EventPhase, Level, TraceSession } from '../models/index.js'
import { levelRank } from '../models/event.js'
import { redact } from '../utils/redact.js'
import { uuidV7 } from '../utils/id.js'
import { nowIso } from '../utils/time.js'

export interface RecordEventInput {
  traceId: string
  phase: EventPhase
  level?: Level
  message: string
  metadata?: Record<string, unknown>
  error?: { code: string; message: string; stack?: string }
}

const PENDING_OVERFLOW = 'AUDIT_PENDING_OVERFLOW'
const DEFAULT_PENDING_LIMIT = 10000
const DEFAULT_FLUSH_RETRY = { maxAttempts: 3, baseDelayMs: 100, backoffFactor: 3 }

function buildEvent(input: RecordEventInput, fields: readonly string[]): AgentLogEvent {
  const { traceId, phase, level, message, metadata, error } = input
  const event: AgentLogEvent = {
    eventId: uuidV7(),
    traceId,
    timestamp: nowIso(),
    phase,
    level: level ?? 'info',
    message,
    metadata: redact(metadata ?? {}, fields) as AgentLogEvent['metadata']
  }
  if (error !== undefined) {
    event.error = redact(error, fields) as AgentLogEvent['error']
  }
  return event
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class AuditService {
  private readonly config: AgentAuditConfig
  private readonly store: TraceStore
  private readonly writer: IWriter
  private readonly notifier: McpNotifier | undefined
  private readonly warnSink: (line: string) => void
  private readonly pending: AgentLogEvent[] = []
  private timer: ReturnType<typeof setInterval> | undefined
  private flushing = false

  constructor(options: { config: AgentAuditConfig; store: TraceStore; writer: IWriter; notifier?: McpNotifier; warnSink?: (line: string) => void }) {
    this.config = options.config
    this.store = options.store
    this.writer = options.writer
    this.notifier = options.notifier
    this.warnSink = options.warnSink ?? ((line) => process.stderr.write(line + '\n'))
  }

  async initialize(): Promise<void> {
    await this.writer.initialize()
    this.timer = setInterval(() => void this.flushNow().catch(() => undefined), this.config.flush.intervalMs)
    this.timer.unref()
  }

  async startTrace(input: { agentName: string; taskIntent: string; context?: string }): Promise<TraceSession> {
    const session = this.store.startTrace({ agentName: input.agentName, taskIntent: input.taskIntent })
    if (input.context !== undefined && input.context.length > 0) {
      await this.recordEvent({ traceId: session.traceId, phase: 'INPUT_SNAPSHOT', message: input.context })
    }
    return session
  }

  async recordEvent(input: RecordEventInput): Promise<AgentLogEvent> {
    const pendingLimit = this.config.flush.pendingLimit ?? DEFAULT_PENDING_LIMIT
    if (this.pending.length >= pendingLimit) {
      throw new AuditError(PENDING_OVERFLOW, `pending 队列已满，上限 ${pendingLimit}`)
    }
    const event = buildEvent(input, this.config.redaction.fields)
    this.store.appendEvent(input.traceId, event)
    this.pending.push(event)
    if (this.pending.length >= this.config.flush.sizeThreshold) {
      await this.flushNow()
    }
    if (levelRank(event.level) >= Math.max(levelRank('warn'), levelRank(this.config.logLevel))) {
      this.warnSink(`[agent-audit] ${event.level} ${event.phase} ${event.message}`)
    }
    if (this.notifier !== undefined && this.notifier.shouldNotify(event)) {
      await this.notifier.notify(event)
    }
    return event
  }

  async endTrace(input: { traceId: string; outcome: 'completed' | 'failed' }): Promise<TraceSession> {
    const session = this.store.endTrace(input.traceId, input.outcome)
    await this.flushNow()
    return session
  }

  async getTrail(input: { traceId: string; phase?: EventPhase; level?: Level; limit?: number }): Promise<{ session: TraceSession; events: AgentLogEvent[] }> {
    const { traceId, phase, level, limit } = input
    const trail = this.store.getTrail(traceId)
    let events = trail.events
    if (phase !== undefined) {
      events = events.filter((event) => event.phase === phase)
    }
    if (level !== undefined) {
      const minRank = levelRank(level)
      events = events.filter((event) => levelRank(event.level) >= minRank)
    }
    const safeLimit = limit !== undefined && limit > 0 ? limit : 100
    return { session: trail.session, events: events.slice(-safeLimit) }
  }

  async shutdown(): Promise<void> {
    if (this.timer !== undefined) {
      clearInterval(this.timer)
      this.timer = undefined
    }
    await this.flushNow()
    await this.writer.shutdown()
  }

  private async flushNow(): Promise<void> {
    if (this.pending.length === 0 || this.flushing) {
      return
    }
    this.flushing = true
    try {
      await this.writeWithRetry(this.pending.splice(0))
    } finally {
      this.flushing = false
    }
  }

  private async writeWithRetry(batch: AgentLogEvent[]): Promise<void> {
    const { maxAttempts, baseDelayMs, backoffFactor } = this.config.flush.retry ?? DEFAULT_FLUSH_RETRY
    let attempts = 0
    for (;;) {
      try {
        await this.writer.write(batch)
        return
      } catch (error) {
        attempts += 1
        this.warnSink(`[agent-audit] 写入失败: ${errorMessage(error)}`)
        if (attempts > maxAttempts) {
          this.pending.unshift(...batch)
          throw new AuditError(AUDIT_ERROR_CODES.WRITE_FAILED, errorMessage(error))
        }
        const delayMs = baseDelayMs * Math.pow(backoffFactor, attempts - 1)
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
    }
  }
}
