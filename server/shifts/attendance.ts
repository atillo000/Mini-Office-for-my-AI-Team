import { z } from 'zod';
import type { AttendancePunch, AttendanceShift, ShiftSettings } from '../../shared/shifts';
import type { Store } from '../db';
import { digest } from '../agents/artifacts';
export const shiftSettingsInput = z
  .object({
    version: z.number().int().min(1),
    sproutUrl: z.string().url().max(500),
    enabled: z.boolean(),
    shareWithAI: z.boolean(),
    unpaidBreakMinutes: z.number().int().min(0).max(180),
    targetMinutes: z.number().int().min(1).max(720),
  })
  .strict()
  .refine(
    (v) => validSproutUrl(v.sproutUrl),
    'Use your company Sprout HTTPS sign-in URL without query parameters.',
  );
export function validSproutUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.hostname.endsWith('.hrhub.ph') || url.hostname.endsWith('.sprout.ph'))
    );
  } catch {
    return false;
  }
}
export function shiftSettings(store: Store): ShiftSettings {
  return (
    store.get<ShiftSettings>('settings', 'shift_planning') || {
      version: 1,
      sproutUrl: 'https://tecsurge.hrhub.ph/LogIn.aspx',
      enabled: false,
      shareWithAI: false,
      unpaidBreakMinutes: 60,
      targetMinutes: 480,
    }
  );
}
export function localDate(at: number) {
  return new Date(at + 8 * 3600000).toISOString().slice(0, 10);
}
export function dateCapacity(shift: AttendanceShift, date: string) {
  const start = Date.parse(date + 'T00:00:00+08:00');
  return Math.max(
    0,
    Math.floor(
      (Math.min(start + 86400000, shift.clockOut) - Math.max(start, shift.clockIn)) / 60000,
    ),
  );
}
export function capacity(shift: AttendanceShift, settings: ShiftSettings) {
  return Math.max(
    0,
    Math.min(
      settings.targetMinutes,
      Math.floor((shift.clockOut - shift.clockIn) / 60000) - settings.unpaidBreakMinutes,
    ),
  );
}
export function saveAttendance(
  store: Store,
  punches: AttendancePunch[],
  sourceUrl: string,
  now = Date.now(),
) {
  const sorted = [...new Map(punches.map((p) => [p.at + ':' + p.type, p])).values()].sort(
    (a, b) => a.at - b.at,
  );
  let start: AttendancePunch | undefined;
  const result: AttendanceShift[] = [];
  for (const punch of sorted) {
    if (!Number.isFinite(punch.at) || punch.at > now)
      throw new Error('Sprout attendance contains an invalid or future punch.');
    if (punch.type === 'IN') {
      if (start)
        throw new Error('Multiple clock-ins without a clock-out. Check Sprout before planning.');
      start = punch;
    } else if (start) {
      const elapsed = punch.at - start.at;
      if (elapsed <= 0 || elapsed > 20 * 3600000)
        throw new Error('Ambiguous attendance interval. Review your Sprout punches.');
      const id = digest({ sourceUrl, clockIn: start.at });
      const old = store.get<AttendanceShift>('attendance_shifts', id);
      const shift: AttendanceShift = {
        id,
        clockIn: start.at,
        clockOut: punch.at,
        sourceUrl,
        observedAt: now,
        version: old ? old.version + Number(old.clockOut !== punch.at) : 1,
      };
      result.push(shift);
      start = undefined;
    }
  }
  store.transaction(() => {
    for (const shift of result) store.put('attendance_shifts', shift.id, shift);
  });
  return result;
}
