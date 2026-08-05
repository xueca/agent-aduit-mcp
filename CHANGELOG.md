# Changelog

本项目的所有重要变更均记录在此文件中，格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.1.0] - 2026-08-04

首个可发布版本：完成协议级行为审计 MCP Server 全部主体能力，67 个测试全绿，lint / build / typecheck 0 error。

### 第一批：基础骨架（17 个测试，当时口径）

- 项目脚手架：TypeScript（`module: NodeNext`）+ ESLint 工程配置。
- 数据模型 `models`：AgentLogEvent / TraceSession / BlueprintRecord，全部经 zod 校验。
- `RingBuffer`：有界环形缓冲（默认 1000 条，`drop-oldest`）。
- `JsonlWriter`：按天分片 JSONL 落盘，10MB 轮转，7 天保留。
- `CompositeWriter`：多 Writer 聚合写入，部分失败可聚合报错。

### 第二批：MCP Server 核心（新增约 38 个测试）

- MCP Server 装配：`createAuditServer` + stdio 传输。
- 4 个 MCP 工具：`audit_start_trace` / `audit_record_event` / `audit_end_trace` / `audit_get_trail`。
- 四级配置：默认值 → `.agent-audit.json` → 环境变量 `AGENT_AUDIT_*` → CLI 参数（`--log-level` / `--config`）。
- 通知模块 `McpNotifier`：`notifications/message`，DECISION 阶段或 warn 及以上级别触发。
- `TraceStore`：trace 生命周期管理与内存事件存储。
- `AuditService`：事件记录、批量落盘、定时 flush、stderr 告警。

### 第三批：SDK 自动注入（新增 12 个测试，累计 67 个）

- SDK：`createAuditClient` / `wrapAgent` / `closeAudit`，审计不可用时静默降级为 no-op。
- 示例 `examples/standalone-usage.ts`：不依赖 Code Guardian 的独立接入演示。
- 文档 `docs/cg-integration.md`：Code Guardian 集成映射与编排流程。
- 工程接线：`package.json` exports 增加 `./sdk` 子路径导出。

### 第五批：audit_export_report 报告导出（新增 6 个测试，累计 77 个）

- 新工具 `audit_export_report`：按 `eventId` 导出单事件报告，或按 `traceId` 导出整条时间线 Markdown 报告。
- 报告数据源为 JSONL 持久层（含 `audit-YYYY-MM-DD.N.jsonl` 分片），跨会话可查。
- 新增错误码 `AUDIT_NOT_FOUND`；未提供筛选参数时返回 `AUDIT_INVALID_EVENT`。
- 接线：`registerTools` 接收 JSONL 存储目录列表，`server.ts` 自动收集 jsonl writer 目录。