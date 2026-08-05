// MCP 通知器：按级别/阶段过滤，发送 notifications/message，失败不抛出
import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import type { AgentLogEvent, EventPhase, Level } from '../models/event.js'
import { levelRank } from '../models/event.js'

const LEVEL_TO_MCP: Record<Level, string> = {
  debug: 'debug',
  info: 'info',
  warn: 'warning',
  error: 'error'
}

export class McpNotifier {
  private readonly server: Server
  private readonly enabled: boolean
  private readonly minLevel: Level
  private readonly notifyPhases: readonly EventPhase[]

  constructor(options: {
    server: Server
    enabled: boolean
    minLevel: Level
    notifyPhases?: readonly EventPhase[]
  }) {
    const { server, enabled, minLevel, notifyPhases } = options
    this.server = server
    this.enabled = enabled
    this.minLevel = minLevel
    this.notifyPhases = notifyPhases ?? ['DECISION']
  }

  shouldNotify(event: AgentLogEvent): boolean {
    return this.enabled && (this.notifyPhases.includes(event.phase) || levelRank(event.level) >= levelRank(this.minLevel))
  }

  async notify(event: AgentLogEvent): Promise<void> {
    const message = {
      method: 'notifications/message',
      params: {
        level: LEVEL_TO_MCP[event.level],
        data: {
          traceId: event.traceId,
          eventId: event.eventId,
          phase: event.phase,
          level: event.level,
          message: event.message
        }
      }
    }
    try {
      await this.server.notification(message)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      process.stderr.write(`[agent-audit] 通知发送失败: ${msg}\n`)
    }
  }
}