import type { FastifyInstance } from 'fastify';
import type { Store } from '../db';
import type { JobQueue } from '../agents/queue';
import type { ActionService } from '../connected/actions';
import type { AttendanceShift } from '../../shared/shifts';
import type { SproutDriver } from './browser';
import { ShiftService } from './service';
export function registerShiftRoutes(
  app: FastifyInstance,
  store: Store,
  queue: JobQueue,
  actions: ActionService,
  changed: () => void,
  enabled: boolean,
  driver?: SproutDriver,
) {
  const shifts = new ShiftService(store, queue, actions, changed, driver, enabled);
  app.get('/api/shifts', async () => shifts.snapshot());
  app.put('/api/shifts/settings', async (request) => shifts.configure(request.body));
  app.post('/api/shifts/browser/open', async () => {
    if (!enabled && !driver) throw new Error('Browser attendance is disabled in offline QA.');
    return shifts.open();
  });
  app.post('/api/shifts/browser/check', async () => {
    if (!enabled && !driver) throw new Error('Browser attendance is disabled in offline QA.');
    return shifts.check();
  });
  app.post('/api/shifts/browser/close', async () => shifts.close());
  app.post<{ Params: { id: string } }>('/api/shifts/:id/plan', async (request) => {
    const shift = store.get<AttendanceShift>('attendance_shifts', request.params.id);
    if (!shift) throw new Error('Captured shift not found.');
    return shifts.enqueue(shift, true);
  });
  app.post<{ Params: { id: string } }>('/api/shift-plans/:id/prepare', async (request) =>
    shifts.prepare(request.params.id, request.body),
  );
  return shifts;
}
