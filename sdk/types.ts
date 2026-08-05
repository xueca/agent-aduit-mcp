// SDK 公共类型：审计客户端接口、Agent 工具形状与上报输入
import type { EventPhase, Level } from '../src/models/event.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

// 单条审计事件的上报输入，traceId 缺省时由客户端懒启动追踪
export interface AuditRecordInput {
  traceId?: string
  phase: EventPhase
  level?: Level
  message: string
  metadata?: Record<string, unknown>
  error?: { code: string; message: string; stack?: string }
}

// 创建审计客户端的配置项
export interface AuditClientOptions {
  agentName: string
  command?: string
  args?: string[]
  taskIntent?: string
  timeoutMs?: number
  enabled?: boolean
  transportFactory?: () => Transport | Promise<Transport>
}

// 审计客户端接口：所有方法失败时降级返回 null，不抛异常
export interface AuditClient {
  startTrace(input?: { agentName?: string; taskIntent?: string; context?: string }): Promise<string | null>
  record(input: AuditRecordInput): Promise<unknown>
  endTrace(input: { traceId: string; outcome: 'completed' | 'failed' }): Promise<unknown>
  close(): Promise<void>
}

// 单个工具处理器：接收任意入参，返回 Promise 结果
export type AgentToolHandler = (args: unknown) => Promise<unknown>

// Agent 形状：保留任意扩展字段，tools 为工具名到处理器的映射
export interface AgentShape {
  [key: string]: unknown
  tools: Record<string, AgentToolHandler>
  closeAudit?: () => Promise<void>
}