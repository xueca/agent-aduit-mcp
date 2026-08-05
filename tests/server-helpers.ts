// 集成测试公共工具：创建 in-memory 测试环境与工具响应解析
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { DEFAULT_CONFIG } from '../src/config/defaults.js'
import type { AgentAuditConfig } from '../src/config/schema.js'
import type { AuditService } from '../src/core/audit-service.js'
import { createAuditServer } from '../src/server.js'

export interface TestContext {
  client: Client
  server: McpServer
  service: AuditService
  dir: string
}

export interface ToolResponse {
  content: Array<{ type: string; text?: string }>
  isError?: boolean
}

export type CallToolOutcome = ToolResponse | { toolResult?: unknown }

export const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function setup(): Promise<TestContext> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-test-'))
  const config: AgentAuditConfig = {
    ...DEFAULT_CONFIG,
    writers: [{ type: 'jsonl', filePath: dir }],
    flush: { ...DEFAULT_CONFIG.flush, intervalMs: 999999, sizeThreshold: 100 }
  }
  const bundle = await createAuditServer(config)
  const pair = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'audit-test-client', version: '0.1.0' })
  await Promise.all([client.connect(pair[0]), bundle.server.connect(pair[1])])
  return { client, server: bundle.server, service: bundle.service, dir }
}

export async function cleanup(ctx: TestContext): Promise<void> {
  await ctx.service.shutdown()
  await ctx.server.close()
  await ctx.client.close()
  await fs.rm(ctx.dir, { recursive: true, force: true })
}

export async function callToolOk(
  ctx: TestContext,
  name: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const response = await ctx.client.callTool({ name, arguments: args })
  return parseBody(response)
}

export function readText(response: CallToolOutcome): string {
  if (!('content' in response)) {
    throw new Error('工具响应缺少 content')
  }
  const content = response.content[0]
  if (content !== undefined && content.type === 'text' && content.text !== undefined) {
    return content.text
  }
  throw new Error('工具响应不是 text 类型')
}

export function parseBody(response: CallToolOutcome): Record<string, unknown> {
  const parsed = JSON.parse(readText(response))
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error('工具响应不是 JSON 对象')
  }
  return parsed as Record<string, unknown>
}

export async function waitFor(check: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() >= deadline) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

export function dateKey(date: Date): string {
  const yearRaw = String(date.getFullYear())
  const year = yearRaw.padStart(4, '0')
  const monthRaw = String(date.getMonth() + 1)
  const month = monthRaw.padStart(2, '0')
  const dayRaw = String(date.getDate())
  const day = dayRaw.padStart(2, '0')
  return `${year}-${month}-${day}`
}
