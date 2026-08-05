// 环形缓冲：满时丢弃最旧元素，toArray 返回只读快照
export interface RingBufferOptions<T> {
  maxSize: number
  onOverflow?: (dropped: T[]) => void
}

export class RingBuffer<T> {
  private readonly items: T[] = []
  private readonly maxSize: number
  private readonly onOverflow: ((dropped: T[]) => void) | undefined

  constructor(options: RingBufferOptions<T>) {
    const { maxSize, onOverflow } = options
    this.maxSize = maxSize > 0 ? maxSize : 1
    this.onOverflow = onOverflow
  }

  get size(): number {
    return this.items.length
  }

  isEmpty(): boolean {
    return this.items.length === 0
  }

  push(item: T): void {
    this.items.push(item)
    if (this.items.length <= this.maxSize) {
      return
    }
    const overflowCount = this.items.length - this.maxSize
    const dropped = this.items.splice(0, overflowCount)
    if (this.onOverflow !== undefined) {
      this.onOverflow(dropped)
    }
  }

  pop(): T | undefined {
    return this.items.shift()
  }

  toArray(): T[] {
    return [...this.items]
  }
}