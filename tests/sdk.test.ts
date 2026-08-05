// SDK 单测（wrapAgent）：fake client 注入，验证包装、错误上报与降级行为
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { wrapAgent } from '../sdk/instrumentation.js'
import type { AgentShape, AuditClient, AuditRecordInput } from '../sdk/types.js'

// 记录调用序列的假客户端，可配置 record 抛错或返回 null
class FakeClient implements AuditClient {
  calls: Array<{ method: string; args: unknown }> = []
  failRecord = false
  recordReturnsNull = false

  async startTrace(input?: { agentName?: string; taskIntent?: string; context?: string }): Promise<string | null> {
    this.calls.push({ method: 'startTrace', args: input })
    return 'trace-fake'
  }

  async record(input: AuditRecordInput): Promise<unknown> {
    this.calls.push({ method: 'record', args: input })
    if (this.failRecord) {
      throw new Error('审计上报失败')
    }
    if (this.recordReturnsNull) {
      return null
    }
    return { ok: true }
  }

  async endTrace(input: { traceId: string; outcome: 'completed' | 'failed' }): Promise<unknown> {
    this.calls.push({ method: 'endTrace', args: input })
    return { ok: true }
  }

  async close(): Promise<void> {
    this.calls.push({ method: 'close', args: null })
  }
}

// 构造带单个 fix 工具的测试 Agent
function buildAgent(): AgentShape {
  return {
    name: '测试Agent',
    tools: {
      fix: async (args: unknown) => ({ ok: true, args })
    }
  }
}

test('wrapAgent 成功后记录一次 EXECUTION 事件并返回原结果', async () => {
  const fake = new FakeClient()
  const agent = buildAgent()
  const wrapped = wrapAgent(agent, { agentName: 'my-agent' }, fake)
  assert.equal(wrapped.name, '测试Agent')
  assert.notEqual(wrapped.tools, agent.tools)
  const result = await wrapped.tools.fix({ x: 1 })
  assert.deepEqual(result, { ok: true, args: { x: 1 } })
  assert.equal(fake.calls.length, 1)
  const record = fake.calls[0]
  assert.equal(record.method, 'record')
  const input = record.args as AuditRecordInput
  assert.equal(input.phase, 'EXECUTION')
  assert.equal(input.level, 'info')
  assert.match(input.message, /fix/)
  const metadata = input.metadata as Record<string, unknown>
  assert.equal(metadata.toolName, 'fix')
})

test('wrapAgent 包装多个工具且互不影响', async () => {
  const fake = new FakeClient()
  const agent: AgentShape = {
    tools: {
      read: async () => ({ data: 1 }),
      write: async () => ({ ok: true })
    }
  }
  const wrapped = wrapAgent(agent, { agentName: 'my-agent' }, fake)
  const first = await wrapped.tools.read({})
  const second = await wrapped.tools.write({})
  assert.deepEqual(first, { data: 1 })
  assert.deepEqual(second, { ok: true })
  assert.equal(fake.calls.length, 2)
  const records = fake.calls.map((call) => {
    const input = call.args as AuditRecordInput
    return input.metadata
  })
  assert.deepEqual(records, [{ toolName: 'read' }, { toolName: 'write' }])
})

test('handler 抛错时记录 error 事件并原样抛出', async () => {
  const fake = new FakeClient()
  const boom = new Error('工具内部错误')
  const agent: AgentShape = {
    tools: {
      fix: async () => {
        throw boom
      }
    }
  }
  const wrapped = wrapAgent(agent, { agentName: 'my-agent' }, fake)
  await assert.rejects(() => wrapped.tools.fix({}), (error: unknown) => error === boom)
  assert.equal(fake.calls.length, 1)
  const record = fake.calls[0]
  const input = record.args as AuditRecordInput
  assert.equal(input.level, 'error')
  assert.equal(input.error?.code, 'TOOL_ERROR')
  assert.equal(input.error?.message, '工具内部错误')
})

test('record 抛错时业务调用不受影响（降级不阻塞）', async () => {
  const fake = new FakeClient()
  fake.failRecord = true
  const wrapped = wrapAgent(buildAgent(), { agentName: 'my-agent' }, fake)
  const result = await wrapped.tools.fix({ x: 1 })
  assert.deepEqual(result, { ok: true, args: { x: 1 } })
})

test('record 返回 null 时业务调用不受影响（降级不阻塞）', async () => {
  const fake = new FakeClient()
  fake.recordReturnsNull = true
  const wrapped = wrapAgent(buildAgent(), { agentName: 'my-agent' }, fake)
  const result = await wrapped.tools.fix({ x: 1 })
  assert.deepEqual(result, { ok: true, args: { x: 1 } })
})

test('record 抛错时错误路径也不吞掉原错误', async () => {
  const fake = new FakeClient()
  fake.failRecord = true
  const boom = new Error('工具内部错误')
  const agent: AgentShape = {
    tools: {
      fix: async () => {
        throw boom
      }
    }
  }
  const wrapped = wrapAgent(agent, { agentName: 'my-agent' }, fake)
  await assert.rejects(() => wrapped.tools.fix({}), (error: unknown) => error === boom)
})

test('wrapAgent 返回 closeAudit 并关闭内部审计客户端', async () => {
  const fake = new FakeClient()
  const wrapped = wrapAgent(buildAgent(), { agentName: 'my-agent' }, fake)
  await wrapped.closeAudit?.()
  const last = fake.calls[fake.calls.length - 1]
  assert.ok(last !== undefined)
  assert.equal(last.method, 'close')
})
