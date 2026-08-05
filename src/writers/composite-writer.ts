import type { IWriter } from './interface.js'
import { AUDIT_ERROR_CODES, AuditError } from '../errors/audit-error.js'

export class CompositeWriter implements IWriter {
  private readonly writers: IWriter[]

  constructor(writers: IWriter[]) {
    this.writers = [...writers]
  }

  async initialize(): Promise<void> {
    const tasks = this.writers.map((writer) => writer.initialize())
    await Promise.all(tasks)
  }

  async write(events: unknown[]): Promise<void> {
    const tasks = this.writers.map((writer) => writer.write(events))
    const results = await Promise.allSettled(tasks)
    const reasons: string[] = []
    for (const result of results) {
      if (result.status === 'rejected') {
        const reason = result.reason
        reasons.push(reason instanceof Error ? reason.message : String(reason))
      }
    }
    if (reasons.length > 0) {
      throw new AuditError(AUDIT_ERROR_CODES.WRITE_FAILED, '部分 Writer 写入失败: ' + reasons.join('; '))
    }
  }

  async flush(): Promise<void> {
    const tasks = this.writers.map((writer) => writer.flush())
    await Promise.allSettled(tasks)
  }

  async healthCheck(): Promise<boolean> {
    const tasks = this.writers.map((writer) => writer.healthCheck())
    const results = await Promise.allSettled(tasks)
    for (const result of results) {
      if (result.status !== 'fulfilled' || result.value === false) {
        return false
      }
    }
    return true
  }

  async shutdown(): Promise<void> {
    const tasks = this.writers.map((writer) => writer.shutdown())
    await Promise.allSettled(tasks)
  }
}