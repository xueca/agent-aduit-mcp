# Agent Audit 使用文档（中文）

## 这是什么

`@agent-audit/mcp-server` 是一个行为审计 MCP Server：Agent 执行修复任务时，从**输入 → 推理 → 决策 → 执行 → 验证**每个阶段自动记录结构化事件，落盘为 JSONL 文件，并支持**按需导出人类可读的 Markdown 报告**。

## 一、快速开始（Codex 已接入）

1. **重启 Codex**（让 MCP 工具生效，新增/修改工具后也需要重启）。
2. 之后直接对 Agent 说人话即可：

| 你想做的事 | 对 Agent 说 |
| --- | --- |
| 开始一次带审计的修复任务 | "开始审计，任务：修复登录接口 400 错误" |
| 中途记录关键决策 | "把刚才的方案决策记入审计" |
| 查看这次任务的过程 | "看看这次任务都做了什么" |
| 导出报告 | "把这次任务导出成报告" / "把这个事件导出报告" |

Agent 会自动调用对应的 `audit_*` 工具，无需你手动操作。

## 二、5 个工具说明

| 工具 | 作用 | 关键入参 |
| --- | --- | --- |
| `audit_start_trace` | 开始一次审计追踪，返回 traceId | `agentName`、`taskIntent`、`context?` |
| `audit_record_event` | 记录一条事件 | `traceId`、`phase`、`message`、`level?`、`metadata?`、`error?` |
| `audit_end_trace` | 结束追踪并落盘 | `traceId`、`outcome?`（completed/failed） |
| `audit_get_trail` | 实时查询最近轨迹（内存） | `traceId`、`phase?`、`level?`、`limit?` |
| `audit_export_report` | 按需导出报告（JSONL 持久层） | `eventId?`、`traceId?`（至少一个） |

阶段 `phase`：`INPUT_SNAPSHOT` / `REASONING` / `DECISION` / `EXECUTION` / `VERIFICATION`
级别 `level`：`debug` / `info` / `warn` / `error`

## 三、按需导出报告（重点）

场景：JSONL 原始日志人看不懂，只要某一次事件或某一条任务链路的可读报告。

- **导单个事件**：`audit_export_report` 传 `eventId` → 返回单事件 Markdown 报告（事件 ID、traceId、阶段、级别、时间、消息、metadata）。
- **导整条时间线**：传 `traceId` → 返回时间线报告（事件总数、首末时间、按时间排序的事件表格）。
- **优先级**：同时传两者时 `eventId` 优先；`eventId` 未命中会自动回退到 `traceId`。
- **找不到**：返回 `AUDIT_NOT_FOUND`；**都没传**：返回 `AUDIT_INVALID_EVENT`。
- **数据源**：JSONL 持久层（跨会话、跨重启），按天文件与分片文件都会扫描。
- **性能**：按最新文件优先查找，`eventId` 命中即停止扫描。

### 对 Agent 说的话（示例）

- "导出 eventId=019f... 这个事件的报告"
- "把 traceId=019f... 这条任务的日志整理成报告给我"
- "刚才那次修复，导出报告"

## 四、日志存在哪

- 默认目录：`./audit-events.jsonl/`（相对打开项目的根目录）。
- 文件名：按天 `audit-YYYY-MM-DD.jsonl`；单文件超过 10MB 自动分片 `audit-YYYY-MM-DD.1.jsonl`。
- 保留策略：7 天，过期文件自动清理。
- 每行一条 JSON 事件，字段：`eventId / traceId / timestamp / phase / level / message / metadata / error?`。
- 想直接看原始日志：用任意编辑器打开目录里的 jsonl 文件即可。

## 五、配置

优先级（低 → 高）：默认值 → `.agent-audit.json` → 环境变量 `AGENT_AUDIT_*` → CLI 参数。

| 变量 | 作用 | 示例 |
| --- | --- | --- |
| `AGENT_AUDIT_SINK` | 落盘目标（JSON 数组） | `[{"type":"jsonl","filePath":"./audit-events.jsonl"}]` |
| `AGENT_AUDIT_LOG_LEVEL` | 服务日志级别 | `info` |
| `AGENT_AUDIT_BUFFER_SIZE` | 内存缓冲条数 | `1000` |
| `AGENT_AUDIT_FLUSH_INTERVAL` | 自动落盘间隔（毫秒） | `5000` |
| `AGENT_AUDIT_FLUSH_THRESHOLD` | 攒多少条立即落盘 | `100` |
| `AGENT_AUDIT_REDACT_FIELDS` | 脱敏字段名（预留） | `apiKey,token,password` |
| `AGENT_AUDIT_NOTIFICATIONS` | 是否发 MCP 通知 | `true` / `false` |
| `AGENT_AUDIT_TRANSPORT` | 传输方式（仅 stdio） | `stdio` |

### 配置文件 `.agent-audit.json`

```json
{
  "logLevel": "info",
  "buffer": { "maxSize": 2000 },
  "flush": { "intervalMs": 3000, "sizeThreshold": 50 },
  "writers": [{ "type": "jsonl", "filePath": "./audit-events.jsonl" }],
  "notifications": { "enabled": true, "minLevel": "warn" }
}
```

### CLI

```bash
node dist/src/cli.js --log-level info --config ./agent-audit.config.json
```

## 六、SDK（写代码接入）

```ts
import { wrapAgent } from "@agent-audit/sdk"

const { tools, closeAudit } = wrapAgent({
  tools: myAgentTools,            // 你的 Agent 工具列表
  serverUrl: "stdio",             // 或 MCP 地址
  taskIntent: "修复登录接口 400"
})
// tools 已被包装：成功调用自动记录 EXECUTION/info，失败记录 EXECUTION/error
await closeAudit()                // 结束审计并落盘
```

- 审计 Server 不可用时**静默降级**：记录失败返回 null、不抛错，业务零影响。

## 七、三通道输出

1. **JSONL 文件**：永久留痕（按天/分片/7 天保留）。
2. **MCP 通知**：`DECISION` 阶段或 `warn` 及以上级别事件推送 `notifications/message`。
3. **stderr 告警**：写盘失败、通知失败等服务级异常输出到 stderr。

## 八、常见问题

| 问题 | 解答 |
| --- | --- |
| 工具列表里看不到 `audit_*` | 重启 Codex；确认 `~/.codex/config.toml` 的 `[mcp_servers.agent-audit]` 存在 |
| 导出报告提示 `AUDIT_NOT_FOUND` | 确认 eventId/traceId 拼写；确认 JSONL 目录里有对应文件（未 endTrace 的事件可能还没落盘） |
| 日志文件没内容 | 事件要等 endTrace / shutdown / 达到阈值（默认 100 条）或间隔（默认 5 秒）才落盘 |
| `audit_get_trail` 查不到旧事件 | 内存缓冲只保留最近 1000 条（drop-oldest）；全量请用 `audit_export_report` |
| 不想记录某次任务 | 不调用 `audit_start_trace` 即可；想全局关闭则移除 MCP 配置 |
| 敏感字段脱敏 | `redaction.fields` 已预留，脱敏逻辑尚未实现，注意别把密钥写进 metadata |

## 九、当前限制

- 传输仅支持 `stdio`（本地开发/单机使用）。
- `redaction` 脱敏尚未实现（schema 已保留字段）。
- 未发布 npm（本地构建 `npm run build` 后使用）。

## 十、开发命令

```bash
npm run lint       # ESLint（2 空格、无分号、禁 Sync、行数限制）
npm run typecheck  # tsc --noEmit
npm run build      # 构建到 dist/
npm test           # node:test，共 77 个测试
```
