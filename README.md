# @agent-audit/mcp-server

[![GitHub Packages](https://img.shields.io/badge/GitHub%20Packages-@agent--audit/mcp--server-blue)](https://github.com/xueca/agent-aduit-mcp/pkgs/npm/@agent-audit/mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js >= 18](https://img.shields.io/badge/Node.js-%3E%3D%2018-brightgreen)](https://nodejs.org/)

Agent 修复任务的行为审计 MCP Server：让 AI Agent 从输入、推理、决策到执行、验证的全过程留下结构化审计日志。

## 目录

- [项目简介](#项目简介)
- [前置要求](#前置要求)
- [安装](#安装)
- [快速开始](#快速开始)
- [路径 A：Agent 直接调用 MCP 工具](#路径-aagent-直接调用-mcp-工具)
- [路径 B：SDK 自动注入](#路径-bsdk-自动注入)
- [工作原理](#工作原理)
- [5 个审计工具](#5-个审计工具)
- [配置参考](#配置参考)
- [Code Guardian 集成](#code-guardian-集成)
- [运行测试](#运行测试)
- [项目结构](#项目结构)
- [已知限制](#已知限制)
- [常见问题](#常见问题)
- [贡献指南](#贡献指南)
- [License](#license)

## 项目简介

AI Agent 在自动修复代码时往往像"黑盒"：改了什么、为什么改、验证结果如何，事后难以追溯。`@agent-audit/mcp-server` 以 MCP 工具 + JSONL 落盘 + SDK 自动注入的方式，把 Agent 的修复任务记录为结构化事件流（trace + event），提供**全程清晰日志**：何时开始、每个阶段发生了什么、最终结果如何，均可查询与回放。

## 前置要求

- **Node.js** >= 18.0.0（MCP SDK 依赖；`npm test` 建议 Node >= 21）
- 支持 MCP 的 AI 编码助手客户端（Claude Code / Trae / Cursor / Windsurf / Codex 等），或 Node.js 环境直接以 CLI/SDK 方式运行

## 安装

### 方式一：npm 安装

```bash
npm install @agent-audit/mcp-server
```

### 方式二：本地开发安装

```bash
git clone https://github.com/xueca/agent-aduit-mcp.git
cd agent-audit-mcp
npm install
npm run build
```

## 快速开始

### 1. 注册 MCP Server

在支持 MCP 的客户端中注册本服务：

```json
{
  "mcpServers": {
    "agent-audit": {
      "command": "npx",
      "args": ["-y", "@agent-audit/mcp-server"]
    }
  }
}
```

本地开发调试可改为 `"command": "node", "args": ["dist/src/cli.js"]`。启动后即暴露 5 个审计工具，事件默认落盘到 `./audit-events.jsonl/` 目录（按天生成 `audit-YYYY-MM-DD.jsonl`）。

> 本项目已通过 [.trae/mcp.json](../../.trae/mcp.json) 预配置 agent-audit，Trae 打开项目后 Agent 自动可用，无需手动注册。

### 2. 使用

在 AI 对话中直接调用 Tool，或对 Agent 说人话让它自动调用（见 [路径 A](#路径-aagent-直接调用-mcp-工具) 的对话示例）：

```
开始审计，任务：修复登录接口 400 错误
```

## 路径 A：Agent 直接调用 MCP 工具

这是推荐的使用方式：**Agent（包括子 Agent）直接把审计工具当作普通 MCP 工具调用**，在任务的不同阶段记录事件，形成完整审计闭环。

### 完整审计闭环（5 步）

```text
audit_start_trace        → 拿到 traceId
        ↓
audit_record_event       → 按阶段记录 INPUT_SNAPSHOT / REASONING / DECISION / EXECUTION / VERIFICATION
        ↓
audit_end_trace          → 标记 outcome（completed / failed），得到事件汇总
        ↓
audit_get_trail          → （任意时刻）查询轨迹，核对过程
audit_export_report      → 导出人类可读的 Markdown 报告
```

### 工具调用示例

**第 1 步：开始追踪**

```json
{
  "agentName": "fix-agent-01",
  "taskIntent": "修复 code-guardian 入口失效问题",
  "context": "用户反馈 MCP 入口指向已删除的 index.js"
}
```

返回 `{ "ok": true, "traceId": "019f...", "agentName": "fix-agent-01", "status": "active", "startTime": "..." }`。**保存 traceId，后续所有调用都需要它。**

**第 2 步：按阶段记录事件**

```json
{
  "traceId": "019f...",
  "phase": "DECISION",
  "level": "info",
  "message": "确定将入口从 index.js 改为 dist/index.js",
  "metadata": {
    "toolName": "apply_patch",
    "filePath": ".trae/mcp.json",
    "status": "success"
  }
}
```

**第 3 步：结束追踪**

```json
{ "traceId": "019f...", "outcome": "completed" }
```

返回 `{ "ok": true, "traceId": "019f...", "status": "completed", "eventCount": 12, "endTime": "...", "durationMs": 18340 }`。

**第 4 步：查询轨迹（任意时刻可查）**

```json
{ "traceId": "019f...", "phase": "EXECUTION", "limit": 100 }
```

**第 5 步：导出报告**

```json
{ "traceId": "019f..." }
```

也可按单个事件导出：`{ "eventId": "019f..." }`（两者至少提供一个）。

### 阶段与时机对照

| phase | 记录时机 | 建议 message 内容 |
| --- | --- | --- |
| `INPUT_SNAPSHOT` | 任务开始 | 任务输入、上下文、目标文件与基线状态 |
| `REASONING` | 调研 / 分析 | 关键分析结论、候选方案、风险点 |
| `DECISION` | 确定方案 | 方案选择与理由（触发 MCP 通知） |
| `EXECUTION` | 执行改动 | 改动的文件、调用的工具、执行结果 |
| `VERIFICATION` | 验证阶段 | 测试 / 检查结果，成功或失败原因 |

`level` 可选 `debug` / `info` / `warn` / `error`；`metadata` 建议携带 `toolName`、`filePath`、`layer`、`durationMs`、`status`（`success` / `error` / `skipped`）、`before` / `after`，便于报告还原细节。

### 对话示例

| 你想做的事 | 对 Agent 说 |
| --- | --- |
| 开始一次带审计的修复任务 | `开始审计，任务：修复登录接口 400 错误` |
| 中途记录关键决策 | `把刚才的方案决策记入审计` |
| 查看这次任务的过程 | `看看这次任务都做了什么` |
| 导出报告 | `把这次任务导出成报告` / `把这个事件导出报告` |
| 导出单个事件 | `导出 eventId=019f... 的报告` |

### 可用性说明

路径 A 生效的前提是**客户端向 Agent（含子 Agent）暴露 MCP 工具集**。部分平台的子 Agent 环境默认不注入 MCP 工具，此时需要主线程编排调用，或改用 [路径 B](#路径-bsdk-自动注入)（SDK 直连，不受工具集暴露限制）。

## 路径 B：SDK 自动注入

SDK 通过包的 `./sdk` 子路径导出（`package.json` exports `./sdk`），提供 `createAuditClient` / `wrapAgent`，包装结果附 `closeAudit`。

### 手动埋点：createAuditClient

```ts
import { createAuditClient } from '@agent-audit/mcp-server/sdk'

const client = createAuditClient({
  agentName: 'demo-agent',
  taskIntent: '修复 D1 路径穿越',
  command: 'node',
  args: ['dist/src/cli.js']
})

const traceId = await client.startTrace()
await client.record({
  phase: 'DECISION',
  level: 'info',
  message: '提交修复方案',
  metadata: { toolName: 'record_blueprint' }
})
await client.endTrace({ traceId, outcome: 'completed' })
await client.close()
```

`startTrace` 未传 `traceId` 的 `record` 会懒启动追踪；`timeoutMs` 默认 2000 毫秒，超时按失败处理。

### 自动注入：wrapAgent

```ts
import { wrapAgent } from '@agent-audit/mcp-server/sdk'

const wrapped = wrapAgent(agent, {
  agentName: 'demo-agent',
  taskIntent: '演示独立接入',
  command: 'node',
  args: ['dist/src/cli.js']
})

// 工具调用后自动记录 EXECUTION 事件（成功 info / 失败 error）
const result = await wrapped.tools.fix({ file: 'src/a.ts' })

// 退出前释放子进程句柄（幂等，失败静默）
await wrapped.closeAudit?.()
```

`wrapAgent` 返回原 Agent 的浅拷贝：`tools` 全部替换为带审计上报的包装函数，并新增 `closeAudit`；传入已创建的 `client` 时复用该客户端，否则内部自动创建。

### 静默降级

审计 Server 不可用时，`startTrace` / `record` / `endTrace` 返回 `null`、不抛异常；首次失败向 stderr 输出一行提示，此后完全静默（no-op），不影响业务调用。

## 工作原理

- **trace + event 模型**：一次修复任务是一个 `trace`（会话），阶段行为是若干条 `event`（事件），事件通过 `traceId` 关联成轨迹。
- **三通道输出**：JSONL 文件持久化（按天分片、10MB 轮转、7 天保留）、MCP `notifications/message` 通知（DECISION 阶段或 warn 及以上级别）、stderr 告警（warn 及以上级别）。
- **内存实时查询**：事件同时写入内存 RingBuffer（默认 1000 条，`drop-oldest`），通过 `audit_get_trail` 实时查询最近轨迹。
- **SDK 自动注入**：`wrapAgent` 一行包装 Agent 的全部工具调用，成功后自动记录 `EXECUTION/info` 事件，失败记录 `EXECUTION/error` 事件后原样抛出。

## 5 个审计工具

| 工具名 | 用途 | 关键入参 | 返回 |
| --- | --- | --- | --- |
| `audit_start_trace` | 开始一次新的审计追踪 | `agentName`、`taskIntent`、`context?` | `traceId`、`status`、`startTime` |
| `audit_record_event` | 记录一条行为事件 | `traceId`、`phase`、`message`、`level?`、`metadata?`、`error?` | `eventId`、`event` |
| `audit_end_trace` | 结束追踪并返回汇总 | `traceId`、`outcome?`（`completed` / `failed`） | `status`、`eventCount`、`durationMs` |
| `audit_get_trail` | 查询追踪会话的事件轨迹 | `traceId`、`phase?`、`level?`、`limit?`（≤1000） | `session`、`events` |
| `audit_export_report` | 导出人类可读 Markdown 报告 | `eventId?` 或 `traceId?`（至少其一） | `report` |

事件阶段 `phase`：`INPUT_SNAPSHOT` / `REASONING` / `DECISION` / `EXECUTION` / `VERIFICATION`；日志级别 `level`：`debug` / `info` / `warn` / `error`。

## 配置参考

配置按四级来源合并（优先级从低到高）：默认值 → `.agent-audit.json` → 环境变量 `AGENT_AUDIT_*` → CLI 参数，合并后经 zod schema 校验，非法配置直接报错退出。

### CLI 参数

```bash
agent-audit [选项]

选项:
  --log-level <debug|info|warn|error>  设置服务日志级别
  --config <path>                      配置文件路径（JSON）
  -h, --help                           显示本帮助并退出
```

### 环境变量

| 变量 | 作用 |
| --- | --- |
| `AGENT_AUDIT_TRANSPORT` | 传输方式，仅支持 `stdio` |
| `AGENT_AUDIT_LOG_LEVEL` | 日志级别 |
| `AGENT_AUDIT_BUFFER_SIZE` | 内存缓冲大小（正整数） |
| `AGENT_AUDIT_SINK` | 写入器配置（JSON 数组，如 `[{"type":"jsonl","filePath":"./audit-events.jsonl"}]`） |
| `AGENT_AUDIT_NOTIFICATIONS` | 通知开关，`true` / `false` |
| `AGENT_AUDIT_FLUSH_INTERVAL` | 定时落盘间隔（毫秒） |
| `AGENT_AUDIT_FLUSH_THRESHOLD` | 批量落盘条数阈值 |

### 配置文件（.agent-audit.json）

默认读取工作目录下的 `.agent-audit.json`，也可用 `--config` 指定路径：

```json
{
  "logLevel": "info",
  "buffer": { "maxSize": 1000, "overflowStrategy": "drop-oldest" },
  "flush": { "intervalMs": 5000, "sizeThreshold": 100 },
  "writers": [{ "type": "jsonl", "filePath": "./audit-events.jsonl" }],
  "notifications": { "enabled": true, "minLevel": "warn" },
  "storage": "jsonl"
}
```

## Code Guardian 集成

面向 Code Guardian 的接入说明（事件映射、编排流程、wrapAgent 接入、手动埋点）见 [docs/cg-integration.md](docs/cg-integration.md)。独立使用示例见 [examples/standalone-usage.ts](examples/standalone-usage.ts)，构建后运行 `node dist/examples/standalone-usage.js`。

## 运行测试

```bash
npm run build       # tsc 编译到 dist/
npm run lint        # ESLint 检查（src/tests/sdk/examples）
npm run typecheck   # tsc --noEmit 类型检查
npm test            # 编译后运行 node:test，共 77 个测试
npm run clean       # 删除 dist/
```

## 项目结构

```
src/
  buffer/           RingBuffer 有界环形缓冲
  config/           配置 schema / 默认值 / 环境变量解析 / 加载器
  core/             AuditService 审计服务
  errors/           AuditError 与错误码
  models/           事件 / 会话 / Blueprint 模型（zod）
  notifications/    McpNotifier MCP 通知
  storage/          TraceStore 追踪存储
  tools/            5 个 MCP 工具
  writers/          JsonlWriter / CompositeWriter
  cli.ts            CLI 入口（bin: agent-audit）
  server.ts         MCP Server 装配
  index.ts          公共 API 出口
sdk/                客户端 SDK（client / instrumentation / types）
examples/           使用示例
tests/              node:test 测试
docs/               文档
```

## 已知限制

- 运行环境要求 Node.js ≥ 18（`engines`）；`npm test` 的 `node --test dist/tests/*.test.js` 依赖 Node ≥ 21 的测试运行器 glob 支持。
- 当前构建产物为 CommonJS（tsconfig `module: NodeNext`，未声明 `"type": "module"`），ESM / 双格式发布留待后续版本。
- 存储仅支持 JSONL（`storage` 固定为 `jsonl`）；`writers[].filePath` 为目录而非单文件，内部按天分片并自动清理 7 天前的文件。
- redaction 配置字段当前仅解析、尚未生效（事件仍明文落盘）。
- 路径 A（Agent 直接调用 MCP 工具）依赖客户端向 Agent 暴露 MCP 工具集，部分平台子 Agent 环境默认不可用。

## 常见问题

### Q: 路径 A 和路径 B 有什么区别？

A: 路径 A 是 Agent 把 `audit_*` 当作普通 MCP 工具直接调用，零代码、对模型透明，但依赖客户端暴露工具集；路径 B 用 SDK（`wrapAgent` / `createAuditClient`）在代码层注入，不依赖工具集暴露，适合需要保证一定埋点的场景。两者可混用。

### Q: 为什么事件既要落盘又要进内存？

A: 落盘保证持久化与报告导出，内存 RingBuffer 保证 `audit_get_trail` 的实时查询，互不阻塞。

### Q: 审计 Server 挂了会影响业务吗？

A: 不会。客户端调用失败时 SDK 返回 `null` 并静默降级为 no-op，业务调用不受影响。

### Q: 如何清理审计日志？

A: 无需手动清理。JSONL 按天分片（`audit-YYYY-MM-DD.jsonl`），自动轮转并删除 7 天前的文件。

### Q: 为什么选择 MCP 协议而不是直接作为 CLI 工具？

A: MCP 是 AI 编码助手的标准协议。通过 MCP Server，Agent 可以在修复过程中主动调用审计工具，无需人工干预；CLI 只能事后执行，无法覆盖过程行为。

## 贡献指南

欢迎贡献！请遵循以下流程：

1. **Fork** 本仓库
2. **创建分支**：`git checkout -b feat/your-feature`
3. **编写代码**：确保通过所有现有测试
4. **添加测试**：新功能或 bug 修复需要添加对应测试用例
5. **运行测试**：`npm run test`
6. **提交 PR**：提交前请确保：
   - 所有测试通过
   - 代码符合项目编码规范（文件头注释、函数注释）
   - 新工具或配置变更需要更新 README.md

## License

[MIT](LICENSE)