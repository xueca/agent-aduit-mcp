// 默认配置：由架构解析空对象得到
import { AgentAuditConfigSchema } from './schema.js'
import type { AgentAuditConfig } from './schema.js'

export const DEFAULT_CONFIG: AgentAuditConfig = AgentAuditConfigSchema.parse({})