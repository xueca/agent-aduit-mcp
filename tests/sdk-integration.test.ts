// SDK 集成测试：createAuditClient / wrapAgent 与真实审计 Server 全链路（InMemoryTransport）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createAuditClient, wrapAgent } from '../sdk/index.js'
import type { AuditClient, AuditClientOptions } from '../sdk/types.js'
import { DEFAULT_CONFIG } from '../src/config/defaults.js'
import type { AgentAuditConfig } from '../src/config/schema.js'
import type { AuditService } from '../src/core/audit-service.js'
import { createAuditServer } from '../src/server.js'

interface TestEnv {
  server: McpServer
  service: AuditService
  dir: string
  client: AuditClient
}

// 建临时目录 + 真实审计 Server + 共享 SDK client（InMemory 全链路）
async function createEnv(clientOptions?: Partial<AuditClientOptions>): Promise<TestEnv> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-sdk-'))
  const config: AgentAuditConfig = {
    ...DEFAULT_CONFIG,
    writers: [{ type: 'jsonl', filePath: dir }],
    flush: { intervalMs: 999999, sizeThreshold: 100 }
  }
  const bundle = await createAuditServer(config)
  const pair = InMemoryTransport.createLinkedPair()
  await bundle.server.connect(pair[1])
  const client = createAuditClient({
    agentName: 'test-agent',
    taskIntent: '集成测试',
    transportFactory: () => pair[0],
    ...clientOptions
  })
  return { server: bundle.server, service: bundle.service, dir, client }
}

// 清理：client / service / server 依次关闭，最后删除临时目录
async function disposeEnv(env: TestEnv): Promise<void> {
  await env.client.close()
  await env.service.shutdown()
  await env.server.close()
  await fs.rm(env.dir, { recursive: true, force: true })
}

// 读取当天 audit-YYYY-MM-DD.jsonl 的非空行（fs/promises，禁 readFileSync）
async function readTodayLines(dir: string): Promise<string[]> {
  const now = new Date()
  const monthRaw = String(now.getMonth() + 1)
  const month = monthRaw.padStart(2, '0')
  const dayRaw = String(now.getDate())
  const day = dayRaw.padStart(2, '0')
  const dateKey = `${now.getFullYear()}-${month}-${day}`
  const filePath = path.join(dir, `audit-${dateKey}.jsonl`)
  const content = await fs.readFile(filePath, 'utf8')
  const rawLines = content.split('\n')
  return rawLines.filter((line) => line.length > 0)
}

test('全链路：startTrace -> record -> endTrace 落盘一条 EXECUTION', async (t) => {
  const env = await createEnv()
  t.after(() => disposeEnv(env))
  const traceId = await env.client.startTrace()
  assert.equal(typeof traceId, 'string')
  await env.client.record({ phase: 'EXECUTION', message: '执行修复', metadata: { toolName: 'fix' } })
  await env.client.endTrace({ traceId: traceId as string, outcome: 'completed' })
  const lines = await readTodayLines(env.dir)
  assert.equal(lines.length, 1)
  const [line] = lines
  assert.ok(line !== undefined)
  assert.ok(line.includes('"phase":"EXECUTION"'))
})

test('wrapAgent 集成：包装后工具调用自动落 EXECUTION 事件', async (t) => {
  const env = await createEnv()
  t.after(() => disposeEnv(env))
  const agent = {
    name: 'test-agent',
    tools: {
      fix: async (args: unknown) => ({ ok: true })
    }
  }
  // 传入共享 client，避免同一 InMemory 传输被二次连接
  const wrapped = wrapAgent(agent, { agentName: 'test-agent' }, env.client)
  const traceId = await env.client.startTrace()
  await wrapped.tools.fix({})
  await env.client.endTrace({ traceId: traceId as string, outcome: 'completed' })
  const lines = await readTodayLines(env.dir)
  assert.equal(lines.length, 1)
  const [line] = lines
  assert.ok(line !== undefined)
  assert.ok(line.includes('fix'))
})

test('降级：transportFactory 抛错时全部方法静默返回', async () => {
  const client = createAuditClient({
    agentName: 'x',
    transportFactory: () => {
      throw new Error('boom')
    }
  })
  const traceId = await client.startTrace()
  assert.equal(traceId, null)
  await client.record({ phase: 'EXECUTION', message: 'x' })
  const endResult = await client.endTrace({ traceId: 'no-trace', outcome: 'completed' })
  assert.equal(endResult, null)
  await client.close()
})

test('enabled:false：startTrace 返回 null 且 transportFactory 不被调用', async () => {
  let factoryCalls = 0
  const client = createAuditClient({
    agentName: 'x',
    enabled: false,
    transportFactory: () => {
      factoryCalls += 1
      throw new Error('不应被调用')
    }
  })
  const traceId = await client.startTrace()
  assert.equal(traceId, null)
  assert.equal(factoryCalls, 0)
  await client.close()
})

test('回归：taskIntent 缺省时 startTrace 仍成功且落盘', async (t) => {
  const env = await createEnv({ taskIntent: undefined })
  t.after(() => disposeEnv(env))
  const traceId = await env.client.startTrace()
  assert.equal(typeof traceId, 'string')
  await env.client.record({ phase: 'EXECUTION', message: 'taskIntent 缺省回归' })
  await env.client.endTrace({ traceId: traceId as string, outcome: 'completed' })
  const lines = await readTodayLines(env.dir)
  assert.equal(lines.length, 1)
  const [line] = lines
  assert.ok(line !== undefined)
  assert.ok(line.includes('EXECUTION'))
})
