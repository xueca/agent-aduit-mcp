import { z } from 'zod'

export const BlueprintRecordSchema = z.object({
  blueprintId: z.string().min(1),
  traceId: z.string().min(1),
  defectId: z.string().min(1),
  layer: z.string().min(1),
  understanding: z.string().min(1),
  changeScope: z.array(z.string()).default([]),
  affectedModules: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  verificationPaths: z.array(z.string()).default([]),
  expectedEvents: z.array(z.string()).default([])
})

export type BlueprintRecord = z.infer<typeof BlueprintRecordSchema>