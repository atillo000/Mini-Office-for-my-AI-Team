import type { Store } from '../db';
import type { AttendanceShift } from '../../shared/shifts';
import type { ExternalDraft, TimeLogPayload } from '../../shared/connected';
import type { ZohoService } from './zoho';
import { capacity, localDate, shiftSettings } from '../shifts/attendance';
export async function auditTimeLogs(
  store: Store,
  zoho: ZohoService,
  portalId: string,
  ownerId: string,
  start: string,
  end: string,
) {
  const history = await zoho.timeLogsRange(portalId, start, end, ownerId);
  const shifts = store.list<AttendanceShift>('attendance_shifts'),
    settings = shiftSettings(store);
  const drafts = store
    .list<ExternalDraft>('external_drafts')
    .filter(
      (d) =>
        d.kind === 'TIME_LOG' &&
        (d.payload as TimeLogPayload).account === history.account &&
        (d.payload as TimeLogPayload).portalId === portalId &&
        (d.payload as TimeLogPayload).ownerId === ownerId,
    );
  const days = [];
  for (
    let at = Date.parse(start + 'T00:00:00Z');
    at <= Date.parse(end + 'T00:00:00Z');
    at += 86400000
  ) {
    const date = new Date(at).toISOString().slice(0, 10),
      items = history.items.filter((log) => log.date === date);
    const unknown = items.some((log) => log.minutes === null),
      minutes = items.reduce((n, log) => n + (log.minutes || 0), 0);
    const dayShifts = shifts.filter((s) => localDate(s.clockIn) === date);
    const expected = dayShifts.length
      ? Math.min(
          settings.targetMinutes,
          dayShifts.reduce((n, s) => n + capacity(s, settings), 0),
        )
      : null;
    const local = drafts.filter((d) => (d.payload as TimeLogPayload).date === date);
    const state = unknown
      ? 'NEEDS_REVIEW'
      : expected === null
        ? items.length
          ? 'LOGGED'
          : 'NO_SHIFT_EVIDENCE'
        : !items.length
          ? 'MISSING'
          : minutes < expected
            ? 'PARTIAL'
            : minutes === expected
              ? 'COMPLETE'
              : 'OVER_TARGET';
    days.push({
      date,
      state,
      loggedMinutes: unknown ? null : minutes,
      expectedMinutes: expected,
      missingMinutes: unknown || expected === null ? null : Math.max(0, expected - minutes),
      items,
      localDrafts: local.map((d) => ({
        id: d.id,
        state: d.state,
        minutes: (d.payload as TimeLogPayload).durationMinutes,
      })),
      duplicateCandidates: local
        .filter((d) =>
          items.some(
            (log) =>
              log.projectId === (d.payload as TimeLogPayload).projectId &&
              log.minutes === (d.payload as TimeLogPayload).durationMinutes &&
              log.description.trim() === (d.payload as TimeLogPayload).description.trim(),
          ),
        )
        .map((d) => d.id),
    });
  }
  const result = {
    portalId,
    ownerId,
    startDate: start,
    endDate: end,
    complete: true,
    checkedAt: history.checkedAt,
    days,
  };
  store.put('time_audits', history.account + ':' + portalId + ':' + ownerId, result);
  return result;
}
