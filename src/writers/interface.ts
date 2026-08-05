export interface IWriter {
  initialize(): Promise<void>
  write(events: unknown[]): Promise<void>
  flush(): Promise<void>
  healthCheck(): Promise<boolean>
  shutdown(): Promise<void>
}