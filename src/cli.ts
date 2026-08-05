#!/usr/bin/env node
// CLI 入口：解析参数、加载配置、连接 stdio 启动 MCP Server
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AgentAuditConfig } from './config/schema.js'
import { loadConfig } from './config/loader.js'
import { AUDIT_ERROR_CODES, AuditError } from './errors/audit-error.js'
import { LevelSchema } from './models/event.js'
import type { Level } from './models/event.js'
import { createAuditServer } from './server.js'
import type { AuditService } from './core/audit-service.js'

interface CliOptions {
  logLevel?: string
  configPath?: string
}

const USAGE_TEXT = [
  '用法: agent-audit [选项]',
  '',
  '选项:',
  '  --log-level <debug|info|warn|error>  设置服务日志级别',
  '  --config <path>      配置文件路径（JSON）',
  '  -h, --help           显示本帮助并退出'
].join('\n')

function printUsage(): void {
  process.stdout.write(USAGE_TEXT + '\n')
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      printUsage()
      process.exit(0)
    }
    if (arg === '--log-level' || arg === '--config') {
      const value = argv[i + 1]
      if (value === undefined) {
        throw new AuditError(AUDIT_ERROR_CODES.CONFIG_INVALID, '缺少参数值: ' + arg)
      }
      if (arg === '--log-level') {
        options.logLevel = value
      } else {
        options.configPath = value
      }
      i += 1
    }
  }
  return options
}

function validateLevel(level: string): Level {
  const result = LevelSchema.safeParse(level)
  if (!result.success) {
    throw new AuditError(AUDIT_ERROR_CODES.CONFIG_INVALID, '非法日志级别: ' + level)
  }
  return result.data
}

async function flushOnExit(service: AuditService): Promise<void> {
  try {
    await service.shutdown()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write('[agent-audit] 退出前落盘失败: ' + message + '\n')
  }
}

function attachExitHandlers(service: AuditService, server: McpServer): void {
  let stopping = false
  let flushed = false

  const shutdownService = (): Promise<void> => {
    if (flushed) {
      return Promise.resolve()
    }
    flushed = true
    return flushOnExit(service)
  }

  const stop = async (): Promise<void> => {
    if (stopping) {
      return
    }
    stopping = true
    await shutdownService()
    await server.close()
    process.exit(0)
  }

  process.on('beforeExit', () => {
    void shutdownService()
  })
  process.on('SIGINT', () => {
    void stop()
  })
  process.on('SIGTERM', () => {
    void stop()
  })
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const overrides: Partial<AgentAuditConfig> = {}
  if (options.logLevel !== undefined) {
    overrides.logLevel = validateLevel(options.logLevel)
  }
  const config = await loadConfig({ env: process.env, cwd: process.cwd(), configPath: options.configPath, overrides })
  const { server, service } = await createAuditServer(config)
  const transport = new StdioServerTransport()
  await server.connect(transport)
  attachExitHandlers(service, server)
}

const mainPromise = main()
mainPromise.catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write('[agent-audit] 启动失败: ' + message + '\n')
  process.exit(1)
})
