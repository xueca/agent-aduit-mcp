import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { DEFAULT_CONFIG } from '../src/config/defaults.js'
import { AgentAuditConfigSchema } from '../src/config/schema.js'
import { parseEnvConfig } from '../src/config/env.js'
import { loadConfig } from '../src/config/loader.js'
import { AUDIT_ERROR_CODES, AuditError } from '../src/errors/audit-error.js'

test('DEFAULT_CONFIG 与架构默认值一致', () => {
  assert.equal(DEFAULT_CONFIG.transport, 'stdio')
  assert.equal(DEFAULT_CONFIG.logLevel, 'info')
  assert.equal(DEFAULT_CONFIG.buffer.maxSize, 1000)
  assert.equal(DEFAULT_CONFIG.buffer.overflowStrategy, 'drop-oldest')
  assert.equal(DEFAULT_CONFIG.flush.intervalMs, 5000)
  assert.equal(DEFAULT_CONFIG.flush.sizeThreshold, 100)
  assert.deepEqual(DEFAULT_CONFIG.writers, [{ type: 'jsonl', filePath: './audit-events.jsonl' }])
  assert.deepEqual(DEFAULT_CONFIG.redaction.fields, ['apiKey', 'token', 'password', 'secret'])
  assert.deepEqual(DEFAULT_CONFIG.notifications, { enabled: true, minLevel: 'warn' })
  assert.equal(DEFAULT_CONFIG.storage, 'jsonl')
})

test('parseEnvConfig 逐变量映射', () => {
  const result = parseEnvConfig({
    AGENT_AUDIT_TRANSPORT: 'stdio',
    AGENT_AUDIT_LOG_LEVEL: 'debug',
    AGENT_AUDIT_BUFFER_SIZE: '500',
    AGENT_AUDIT_FLUSH_INTERVAL: '2000',
    AGENT_AUDIT_FLUSH_THRESHOLD: '50',
    AGENT_AUDIT_SINK: JSON.stringify([{ type: 'jsonl', filePath: './custom.jsonl' }]),
    AGENT_AUDIT_REDACT_FIELDS: 'apiKey, token, password',
    AGENT_AUDIT_NOTIFICATIONS: 'false'
  })
  assert.equal(result.transport, 'stdio')
  assert.equal(result.logLevel, 'debug')
  assert.equal(result.buffer?.maxSize, 500)
  assert.equal(result.flush?.intervalMs, 2000)
  assert.equal(result.flush?.sizeThreshold, 50)
  assert.deepEqual(result.writers, [{ type: 'jsonl', filePath: './custom.jsonl' }])
  assert.deepEqual(result.redaction?.fields, ['apiKey', 'token', 'password'])
  assert.equal(result.notifications?.enabled, false)
})

test('parseEnvConfig 忽略未设置的变量', () => {
  const result = parseEnvConfig({})
  assert.deepEqual(result, {})
})

test('非法环境变量抛出 CONFIG_INVALID', () => {
  const cases = [
    { AGENT_AUDIT_BUFFER_SIZE: 'abc' },
    { AGENT_AUDIT_SINK: 'bad' },
    { AGENT_AUDIT_NOTIFICATIONS: 'yes' }
  ]
  for (const env of cases) {
    assert.throws(() => parseEnvConfig(env), (error) => {
      assert.ok(error instanceof AuditError)
      assert.equal(error.code, AUDIT_ERROR_CODES.CONFIG_INVALID)
      return true
    })
  }
})

test('loadConfig 优先级：默认 < 文件 < 环境变量 < overrides', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-cfg-'))
  try {
    const configPath = path.join(tempDir, '.agent-audit.json')
    await fs.writeFile(configPath, JSON.stringify({ logLevel: 'debug' }), 'utf8')
    const config = await loadConfig({
      env: { AGENT_AUDIT_LOG_LEVEL: 'warn' },
      cwd: tempDir,
      overrides: { logLevel: 'error' }
    })
    assert.equal(config.logLevel, 'error')
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test('loadConfig 支持自定义 configPath', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-cfg-'))
  try {
    const customPath = path.join(tempDir, 'custom-config.json')
    await fs.writeFile(customPath, JSON.stringify({ buffer: { maxSize: 42 } }), 'utf8')
    const config = await loadConfig({ env: {}, configPath: customPath })
    assert.equal(config.buffer.maxSize, 42)
    assert.equal(config.buffer.overflowStrategy, 'drop-oldest')
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test('无配置文件时使用默认值', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-cfg-'))
  try {
    const config = await loadConfig({ env: {}, cwd: tempDir })
    assert.equal(config.logLevel, 'info')
    assert.equal(config.flush.intervalMs, 5000)
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test('配置文件 JSON 非法时抛 CONFIG_INVALID', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-cfg-'))
  try {
    const configPath = path.join(tempDir, '.agent-audit.json')
    await fs.writeFile(configPath, '{not json', 'utf8')
    await assert.rejects(loadConfig({ env: {}, cwd: tempDir }), (error) => {
      assert.ok(error instanceof AuditError)
      assert.equal(error.code, AUDIT_ERROR_CODES.CONFIG_INVALID)
      return true
    })
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})
test('flush.retry 架构解析与 AGENT_AUDIT_FLUSH_RETRY 环境变量', () => {
  const parsed = AgentAuditConfigSchema.parse({})
  assert.equal(parsed.flush.pendingLimit, undefined)
  assert.equal(parsed.flush.retry, undefined)
  const result = parseEnvConfig({ AGENT_AUDIT_FLUSH_RETRY: '5' })
  assert.deepEqual(result.flush?.retry, { maxAttempts: 5 })
})

test('loadConfig 应用 AGENT_AUDIT_FLUSH_RETRY 且 retry 子字段取默认', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-cfg-'))
  try {
    const config = await loadConfig({ env: { AGENT_AUDIT_FLUSH_RETRY: '2' }, cwd: tempDir })
    assert.deepEqual(config.flush.retry, { maxAttempts: 2, baseDelayMs: 100, backoffFactor: 3 })
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})
