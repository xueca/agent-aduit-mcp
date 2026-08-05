// MCP Server 组装：由配置构建 writer/store/notifier/service 并注册工具
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AgentAuditConfig } from './config/schema.js'
import { AuditService } from './core/audit-service.js'
import { AUDIT_ERROR_CODES, AuditError } from './errors/audit-error.js'
import { McpNotifier } from './notifications/mcp-notifier.js'
import { TraceStore } from './storage/trace-store.js'
import { registerTools } from './tools/index.js'
import { CompositeWriter } from './writers/composite-writer.js'
import type { IWriter } from './writers/interface.js'
import { JsonlWriter } from './writers/jsonl-writer.js'

export interface AuditServerBundle {
  server: McpServer
  service: AuditService
}

export interface WriterRegistration {
  type: string
  filePath: string
}

export type WriterFactory = (item: WriterRegistration) => IWriter

const writerFactories = new Map<string, WriterFactory>([
  ['jsonl', (item) => new JsonlWriter({ filePath: item.filePath })]
])

export function registerWriter(type: string, factory: WriterFactory): void {
  if (type.length === 0) {
    throw new AuditError(AUDIT_ERROR_CODES.CONFIG_INVALID, 'writer 类型不能为空')
  }
  writerFactories.set(type, factory)
}

function buildWriters(items: AgentAuditConfig['writers']): IWriter[] {
  const writers: IWriter[] = []
  const seenPaths = new Set<string>()
  for (const item of items) {
    if (seenPaths.has(item.filePath)) {
      throw new AuditError(AUDIT_ERROR_CODES.CONFIG_INVALID, 'writer 路径重复: ' + item.filePath)
    }
    seenPaths.add(item.filePath)
    const factory = writerFactories.get(item.type)
    if (factory === undefined) {
      throw new AuditError(AUDIT_ERROR_CODES.CONFIG_INVALID, '不支持的 writer 类型: ' + item.type)
    }
    writers.push(factory(item))
  }
  return writers
}

export async function createAuditServer(config: AgentAuditConfig): Promise<AuditServerBundle> {
  const mcpServer = new McpServer(
    { name: 'agent-audit', version: '0.1.0' },
    { capabilities: { tools: {}, logging: {} } }
  )
  const writer = new CompositeWriter(buildWriters(config.writers))
  const store = new TraceStore({ maxBufferSize: config.buffer.maxSize })
  const notifier = new McpNotifier({
    server: mcpServer.server,
    enabled: config.notifications.enabled,
    minLevel: config.notifications.minLevel
  })
  const service = new AuditService({ config, store, writer, notifier })
  await service.initialize()
  const jsonlWriters = config.writers.filter((item) => item.type === 'jsonl')
  const storageDirs = jsonlWriters.map((item) => item.filePath)
  registerTools(mcpServer, service, storageDirs)
  return { server: mcpServer, service }
}
