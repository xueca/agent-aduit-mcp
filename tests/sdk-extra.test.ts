// SDK 单测（createAuditClient）：transportFactory 抛错与 enabled:false 的降级路径
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { createAuditClient } from '../sdk/index.js'

test('transportFactory 抛错时 startTrace/record/endTrace 返回 null 且不抛', async () => {
  const client = createAuditClient({
    agentName: 'my-agent',
    transportFactory: () => {
      throw new Error('传输创建失败')
    }
  })
  const traceId = await client.startTrace({ taskIntent: '修复问题' })
  assert.equal(traceId, null)
  const record = await client.record({ phase: 'EXECUTION', message: '调用工具 fix' })
  assert.equal(record, null)
  const end = await client.endTrace({ traceId: 't-1', outcome: 'completed' })
  assert.equal(end, null)
  await client.close()
})

test('enabled false 时全部方法返回 null 且 transportFactory 不被调用', async () => {
  let factoryCalls = 0
  const client = createAuditClient({
    agentName: 'my-agent',
    enabled: false,
    transportFactory: () => {
      factoryCalls += 1
      throw new Error('不应被调用')
    }
  })
  const traceId = await client.startTrace({})
  const record = await client.record({ phase: 'EXECUTION', message: 'x' })
  const end = await client.endTrace({ traceId: 't', outcome: 'failed' })
  assert.equal(traceId, null)
  assert.equal(record, null)
  assert.equal(end, null)
  await client.close()
  assert.equal(factoryCalls, 0)
})

test('首次失败后保持降级不重试', async () => {
  let factoryCalls = 0
  const client = createAuditClient({
    agentName: 'my-agent',
    transportFactory: () => {
      factoryCalls += 1
      throw new Error('传输创建失败')
    }
  })
  const first = await client.startTrace({})
  const second = await client.startTrace({})
  const record = await client.record({ phase: 'EXECUTION', message: 'x' })
  assert.equal(first, null)
  assert.equal(second, null)
  assert.equal(record, null)
  assert.equal(factoryCalls, 1)
})

test('connect 超时后返回 null 且 transport 被关闭（无子进程残留）', async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['-e', 'setInterval(() => {}, 60000)']
  })
  const client = createAuditClient({
    agentName: 'my-agent',
    timeoutMs: 300,
    transportFactory: () => transport
  })
  const startedAt = Date.now()
  const traceId = await client.startTrace({ taskIntent: 'x' })
  const elapsed = Date.now() - startedAt
  assert.equal(traceId, null)
  assert.ok(elapsed < 5000, 'connect 应在超时内返回，实际耗时 ' + elapsed + 'ms')
  await client.close()
  const internal = transport as unknown as { _process?: unknown }
  assert.equal(internal._process, undefined, 'transport.close() 后子进程应被释放')
})

test('冷却期过后可重连而非永久禁用', async () => {
  let factoryCalls = 0
  const client = createAuditClient({
    agentName: 'my-agent',
    cooldownMs: 50,
    transportFactory: () => {
      factoryCalls += 1
      throw new Error('传输创建失败')
    }
  })
  const first = await client.startTrace({})
  assert.equal(first, null)
  assert.equal(factoryCalls, 1)
  await new Promise((resolve) => setTimeout(resolve, 80))
  const second = await client.startTrace({})
  assert.equal(second, null)
  assert.equal(factoryCalls, 2)
  await client.close()
})
