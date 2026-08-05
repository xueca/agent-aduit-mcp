import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { AuditClient, AuditClientOptions, AuditRecordInput } from './types.js'
// 审计客户端实现：内部持有 MCP Client，首次调用时懒连接
export class AuditClientImpl implements AuditClient {
  private readonly options: AuditClientOptions
  private client: Client
  private transport: Transport | undefined
  private connected = false
  private disabledUntil = 0
  private warned = false
  private traceId: string | null = null
  constructor(options: AuditClientOptions) {
    this.options = options
    this.client = new Client({ name: 'agent-audit-sdk', version: '0.1.0' })
  }
  async startTrace(input?: { agentName?: string; taskIntent?: string; context?: string }): Promise<string | null> {
    const result = await this.callGuarded('audit_start_trace', {
      agentName: input?.agentName ?? this.options.agentName,
      taskIntent: input?.taskIntent ?? this.options.taskIntent ?? 'untitled',
      context: input?.context
    })
    const traceId = parseTraceId(result)
    if (traceId !== null) {
      this.traceId = traceId
    }
    return traceId
  }
  async record(input: AuditRecordInput): Promise<unknown> {
    const traceId = await this.resolveTraceId(input)
    if (traceId === null) {
      return null
    }
    return await this.callGuarded('audit_record_event', {
      traceId,
      phase: input.phase,
      level: input.level ?? 'info',
      message: input.message,
      metadata: input.metadata ?? {},
      error: input.error
    })
  }
  async endTrace(input: { traceId: string; outcome: 'completed' | 'failed' }): Promise<unknown> {
    return await this.callGuarded('audit_end_trace', {
      traceId: input.traceId,
      outcome: input.outcome
    })
  }
  // 无论是否 connected 都关闭 client 与 transport，防止子进程泄漏
  async close(): Promise<void> {
    try {
      await this.client.close()
    } catch {
      // 关闭异常静默忽略
    }
    const transport = this.transport
    if (transport !== undefined) {
      try {
        await transport.close()
      } catch {
        // 关闭异常静默忽略
      }
      this.transport = undefined
    }
    this.connected = false
  }
  // 统一守卫：enabled/disabled 短路、懒连接、超时调用、失败降级
  private async callGuarded(name: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.options.enabled === false || Date.now() < this.disabledUntil) {
      return null
    }
    try {
      await this.ensureConnected()
      return await this.callToolWithTimeout(name, params)
    } catch (error) {
      this.failOnce(error)
      return null
    }
  }
  // 懒连接：transport 先赋给 this，连接失败立即关闭避免子进程泄漏
  private async ensureConnected(): Promise<void> {
    if (this.connected) {
      return
    }
    const transport = await this.createTransport()
    this.transport = transport
    try {
      await this.connectWithTimeout(transport)
      this.connected = true
    } catch (error) {
      try {
        await transport.close()
      } catch {
        // 关闭异常静默忽略
      }
      this.transport = undefined
      throw error
    }
  }
  // traceId 解析：优先用 input 提供的，否则懒启动追踪
  private async resolveTraceId(input: AuditRecordInput): Promise<string | null> {
    if (input.traceId !== undefined) {
      return input.traceId
    }
    if (this.traceId === null) {
      const started = await this.startTrace()
      return started === null ? null : started
    }
    return this.traceId
  }
  // 创建传输：优先 transportFactory，默认 stdio 启动 agent-audit 命令
  private async createTransport(): Promise<Transport> {
    if (this.options.transportFactory !== undefined) {
      return await this.options.transportFactory()
    }
    return new StdioClientTransport({
      command: this.options.command ?? 'agent-audit',
      args: this.options.args
    })
  }
  // 带超时的 callTool：超时按失败处理，由 callGuarded 兜底
  private callToolWithTimeout(name: string, params: Record<string, unknown>): Promise<unknown> {
    return this.withTimeout(this.client.callTool({ name, arguments: params }), '审计调用超时: ' + name)
  }
  // 连接超时兜底：与 callTool 复用同一 timeoutMs，避免首调用无限阻塞
  private connectWithTimeout(transport: Transport): Promise<void> {
    return this.withTimeout(this.client.connect(transport), '审计连接超时')
  }
  // Promise.race 统一超时包装：timer 在 settled 后清理
  private withTimeout<T>(task: Promise<T>, message: string): Promise<T> {
    const timeoutMs = this.options.timeoutMs ?? 2000
    let timer: ReturnType<typeof setTimeout> | undefined
    const guard = new Promise<never>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs)
    })
    return Promise.race([task, guard]).finally(() => clearTimeout(timer))
  }
  // 失败进入冷却期：冷却后可重连而非永久禁用；首次失败写一次 stderr 提示
  private failOnce(error: unknown): void {
    const cooldownMs = this.options.cooldownMs ?? 30000
    this.disabledUntil = Date.now() + cooldownMs
    if (!this.warned) {
      this.warned = true
      const message = error instanceof Error ? error.message : String(error)
      process.stderr.write('[agent-audit-sdk] 审计 Server 不可用，已降级为 no-op: ' + message + '\n')
    }
  }
}
// 从 callTool 响应中解析 traceId，解析失败返回 null
function parseTraceId(result: unknown): string | null {
  try {
    const first = (result as { content?: unknown[] }).content?.[0]
    const text = first !== null && typeof first === 'object' ? (first as { text?: unknown }).text : undefined
    if (typeof text !== 'string') {
      return null
    }
    const body = JSON.parse(text) as { traceId?: unknown }
    return typeof body.traceId === 'string' ? body.traceId : null
  } catch {
    return null
  }
}
