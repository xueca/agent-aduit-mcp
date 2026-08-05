import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RingBuffer } from '../src/buffer/ring-buffer.js'

test('push and pop keep FIFO order', () => {
  const buffer = new RingBuffer<number>({ maxSize: 3 })
  buffer.push(1)
  buffer.push(2)
  buffer.push(3)
  assert.equal(buffer.size, 3)
  assert.equal(buffer.isEmpty(), false)
  const first = buffer.pop()
  const second = buffer.pop()
  const third = buffer.pop()
  assert.equal(first, 1)
  assert.equal(second, 2)
  assert.equal(third, 3)
  assert.equal(buffer.isEmpty(), true)
  const empty = buffer.pop()
  assert.equal(empty, undefined)
})

test('drops the oldest item when full', () => {
  const dropped: number[] = []
  const buffer = new RingBuffer<number>({
    maxSize: 2,
    onOverflow: (items) => {
      for (const item of items) {
        dropped.push(item)
      }
    }
  })
  buffer.push(1)
  buffer.push(2)
  buffer.push(3)
  assert.deepEqual(dropped, [1])
  const first = buffer.pop()
  assert.equal(first, 2)
  assert.equal(buffer.size, 1)
})

test('onOverflow receives every dropped item', () => {
  const dropped: string[] = []
  const buffer = new RingBuffer<string>({
    maxSize: 1,
    onOverflow: (items) => {
      for (const item of items) {
        dropped.push(item)
      }
    }
  })
  buffer.push('a')
  buffer.push('b')
  buffer.push('c')
  assert.deepEqual(dropped, ['a', 'b'])
  const first = buffer.pop()
  assert.equal(first, 'c')
})
test('toArray returns a read-only snapshot', () => {
  const buffer = new RingBuffer<number>({ maxSize: 3 })
  buffer.push(1)
  buffer.push(2)
  const snapshot = buffer.toArray()
  assert.deepEqual(snapshot, [1, 2])
  snapshot.push(99)
  assert.deepEqual(buffer.toArray(), [1, 2])
  buffer.push(3)
  assert.deepEqual(buffer.toArray(), [1, 2, 3])
})