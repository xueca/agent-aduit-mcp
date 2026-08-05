// 报告构建：从 JSONL 事件生成人类可读的 Markdown 报告
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import type { AgentLogEvent } from '../models/event.js'

function isAuditFile(fileName: string): boolean {
  return fileName.startsWith('audit-') && fileName.endsWith('.jsonl')
}

async function sortedAuditFiles(dir: string): Promise<string[]> {
  const fileNames = await fs.readdir(dir)
  const auditFiles = fileNames.filter(isAuditFile)
  auditFiles.sort()
  auditFiles.reverse()
  return auditFiles
}

export async function findEventById(dir: string, eventId: string): Promise<AgentLogEvent | undefined> {
  const fileNames = await sortedAuditFiles(dir)
  for (const fileName of fileNames) {
    const content = await fs.readFile(path.join(dir, fileName), 'utf8')
    const lines = content.split('\n')
    for (const line of lines) {
      if (line.trim().length === 0) {
        continue
      }
      try {
        const parsed = JSON.parse(line) as AgentLogEvent
        if (parsed.eventId === eventId) {
          return parsed
        }
      } catch {
        // 跳过无法解析的行
      }
    }
  }
  return undefined
}

export async function findEventsByTraceId(dir: string, traceId: string): Promise<AgentLogEvent[]> {
  const events: AgentLogEvent[] = []
  const fileNames = await sortedAuditFiles(dir)
  for (const fileName of fileNames) {
    const content = await fs.readFile(path.join(dir, fileName), 'utf8')
    const lines = content.split('\n')
    for (const line of lines) {
      if (line.trim().length === 0) {
        continue
      }
      try {
        const parsed = JSON.parse(line) as AgentLogEvent
        if (parsed.traceId === traceId) {
          events.push(parsed)
        }
      } catch {
        // 跳过无法解析的行
      }
    }
  }
  return events
}

export function buildEventReport(event: AgentLogEvent): string {
  const lines: string[] = []
  lines.push('# 审计事件报告')
  lines.push('')
  lines.push(`- **eventId**: \`${event.eventId}\``)
  lines.push(`- **traceId**: \`${event.traceId}\``)
  lines.push(`- **阶段**: ${event.phase}`)
  lines.push(`- **级别**: ${event.level}`)
  lines.push(`- **时间**: ${event.timestamp}`)
  lines.push(`- **消息**: ${event.message}`)
  lines.push(`- **metadata**: \`${JSON.stringify(event.metadata)}\``)
  if (event.error !== undefined) {
    lines.push(`- **error**: \`${JSON.stringify(event.error)}\``)
  }
  return lines.join('\n')
}

export function buildTraceReport(events: AgentLogEvent[]): string {
  const sorted = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const lines: string[] = []
  lines.push('# 审计时间线报告')
  lines.push('')
  lines.push(`- **traceId**: \`${first?.traceId ?? ''}\``)
  lines.push(`- **事件总数**: ${sorted.length}`)
  if (first !== undefined && last !== undefined) {
    lines.push(`- **首事件时间**: ${first.timestamp}`)
    lines.push(`- **末事件时间**: ${last.timestamp}`)
  }
  lines.push('')
  lines.push('| # | 时间 | 阶段 | 级别 | 消息 |')
  lines.push('| --- | --- | --- | --- | --- |')
  for (let i = 0; i < sorted.length; i += 1) {
    const item = sorted[i]
    lines.push(`| ${i + 1} | ${item.timestamp} | ${item.phase} | ${item.level} | ${item.message} |`)
  }
  return lines.join('\n')
}
