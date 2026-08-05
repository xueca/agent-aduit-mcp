// 自动注入：包装 Agent 的全部工具调用，向审计 Server 上报 EXECUTION 事件
import type { AgentShape, AgentToolHandler, AuditClient, AuditClientOptions } from './types.js'

// 包装 Agent：返回浅拷贝，tools 全部替换为带审计上报的包装函数
export function wrapAgent(
  agent: AgentShape,
  options: AuditClientOptions,
  client?: AuditClient
): AgentShape {
  const auditPromise = resolveAuditPromise(options, client)
  const wrapped: Record<string, AgentToolHandler> = {}
  for (const toolName of Object.keys(agent.tools)) {
    const handler = agent.tools[toolName]
    wrapped[toolName] = makeWrappedHandler(handler, auditPromise, toolName)
  }
  return { ...agent, tools: wrapped, closeAudit: createCloseAudit(auditPromise) }
}

// 关闭审计客户端：幂等、失败静默，供宿主在退出前释放连接
function createCloseAudit(auditPromise: Promise<AuditClient>): () => Promise<void> {
  return async () => {
    try {
      const audit = await auditPromise
      await audit.close()
    } catch {
      // 关闭失败静默忽略
    }
  }
}

// 传入 client 直接复用；未传入时动态导入 index.js 创建真实客户端，避免静态循环依赖
function resolveAuditPromise(
  options: AuditClientOptions,
  client: AuditClient | undefined
): Promise<AuditClient> {
  if (client !== undefined) {
    return Promise.resolve(client)
  }
  const modulePromise = import('./index.js')
  return modulePromise.then((mod) => mod.createAuditClient(options))
}

// 生成单个工具的包装函数：成功记录 info，失败记录 error 后原样抛出
function makeWrappedHandler(
  handler: AgentToolHandler,
  auditPromise: Promise<AuditClient>,
  name: string
): AgentToolHandler {
  return async (args: unknown) => {
    try {
      const audit = await auditPromise
      const result = await handler(args)
      await recordSuccess(audit, name)
      return result
    } catch (error) {
      await recordFailure(auditPromise, name, error)
      throw error
    }
  }
}

// 上报成功事件，审计失败时静默降级不阻塞业务
async function recordSuccess(audit: AuditClient, name: string): Promise<void> {
  try {
    await audit.record({
      phase: 'EXECUTION',
      level: 'info',
      message: '调用工具 ' + name,
      metadata: { toolName: name }
    })
  } catch {
    // 审计不可用时静默忽略
  }
}

// 上报失败事件，审计失败时静默降级不阻塞业务
async function recordFailure(
  auditPromise: Promise<AuditClient>,
  name: string,
  error: unknown
): Promise<void> {
  try {
    const audit = await auditPromise
    const message = error instanceof Error ? error.message : String(error)
    await audit.record({
      phase: 'EXECUTION',
      level: 'error',
      message: '工具 ' + name + ' 执行失败',
      metadata: { toolName: name },
      error: { code: 'TOOL_ERROR', message }
    })
  } catch {
    // 审计不可用时静默忽略
  }
}