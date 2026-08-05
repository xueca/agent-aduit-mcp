# Code Guardian 集成映射（第三批）

> 来源：`agent-audit-architecture-v2.md` §10.1 / §10.2 / §10.3。
> 本批交付 SDK 调用侧接入：示例（`examples/with-code-guardian.ts`）、文档（本文件）、集成测试（`tests/sdk-integration.test.ts`），全程不修改 Code Guardian 源码。

## 1. 事件映射表（§10.1）

| CG 工具 / 事件 | 事件阶段 | 审计动作 | 触发方式 |
| --- | --- | --- | --- |
| `full_health_check`（基线） | `INPUT_SNAPSHOT` | `audit_record_event` | 显式记录（SDK `client.record`） |
| 缺陷识别（ESLint / 架构违规） | `REASONING` | `audit_record_event` | 显式记录 |
| `record_blueprint`（施工图） | `DECISION` | `audit_record_event` + BlueprintRecord | 显式记录 |
| `auto_fix` | `EXECUTION` | `audit_record_event` | SDK 自动（`wrapAgent` 包装） |
| `full_health_check`（修复后） | `VERIFICATION` | `audit_record_event` + 回归检查 | 显式记录 |
| 会话结束 | - | `audit_end_trace` | 显式记录（SDK `client.endTrace`） |

## 2. 编排流程（§10.2）

```
Agent: audit_start_trace(agentName="code-guardian", taskIntent="修复D1路径穿越")
Agent: full_health_check(filePath)               -> 基线
Agent: audit_record_event(INPUT_SNAPSHOT, metadata={findings: 3})
Agent: record_blueprint(施工图)                   -> DECISION
Agent: auto_fix(filePath)                        -> EXECUTION（启用 SDK 则自动包裹）
Agent: full_health_check(filePath)               -> 验证
Agent: audit_record_event(VERIFICATION, metadata={before, after})
Agent: audit_end_trace(outcome="success")
```

## 3. wrapAgent 接入（SDK 自动包裹）

```ts
import { createAuditClient, wrapAgent } from '../sdk/index.js'

// 1. 创建审计客户端（stdio 子进程连接审计 Server）
const client = createAuditClient({
  agentName: 'code-guardian',
  taskIntent: '修复 D1 路径穿越',
  command: 'node',
  args: ['dist/src/cli.js']
})

// 2. 包装 CG 风格 Agent：工具调用后自动记录 EXECUTION 事件（成功 info / 失败 error）
const wrapped = wrapAgent(cgAgent, { agentName: 'code-guardian' }, client)

// 3. 业务调用不变，审计事件自动落盘
const result = await wrapped.tools.auto_fix({ filePath: 'src/server.ts' })
```

降级说明：审计 Server 不可达（`transportFactory` 抛错 / 连接失败）时，
SDK 内部静默降级——`startTrace` / `record` / `endTrace` 返回 `null` 不抛错，
业务工具调用不受任何影响。

## 4. 显式记录方式（手动埋点）

不需要包装器时，可显式记录任意阶段事件（如 DECISION / INPUT_SNAPSHOT）：

```ts
const traceId = await client.startTrace({ taskIntent: '修复 D1 路径穿越' })
await client.record({
  phase: 'DECISION',
  message: '提交施工图',
  metadata: { toolName: 'record_blueprint' }
})
await client.endTrace({ traceId, outcome: 'completed' })
```

## 5. 护栏

- 不修改 CG 源码：全部埋点位于调用侧（SDK 包装 / 显式记录），CG 的 `handleToolCall` 保持原样。
- 267 测试全绿：任何 CG 改动都以现有 267 个测试为回归底线；本方案对 CG 零改动，天然满足。
- Server 不可用静默降级：所有 SDK 方法返回 `null`，不抛错、不阻塞业务。
- 双写期属 Phase 3：CG 内部日志 + 审计 Server 同时写入属后续批次（Phase 3 迁移期）计划，本批不实现。

## 6. 验收方式

1. `npm test` 全绿（含本批新增的 `tests/sdk-integration.test.js` 集成测试）。
2. 手工验证：先 `npm run build`，再运行
   `node dist/examples/with-code-guardian.js`；
   审计 Server 由 SDK 按 `command: 'node', args: ['dist/src/cli.js']` 以 stdio 子进程拉起，
   也可改用 `npx agent-audit` 或全局安装的 `agent-audit` 作为启动命令。