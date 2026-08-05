// 配置加载：默认值 -> 配置文件 -> 环境变量 -> overrides，深合并后按架构校验
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { AUDIT_ERROR_CODES, AuditError } from '../errors/audit-error.js'
import { AgentAuditConfigSchema } from './schema.js'
import type { AgentAuditConfig } from './schema.js'
import { DEFAULT_CONFIG } from './defaults.js'
import { parseEnvConfig } from './env.js'

export interface LoadConfigOptions {
  env: Record<string, string | undefined>
  cwd?: string
  configPath?: string
  overrides?: Partial<AgentAuditConfig>
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function deepMerge(base: unknown, extra: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(extra)) {
    return extra
  }
  const result: Record<string, unknown> = { ...base }
  for (const key of Object.keys(extra)) {
    const extraValue = extra[key]
    if (extraValue === undefined) {
      continue
    }
    const baseValue = base[key]
    if (isPlainObject(baseValue) && isPlainObject(extraValue)) {
      result[key] = deepMerge(baseValue, extraValue)
    } else {
      result[key] = extraValue
    }
  }
  return result
}

async function readConfigFile(configPath: string): Promise<unknown> {
  let content: string
  try {
    content = await fs.readFile(configPath, 'utf8')
  } catch (error) {
    const errno = error as { code?: string }
    if (errno.code === 'ENOENT') {
      return undefined
    }
    throw new AuditError(AUDIT_ERROR_CODES.CONFIG_INVALID, `读取配置文件失败: ${configPath}`)
  }
  try {
    return JSON.parse(content)
  } catch {
    throw new AuditError(AUDIT_ERROR_CODES.CONFIG_INVALID, `配置文件 JSON 非法: ${configPath}`)
  }
}

export async function loadConfig(options: LoadConfigOptions): Promise<AgentAuditConfig> {
  const { env, cwd = process.cwd(), configPath, overrides = {} } = options

  let merged: unknown = structuredClone(DEFAULT_CONFIG)
  const fileConfig = await readConfigFile(configPath ?? path.join(cwd, '.agent-audit.json'))
  merged = deepMerge(merged, fileConfig ?? {})
  merged = deepMerge(merged, parseEnvConfig(env))
  merged = deepMerge(merged, overrides)

  const parsed = AgentAuditConfigSchema.safeParse(merged)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new AuditError(AUDIT_ERROR_CODES.CONFIG_INVALID, issue !== undefined ? issue.message : '配置非法')
  }
  return parsed.data
}