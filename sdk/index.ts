// SDK 入口：createAuditClient 工厂（懒连接、超时保护、失败静默降级为 no-op）
import type { AuditClient, AuditClientOptions } from './types.js'
import { AuditClientImpl } from './client.js'

export { wrapAgent } from './instrumentation.js'
export type { AgentShape, AgentToolHandler, AuditClient, AuditClientOptions, AuditRecordInput } from './types.js'

// 创建审计客户端：返回实现 AuditClient 接口的实例
export function createAuditClient(options: AuditClientOptions): AuditClient {
  return new AuditClientImpl(options)
}
