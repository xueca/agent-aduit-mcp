import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import type { IWriter } from './interface.js'

export interface JsonlWriterOptions {
  filePath: string
  maxFileSizeMb?: number
  retentionDays?: number
}

function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>()
  return JSON.stringify(value, (_key, current) => {
    if (typeof current === 'object' && current !== null) {
      if (seen.has(current)) {
        return '[Circular]'
      }
      seen.add(current)
    }
    return current
  })
}

export class JsonlWriter implements IWriter {
  private readonly dirPath: string
  private readonly maxBytes: number
  private readonly retentionDays: number
  private currentDate = ''
  private currentFilePath = ''

  constructor(options: JsonlWriterOptions) {
    const { filePath, maxFileSizeMb = 10, retentionDays = 7 } = options
    this.dirPath = path.resolve(filePath)
    this.maxBytes = this.sanitizeMaxBytes(maxFileSizeMb)
    this.retentionDays = retentionDays > 0 ? retentionDays : 7
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.dirPath, { recursive: true })
    this.currentDate = this.getDateKey(new Date())
    this.currentFilePath = this.buildDailyPath(this.currentDate)
    await this.cleanOldFiles()
  }

  async write(events: unknown[]): Promise<void> {
    for (const event of events) {
      await this.ensureCurrentFile()
      const line = safeStringify(event) + '\n'
      await fs.appendFile(this.currentFilePath, line, 'utf8')
      await this.maybeRotate()
    }
  }

  async flush(): Promise<void> {
    return Promise.resolve()
  }

  async healthCheck(): Promise<boolean> {
    try {
      const entries = await fs.readdir(this.dirPath)
      return entries.some((entry) => this.isAuditFile(entry))
    } catch {
      return false
    }
  }

  async shutdown(): Promise<void> {
    await this.flush()
  }

  private sanitizeMaxBytes(maxFileSizeMb: number): number {
    const safeMb = maxFileSizeMb > 0 ? maxFileSizeMb : 10
    return Math.floor(safeMb * 1024 * 1024)
  }

  private async cleanOldFiles(): Promise<void> {
    const entries = await fs.readdir(this.dirPath)
    const cutoffMs = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i]
      if (!this.isAuditFile(entry)) {
        continue
      }
      const fullPath = path.join(this.dirPath, entry)
      const stats = await fs.stat(fullPath)
      if (stats.mtimeMs < cutoffMs) {
        await fs.rm(fullPath, { force: true })
      }
    }
  }

  private isAuditFile(fileName: string): boolean {
    return fileName.startsWith('audit-') && fileName.endsWith('.jsonl')
  }

  private async ensureCurrentFile(): Promise<void> {
    const today = this.getDateKey(new Date())
    if (today === this.currentDate) {
      return
    }
    this.currentDate = today
    this.currentFilePath = this.buildDailyPath(today)
  }

  private getDateKey(date: Date): string {
    const yearRaw = String(date.getFullYear())
    const year = yearRaw.padStart(4, '0')
    const monthRaw = String(date.getMonth() + 1)
    const month = monthRaw.padStart(2, '0')
    const dayRaw = String(date.getDate())
    const day = dayRaw.padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  private buildDailyPath(dateKey: string): string {
    return path.join(this.dirPath, `audit-${dateKey}.jsonl`)
  }

  private buildPartPath(dateKey: string, index: number): string {
    return path.join(this.dirPath, `audit-${dateKey}.${index}.jsonl`)
  }

  private async maybeRotate(): Promise<void> {
    const stats = await fs.stat(this.currentFilePath)
    if (stats.size <= this.maxBytes) {
      return
    }
    this.currentFilePath = await this.findNextPartPath()
  }

  private async findNextPartPath(): Promise<string> {
    let index = 1
    for (;;) {
      const candidate = this.buildPartPath(this.currentDate, index)
      try {
        await fs.stat(candidate)
      } catch {
        return candidate
      }
      index += 1
    }
  }
}
