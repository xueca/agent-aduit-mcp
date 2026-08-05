import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CompositeWriter } from '../src/writers/composite-writer.js'
import { AUDIT_ERROR_CODES, AuditError } from '../src/errors/audit-error.js'
import type { IWriter } from '../src/writers/interface.js'

class SuccessWriter implements IWriter {
  readonly received: unknown[] = []

  async initialize(): Promise<void> {
    return Promise.resolve()
  }

  async write(events: unknown[]): Promise<void> {
    this.received.push(...events)
  }

  async flush(): Promise<void> {
    return Promise.resolve()
  }

  async healthCheck(): Promise<boolean> {
    return true
  }

  async shutdown(): Promise<void> {
    return Promise.resolve()
  }
}

class FailingWriter implements IWriter {
  async initialize(): Promise<void> {
    return Promise.resolve()
  }

  async write(_events: unknown[]): Promise<void> {
    throw new Error('write failed')
  }

  async flush(): Promise<void> {
    throw new Error('flush failed')
  }

  async healthCheck(): Promise<boolean> {
    return false
  }

  async shutdown(): Promise<void> {
    throw new Error('shutdown failed')
  }
}

test('write throws AuditError WRITE_FAILED but still calls other writers', async () => {
  const ok = new SuccessWriter()
  const failing = new FailingWriter()
  const composite = new CompositeWriter([ok, failing])
  await composite.initialize()
  const events = [{ eventId: 'e1' }]
  await assert.rejects(composite.write(events), (error) => {
    assert.ok(error instanceof AuditError)
    assert.equal(error.code, AUDIT_ERROR_CODES.WRITE_FAILED)
    assert.match(error.message, /write failed/)
    return true
  })
  assert.equal(ok.received.length, 1)
})

test('healthCheck is false when any writer is unhealthy', async () => {
  const ok = new SuccessWriter()
  const failing = new FailingWriter()
  const composite = new CompositeWriter([ok, failing])
  const healthy = await composite.healthCheck()
  assert.equal(healthy, false)
})

test('healthCheck is true when all writers are healthy', async () => {
  const composite = new CompositeWriter([new SuccessWriter(), new SuccessWriter()])
  const healthy = await composite.healthCheck()
  assert.equal(healthy, true)
})

test('flush and shutdown do not throw when a writer fails', async () => {
  const ok = new SuccessWriter()
  const failing = new FailingWriter()
  const composite = new CompositeWriter([ok, failing])
  await composite.flush()
  await composite.shutdown()
})