import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { AuditClient, AuditClientOptions, AuditRecordInput } from './types.js'
// 审计客户端实现：内部持有 MCP Client，首次调用时懒连接
export class AuditClientImpl implements AuditClient {
  private readonly options: AuditClientOptions
  private readonly client: Client
  private transport: Transport | undefined
  private connected = false
  private disabled = false
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
    if (this.options.enabled === false || this.disabled) {
      return null
    }
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
  async close(): Promise<void> {
    try {
      if (this.connected) {
        await this.client.close()
      }
    } catch {
      // 关闭异常静默忽略
    }
    this.connected = false
  }
  // 统一守卫：enabled/disabled 短路、懒连接、超时调用、失败降级
  private async callGuarded(name: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.options.enabled === false || this.disabled) {
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
  // 懒连接：连接成功前不创建 transport，异常统一走 failOnce 降级
  private async ensureConnected(): Promise<void> {
    if (this.connected) {
      return
    }
    const transport = await this.createTransport()
    await this.client.connect(transport)
    this.transport = transport
    this.connected = true
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
    const timeoutMs = this.options.timeoutMs ?? 2000
    let timer: ReturnType<typeof setTimeout> | undefined
    const guard = new Promise<never>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('审计调用超时: ' + name)), timeoutMs)
    })
    const call = this.client.callTool({ name, arguments: params })
    const raced = Promise.race([call, guard])
    return raced.finally(() => clearTimeout(timer))
  }
  // 首次失败置 disabled 并写一次 stderr 提示，之后静默
  private failOnce(error: unknown): void {
    if (this.warned) {
      return
    }
    this.disabled = true
    this.warned = true
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write('[agent-audit-sdk] 审计 Server 不可用，已降级为 no-op: ' + message + '\n')
  }
}
// 从 callTool 响应中解析 traceId，解析失败返回 null
function parseTraceId(result: unknown): string | null {
  try {
    const content = (result as { content?: unknown[] }).content
    if (content === undefined || content.length === 0) {
      return null
    }
    const first = content[0]
    if (typeof first !== 'object' || first === null) {
      return null
    }
    const text = (first as { text?: unknown }).text
    if (typeof text !== 'string') {
      return null
    }
    const body = JSON.parse(text) as { traceId?: unknown }
    return typeof body.traceId === 'string' ? body.traceId : null
  } catch {
    return null
  }
}
