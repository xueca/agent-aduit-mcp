# @agent-audit/mcp-server

Agent 修复任务的行为审计 MCP Server：让每次自动修复从输入、推理、决策到执行、验证的全过程留下清晰日志。

## 简介

AI Agent 在自动修复代码时往往像"黑盒"：改了什么、为什么改、验证结果如何，事后难以追溯。`@agent-audit/mcp-server` 以 MCP 工具 + JSONL 落盘 + SDK 自动注入的方式，把 Agent 的修复任务记录为结构化事件流（trace + event），提供**全程清晰日志**：何时开始、每个阶段发生了什么、最终结果如何，均可查询与回放。

## 功能特性

- **5 个 MCP 工具**：`audit_start_trace` / `audit_record_event` / `audit_end_trace` / `audit_get_trail` / `audit_export_report`，覆盖追踪的创建、记录、结束、查询与报告导出全流程。
- **三通道输出**：JSONL 文件持久化（按天分片、10MB 轮转、7 天保留）、MCP `notifications/message` 通知（DECISION 阶段或 warn 及以上级别）、stderr 告警（warn 及以上级别）。
- **SDK 自动注入**：`wrapAgent` 一行包装 Agent 的全部工具调用，成功后自动记录 `EXECUTION/info` 事件，失败记录 `EXECUTION/error` 事件后原样抛出。
- **静默降级**：审计 Server 不可用时，`startTrace` / `record` / `endTrace` 失败时返回 `null` 不抛异常（`close` 无返回值），首次失败输出一次 stderr 提示后转为 no-op，业务零影响。
- **内存实时查询**：事件同时写入内存 RingBuffer（默认 1000 条，`drop-oldest`），通过 `audit_get_trail` 实时查询最近轨迹。

## 文档

> 📖 详细使用文档（中文）：[docs/usage.md](docs/usage.md)

## 快速开始

```bash
npm install @agent-audit/mcp-server
```

### MCP 客户端配置（stdio）

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

## Trae 使用方式

本项目已通过 [.trae/mcp.json](../../.trae/mcp.json) 预配置 agent-audit，**无需手动注册**，打开项目后 Agent 自动可用。

### 对话示例

对 Trae Agent 说人话，它会自动调用对应的 `audit_*` 工具：

| 你想做的事 | 对 Agent 说 |
| --- | --- |
| 开始一次带审计的修复任务 | `开始审计，任务：修复登录接口 400 错误` |
| 中途记录关键决策 | `把刚才的方案决策记入审计` |
| 查看这次任务的过程 | `看看这次任务都做了什么` |
| 导出报告 | `把这次任务导出成报告` / `把这个事件导出报告` |
| 导出单个事件 | `导出 eventId=019f... 的报告` |

Agent 会自动调用 `audit_start_trace` / `audit_record_event` / `audit_end_trace` / `audit_get_trail` / `audit_export_report`，无需你手动操作工具。

### 修改 MCP 配置

如需调整日志级别或输出路径，编辑 [.trae/mcp.json](../../.trae/mcp.json)：

```json
{
  "mcpServers": {
    "agent-audit": {
      "command": "node",
      "args": [
        "D:\\BaiduNetdiskDownload\\A055\\sql\\trae\\shuju\\webtest\\interview-handbook\\my-mcp-server\\agent-audit-mcp\\dist\\src\\cli.js",
        "--log-level", "info"
      ]
    }
  }
}
```

修改后重启 Trae 即可生效。

## 手动配置

以下为各 MCP 客户端的手动注册方法。

### Codex（`~/.codex/config.toml`）

在 `[mcp_servers.agent-audit]` 段中添加：

```toml
[mcp_servers.agent-audit]
command = "node"
args = ["D:\\path\\to\\my-mcp-server\\agent-audit-mcp\\dist\\src\\cli.js", "--log-level", "info"]
```

修改后重启 Codex。

### Claude Desktop（Windows）

编辑 `~/AppData/Roaming/Claude/claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "agent-audit": {
      "command": "node",
      "args": ["D:\\path\\to\\my-mcp-server\\agent-audit-mcp\\dist\\src\\cli.js", "--log-level", "info"]
    }
  }
}
```

### VS Code（`.vscode/mcp.json`）

在项目根目录创建 `.vscode/mcp.json`：

```json
{
  "mcpServers": {
    "agent-audit": {
      "command": "node",
      "args": ["D:\\path\\to\\my-mcp-server\\agent-audit-mcp\\dist\\src\\cli.js", "--log-level", "info"]
    }
  }
}
```

### CLI 独立运行

```bash
# 本地开发调试
node dist/src/cli.js --log-level info

# 指定配置文件
node dist/src/cli.js --config ./agent-audit.config.json
```

## 工具一览

| 工具名 | 用途 | 关键入参 |
| --- | --- | --- |
| `audit_start_trace` | 开始一次新的审计追踪，返回 traceId | `agentName`、`taskIntent`、`context?` |
| `audit_record_event` | 向指定追踪会话记录一条行为事件 | `traceId`、`phase`、`message`、`level?`、`metadata?`、`error?` |
| `audit_end_trace` | 结束追踪会话并返回事件汇总 | `traceId`、`outcome`（默认 `completed`；可选 `failed`） |
| `audit_get_trail` | 查询指定追踪会话的审计事件轨迹 | `traceId`、`phase?`、`level?`、`limit?` |
| `audit_export_report` | 按需导出人类可读报告 | `eventId?`、`traceId?` |

事件阶段 `phase`：`INPUT_SNAPSHOT` / `REASONING` / `DECISION` / `EXECUTION` / `VERIFICATION`；日志级别 `level`：`debug` / `info` / `warn` / `error`。

## 配置

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

## SDK 用法

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

## Code Guardian 集成

面向 Code Guardian 的接入说明（事件映射、编排流程、wrapAgent 接入、手动埋点）见 [docs/cg-integration.md](docs/cg-integration.md)。独立使用示例见 [examples/standalone-usage.ts](examples/standalone-usage.ts)，构建后运行 `node dist/examples/standalone-usage.js`。

## 开发

```bash
npm run build       # tsc 编译到 dist/
npm run lint        # ESLint 检查（src/tests/sdk/examples）
npm run typecheck   # tsc --noEmit 类型检查
npm test            # 编译后运行 node:test，共 77 个测试
npm run clean       # 删除 dist/
```

## 目录结构

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