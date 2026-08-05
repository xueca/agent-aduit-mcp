// 审计服务：事件记录、批量落盘、定时 flush、通知与告警
import type { AgentAuditConfig } from '../config/schema.js'
import type { TraceStore } from '../storage/trace-store.js'
import type { IWriter } from '../writers/interface.js'
import type { McpNotifier } from '../notifications/mcp-notifier.js'
import type { AgentLogEvent, EventPhase, Level, TraceSession } from '../models/index.js'
import { levelRank } from '../models/event.js'
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

export class AuditService {
  private readonly config: AgentAuditConfig
  private readonly store: TraceStore
  private readonly writer: IWriter
  private readonly notifier: McpNotifier | undefined
  private readonly warnSink: (line: string) => void
  private readonly pending: AgentLogEvent[] = []
  private timer: ReturnType<typeof setInterval> | undefined

  constructor(options: {
    config: AgentAuditConfig
    store: TraceStore
    writer: IWriter
    notifier?: McpNotifier
    warnSink?: (line: string) => void
  }) {
    const { config, store, writer, notifier, warnSink } = options
    this.config = config
    this.store = store
    this.writer = writer
    this.notifier = notifier
    this.warnSink = warnSink ?? ((line) => process.stderr.write(line + '\n'))
  }

  async initialize(): Promise<void> {
    await this.writer.initialize()
    this.timer = setInterval(() => {
      void this.flushNow()
    }, this.config.flush.intervalMs)
    this.timer.unref()
  }

  async startTrace(input: { agentName: string; taskIntent: string; context?: string }): Promise<TraceSession> {
    const { agentName, taskIntent, context } = input
    const session = this.store.startTrace({ agentName, taskIntent })
    if (context !== undefined && context.length > 0) {
      await this.recordEvent({ traceId: session.traceId, phase: 'INPUT_SNAPSHOT', message: context })
    }
    return session
  }

  async recordEvent(input: RecordEventInput): Promise<AgentLogEvent> {
    const event = this.buildEvent(input)
    this.store.appendEvent(input.traceId, event)
    this.pending.push(event)
    if (this.pending.length >= this.config.flush.sizeThreshold) {
      await this.flushNow()
    }
    if (levelRank(event.level) >= levelRank('warn')) {
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

  async getTrail(input: {
    traceId: string
    phase?: EventPhase
    level?: Level
    limit?: number
  }): Promise<{ session: TraceSession; events: AgentLogEvent[] }> {
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
    if (this.pending.length === 0) {
      return
    }
    const batch = this.pending.splice(0)
    try {
      await this.writer.write(batch)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      this.warnSink(`[agent-audit] 写入失败: ${msg}`)
    }
  }

  private buildEvent(input: RecordEventInput): AgentLogEvent {
    const { traceId, phase, level, message, metadata, error } = input
    const event: AgentLogEvent = {
      eventId: uuidV7(),
      traceId,
      timestamp: nowIso(),
      phase,
      level: level ?? 'info',
      message,
      metadata: metadata ?? {}
    }
    if (error !== undefined) {
      event.error = error
    }
    return event
  }
}