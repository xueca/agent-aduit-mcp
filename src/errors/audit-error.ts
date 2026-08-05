// 审计错误码常量与审计错误类型
export const AUDIT_ERROR_CODES = {
  TRACE_NOT_FOUND: 'AUDIT_TRACE_NOT_FOUND',
  NOT_FOUND: 'AUDIT_NOT_FOUND',
  TRACE_CLOSED: 'AUDIT_TRACE_CLOSED',
  INVALID_EVENT: 'AUDIT_INVALID_EVENT',
  WRITE_FAILED: 'AUDIT_WRITE_FAILED',
  CONFIG_INVALID: 'AUDIT_CONFIG_INVALID'
} as const

export class AuditError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'AuditError'
    this.code = code
  }
}