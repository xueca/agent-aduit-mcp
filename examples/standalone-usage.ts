// 独立使用示例：不依赖 Code Guardian，任何 Agent 都可以接入审计 SDK
//
// 运行前提：
// 1. 先执行 npm run build（本文件编译到 dist/examples/standalone-usage.js）
// 2. 审计 Server 无需手动启动：SDK 会按 command/args 以 stdio 子进程方式拉起
//    （node dist/src/cli.js，即 package.json 中 bin.agent-audit 指向的入口）
// 3. 运行：node dist/examples/standalone-usage.js
//
// 输出：默认落在 ./audit-events.jsonl —— 注意它实际是一个"目录"，
// 内部按天生成 audit-YYYY-MM-DD.jsonl 文件（由 JsonlWriter 决定）。
//
// 行为：wrapAgent 包装 tools 后，每次工具调用后自动记录 EXECUTION 事件（成功 info / 失败 error）；
// 审计 Server 不可用时静默降级（不抛错、不影响业务调用）。
import { wrapAgent } from '../sdk/index.js'

// 模拟一个普通 Agent：任意 { name, tools } 形状均可被包装
const agent = {
  name: 'demo-agent',
  tools: {
    analyze: async (args: unknown) => ({ findings: 1 }),
    fix: async (args: unknown) => ({ fixed: true })
  }
}

async function main(): Promise<void> {
  // 包装：SDK 内部创建审计客户端并接管 trace 生命周期
  const wrapped = wrapAgent(agent, {
    agentName: 'demo-agent',
    taskIntent: '演示独立接入',
    command: 'node',
    args: ['dist/src/cli.js']
  })
  // 包装后的调用与原来完全一致，只是额外自动落审计事件
  const analysis = await wrapped.tools.analyze({ file: 'src/a.ts' })
  console.log('分析结果:', analysis)
  const fixResult = await wrapped.tools.fix({ file: 'src/a.ts' })
  console.log('修复结果:', fixResult)
  // 关闭审计客户端：释放子进程句柄，否则进程无法退出
  await wrapped.closeAudit?.()
  // 进程退出时 stdio 通道关闭，审计 Server 随之退出
}

const mainPromise = main()
mainPromise.catch((error: unknown) => {
  console.error('示例执行失败:', error)
  process.exitCode = 1
})