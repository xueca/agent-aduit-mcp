// 与 Code Guardian 协作示例：在调用侧通过 SDK 接入审计，不改动 CG 源码
//
// 事件映射表（§10.1）：
// | CG 工具/事件              | 事件阶段       | 审计动作                       |
// |---------------------------|----------------|--------------------------------|
// | full_health_check（基线）  | INPUT_SNAPSHOT | audit_record_event（显式记录）  |
// | record_blueprint（施工图） | DECISION       | audit_record_event（显式记录）  |
// | auto_fix                  | EXECUTION      | audit_record_event（SDK 自动）  |
// | full_health_check（修复后）| VERIFICATION   | audit_record_event（显式记录）  |
// | 会话结束                  | -              | audit_end_trace（显式记录）     |
//
// 编排流程（§10.2）：audit_start_trace -> 基线检查 -> INPUT_SNAPSHOT
//   -> record_blueprint -> DECISION -> auto_fix(自动 EXECUTION)
//   -> 验证检查 -> VERIFICATION -> audit_end_trace
//
// 护栏：不修改 CG 源码；Server 不可达时 SDK 静默降级为 no-op。
import { createAuditClient, wrapAgent } from '../sdk/index.js'
import type { AuditClient } from '../sdk/types.js'
import type { EventPhase } from '../src/models/event.js'

// 模拟 CG 风格 Agent（真实场景中为 Code Guardian 的 Agent 实例）
const cgAgent = {
  name: 'code-guardian',
  tools: {
    full_health_check: async (args: unknown) => ({ ok: true, findings: 0 }),
    record_blueprint: async (args: unknown) => ({ blueprintId: 'bp-1' }),
    auto_fix: async (args: unknown) => ({ fixed: 2, remaining: 0 })
  }
}

// 显式记录单个阶段事件（§10.2：INPUT_SNAPSHOT / DECISION / VERIFICATION 手写埋点）
async function recordPhase(client: AuditClient, phase: EventPhase, message: string, metadata: unknown): Promise<void> {
  await client.record({ phase, message, metadata: { result: metadata } })
}

async function main(): Promise<void> {
  // 审计客户端：stdio 子进程连接审计 Server（node dist/src/cli.js）
  const client = createAuditClient({
    agentName: 'code-guardian',
    taskIntent: '修复 D1 路径穿越',
    command: 'node',
    args: ['dist/src/cli.js']
  })
  const traceId = await client.startTrace({ taskIntent: '修复 D1 路径穿越' })
  if (traceId === null) {
    console.warn('审计 Server 不可用，本次会话静默降级（不落事件）')
    return
  }
  // 基线：INPUT_SNAPSHOT 显式记录（§10.2 顺序）
  const baseline = await cgAgent.tools.full_health_check({ filePath: 'src/server.ts' })
  await recordPhase(client, 'INPUT_SNAPSHOT', '基线健康检查', baseline)
  console.log('基线健康检查:', baseline)
  // 施工图：DECISION 显式记录（§10.2 顺序）
  const blueprint = await cgAgent.tools.record_blueprint({ layer: 'L1', changeScope: ['src/server.ts'] })
  await recordPhase(client, 'DECISION', '提交施工图', blueprint)
  console.log('施工图:', blueprint)
  // 只包装 auto_fix：EXECUTION 由 SDK 自动记录（成功 info / 失败 error）
  const autoFixAgent = { name: cgAgent.name, tools: { auto_fix: cgAgent.tools.auto_fix } }
  const wrapped = wrapAgent(autoFixAgent, { agentName: 'code-guardian' }, client)
  const fix = await wrapped.tools.auto_fix({ filePath: 'src/server.ts' })
  console.log('自动修复:', fix)
  // 验证：VERIFICATION 显式记录（§10.2 顺序）
  const verified = await cgAgent.tools.full_health_check({ filePath: 'src/server.ts' })
  await recordPhase(client, 'VERIFICATION', '修复后健康检查', verified)
  console.log('修复后验证:', verified)
  await client.endTrace({ traceId, outcome: 'completed' })
  await client.close()
}

const mainPromise = main()
mainPromise.catch((error: unknown) => {
  console.error('示例执行失败:', error)
  process.exitCode = 1
})
