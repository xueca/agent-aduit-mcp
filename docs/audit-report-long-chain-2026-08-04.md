# agent-audit-mcp 长链式调用审计与修复报告（2026-08-04）

## 1. 审计方法

- 双子 Agent 独立全量扫描（Curie / Singer），交叉核对命中清单，两轮排查
- 规范依据：《核心代码规范速查》红线 2（严禁 `().()` 长链调用，2 层链也记录）
- 范围：仅 `my-mcp-server/agent-audit-mcp`，包外目录未检查、未修改
- 豁免口径（用户确认）：Zod fluent 声明链（如 `z.string().min(1)`）属 DSL 惯用法，不计违规

## 2. 修复前命中统计

| Agent | 文件数 | 总命中 | 高危(≥3层) | 中危(2层) | 提示(多行链) |
| --- | --- | --- | --- | --- | --- |
| Curie | 19 | 87 | 8 | 63 | 16 |
| Singer | 52 | 83 | 8 | 67 | 8 |

- 双方一致：8 处高危全部为 Zod fluent 声明链；真实业务链约 19 处（全部为 2~3 层）
- 零命中：规则 3（JSON 深拷贝）、4（下标直接操作，src 为 0）、5（超行）、6（Sync）、8（分号/缩进/命名）

## 3. 修复清单（19 处 / 13 文件）

| 文件 | 位置 | 修复前 | 修复后 |
| --- | --- | --- | --- |
| `src/utils/id.ts` | L13 | `[...bytes].map((b) => b.toString(16).padStart(2,'0')).join('')` | `for...of` 循环 + `hexPairs.push(hexRaw.padStart(2,'0'))` + `hexPairs.join('')` |
| `src/utils/time.ts` | L3 | `new Date().toISOString()` | `const now = new Date()` + `now.toISOString()` |
| `src/config/env.ts` | L61 | `raw.split(',').map(...)` | `rawFields = raw.split(',')` + `rawFields.map(...)` |
| `src/report/report-builder.ts` | L13 | `auditFiles.sort().reverse()` | `auditFiles.sort()` + `auditFiles.reverse()` |
| `src/writers/jsonl-writer.ts` | L93-95 | `String(...).padStart(...)` ×3 | `xxxRaw` 中间变量 ×3（year/month/day） |
| `src/cli.ts` | L89 | `main().catch(...)` | `const mainPromise = main()` + `mainPromise.catch(...)` |
| `sdk/client.ts` | L112 | `Promise.race([call,guard]).finally(...)` | `const raced = Promise.race(...)` + `raced.finally(...)` |
| `sdk/instrumentation.ts` | L39 | `import(...).then(...)` | `const modulePromise = import(...)` + `modulePromise.then(...)` |
| `examples/standalone-usage.ts` | L43 | `main().catch(...)` | mainPromise 拆分 |
| `examples/with-code-guardian.ts` | L70 | `main().catch(...)` | mainPromise 拆分 |
| `tests/server-helpers.ts` | L89-91 | `String(...).padStart(...)` ×3 | `xxxRaw` 中间变量 ×3 |
| `tests/sdk-integration.test.ts` | L51-56 | `String(...).padStart(...)` ×2 + `content.split('\n').filter(...)` | `xxxRaw` ×2 + `rawLines` 拆分 |
| `tests/server.test.ts` | L134 | `content.split('\n').filter(...)` | `rawLines` 拆分 |

## 4. 修复后验证（审查 Agent C 独立复核）

- 残留扫描：19 处模式全部消除；额外全量扫描无遗漏真实业务链；Zod fluent 链按豁免口径保留
- `npm run lint`：0 errors
- `npm run typecheck`：通过（0 错误）
- `npm test`：77/77 通过，与基线一致，零回归
- 风格：无分号、2 空格缩进、camelCase、未新增/修改注释、文件 ≤150 行、函数 ≤30 行
- 范围：13 个改动文件全部位于 `agent-audit-mcp` 内

## 5. 范围核验与遗留说明

- `my-mcp-server/index.js` 已暂存改动：文件时间戳 2026/7/26，早于本任务，非本次 Agent 产生，未触碰
- `my-mcp-server/code-guardian` gitlink dirty：独立嵌套仓库状态，与本任务无关，未查看
- `agent-audit-mcp-temp/`：本次会话遗留的空 git 仓库（仅 `.git`），已清理删除
- `audit-events.jsonl/`：agent-audit MCP 运行时数据（审计事件落盘），非代码；如不希望入库建议在根 `.gitignore` 增加，本次未修改根 `.gitignore`

## 6. 结论

真实业务长链 19 处全部消除，lint/typecheck/77 测试全绿，验收通过。


## 7. agent-audit MCP 审计事件记录（本次修复流程）

- traceId：`019fcd64-5e2f-7e25-901b-37314b316706`
- 事件 5 条：INPUT_SNAPSHOT（双 Agent 审计）→ INPUT_SNAPSHOT（基线）→ DECISION（Zod 豁免口径）→ EXECUTION（13 文件 19 处拆分）→ VERIFICATION（独立审查通过）
- outcome：completed（audit_end_trace 正常收尾，`audit_export_report` 导出成功）
- 落盘：`my-mcp-server/agent-audit-mcp/audit-events.jsonl/`（运行时数据，非代码）

## 8. 收尾修正记录

- 恢复 7 个文件（instrumentation.ts、cli.ts、env.ts、time.ts、jsonl-writer.ts、server-helpers.ts、server.test.ts）被编辑工具剥除的 UTF-8 BOM，diff 仅含预期改动（首行注释无伪差异）
- 修复 `agent-audit-mcp/.gitignore` 行首空格导致的规则失效问题（如 `audit-events.jsonl/`、`node_modules/`、`dist/`），验证 `git check-ignore` 命中
- 清理会话遗留的空 git 仓库目录 `agent-audit-mcp-temp/`
- 最终验证：lint 0 errors、typecheck 通过、npm test 77/77 通过
