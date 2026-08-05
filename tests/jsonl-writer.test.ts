import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { JsonlWriter } from '../src/writers/jsonl-writer.js'

test('write creates a jsonl file with parseable lines', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-audit-'))
  const writer = new JsonlWriter({ filePath: tempDir })
  try {
    await writer.initialize()
    const events = [
      { eventId: 'e1', message: 'first' },
      { eventId: 'e2', message: 'second' }
    ]
    await writer.write(events)
    const files = await fs.readdir(tempDir)
    const jsonlFiles = files.filter((name) => name.startsWith('audit-'))
    assert.equal(jsonlFiles.length, 1)
    const fileName = jsonlFiles[0]
    const filePath = path.join(tempDir, fileName)
    const content = await fs.readFile(filePath, 'utf8')
    const rawLines = content.split('\n')
    const lines = rawLines.filter((line) => line.length > 0)
    assert.equal(lines.length, 2)
    for (const line of lines) {
      const parsed = JSON.parse(line)
      assert.equal(typeof parsed.eventId, 'string')
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test('healthCheck flush and shutdown do not throw', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-audit-'))
  const writer = new JsonlWriter({ filePath: tempDir })
  try {
    await writer.initialize()
    await writer.write([{ eventId: 'e1', message: 'hello' }])
    const healthy = await writer.healthCheck()
    assert.equal(healthy, true)
    await writer.flush()
    await writer.shutdown()
    const stillHealthy = await writer.healthCheck()
    assert.equal(stillHealthy, true)
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})