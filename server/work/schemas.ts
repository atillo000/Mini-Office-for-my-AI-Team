import { z } from 'zod';
import { classifications, projectRoles } from '../../shared/work';
const short = z.string().trim().min(1).max(200);
const note = z.string().trim().max(4000).default('');
const list = z.array(short).max(30).default([]);
const ref = z.string().trim().min(1).max(100);
export const projectInput = z
  .object({
    name: short,
    aliases: list,
    department: z.string().trim().max(200).default(''),
    description: note,
    role: z.enum(projectRoles),
    stakeholders: list,
    applications: list,
    technologies: list,
    status: z.enum(['ACTIVE', 'PAUSED', 'COMPLETE', 'ARCHIVED']).default('ACTIVE'),
    responsibilities: list,
    repositoryId: ref.optional(),
  })
  .strict();
export const mappingInput = z
  .object({
    knowledgeProjectId: ref,
    activityName: short,
    portalId: ref.optional(),
    projectId: ref.optional(),
    taskId: ref.optional(),
    issueId: ref.optional(),
    module: z.enum(['TASK', 'ISSUE', 'GENERAL']),
    billing: z.enum(['BILLABLE', 'NON_BILLABLE', 'UNKNOWN']),
    approvedDescriptions: list,
    note,
    confirmed: z.literal(true),
  })
  .strict()
  .superRefine((v, ctx) => {
    if ((v.module !== 'TASK' && v.taskId) || (v.module !== 'ISSUE' && v.issueId))
      ctx.addIssue({ code: 'custom', message: 'Task and issue IDs must match the chosen module.' });
  });
export const ruleInput = z
  .object({
    name: short,
    enabled: z.boolean().default(true),
    source: z.enum(['outlook', 'teams', 'manual', 'any']),
    terms: z.array(z.string().trim().min(2).max(150)).min(1).max(20),
    match: z.enum(['ALL', 'ANY']),
    sender: z.string().trim().min(1).max(300).optional(),
    knowledgeProjectId: ref.optional(),
    mappingId: ref.optional(),
    labels: z.array(z.enum(classifications)).min(1).max(10),
    requiredFields: z
      .array(z.enum(['date', 'duration', 'project', 'attendance']))
      .max(4)
      .default([]),
    confidence: z.number().min(0).max(1).default(1),
    explanation: note,
    confirmed: z.literal(true),
  })
  .strict();
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const date = new Date(v + 'T00:00:00Z');
    return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === v;
  }, 'Use a real calendar date');
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const minutes = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3));
export const recordInput = z
  .object({
    source: z.enum(['outlook', 'teams', 'manual']),
    kind: z.enum(['EMAIL', 'MESSAGE', 'ACTIVITY', 'MEETING']),
    subject: z.string().trim().max(300).default(''),
    body: z.string().trim().min(1).max(12000),
    sender: z.string().trim().max(300).default(''),
    date: isoDate.optional(),
    startTime: time.optional(),
    endTime: time.optional(),
    durationMinutes: z.number().int().min(1).max(1440).optional(),
    attendanceConfirmed: z.boolean().default(false),
    activityConfirmed: z.boolean().default(false),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.kind === 'EMAIL' || v.kind === 'MESSAGE') {
      if (
        v.durationMinutes ||
        v.startTime ||
        v.endTime ||
        v.activityConfirmed ||
        v.attendanceConfirmed
      )
        ctx.addIssue({
          code: 'custom',
          message:
            'Communications do not prove working time. Create a separate confirmed activity.',
        });
    }
    if (!!v.startTime !== !!v.endTime)
      ctx.addIssue({
        code: 'custom',
        message: 'Supply both start and end times or leave both blank.',
      });
    if (v.startTime && v.endTime) {
      const duration = minutes(v.endTime) - minutes(v.startTime);
      if (duration <= 0 || (v.durationMinutes !== undefined && duration !== v.durationMinutes))
        ctx.addIssue({
          code: 'custom',
          message: 'End time must follow start time on the same date and match duration.',
        });
      if (!v.date)
        ctx.addIssue({ code: 'custom', message: 'A date is required with start/end times.' });
    }
  });
export const correctionInput = z
  .object({
    version: z.number().int().min(1),
    labels: z.array(z.enum(classifications)).min(1).max(10),
    projectId: ref.nullable(),
    mappingId: ref.nullable().default(null),
    explanation: z.string().trim().min(1).max(2000),
    confirmed: z.literal(true),
  })
  .strict();
