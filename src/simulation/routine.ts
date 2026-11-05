import type { Activity, Employee, Meeting, RoomId } from '../../shared/types';
import { homeSpot } from '../../shared/office-spots';
export interface RoutineGoal {
  key: string;
  activity: Activity;
  room: RoomId;
  endsAt: number;
  participants?: string[];
  source: 'schedule' | 'calendar';
}
export function routineGoal(
  employee: Employee,
  minute: number,
  meetings: Meeting[] = [],
  now = Date.now(),
): RoutineGoal {
  const calendar = meetings
    .filter(
      (m) =>
        m.participants.includes(employee.id) &&
        now >= m.startsAt &&
        now < m.startsAt + m.duration * 60000,
    )
    .sort((a, b) => a.startsAt - b.startsAt || a.id.localeCompare(b.id))[0];
  if (calendar)
    return {
      key: `calendar:${calendar.id}`,
      activity: 'MEETING',
      room: 'meeting',
      endsAt: minute + (calendar.startsAt + calendar.duration * 60000 - now) / 5000,
      participants: calendar.participants,
      source: 'calendar',
    };
  const today = ((minute % 1440) + 1440) % 1440;
  const entries = employee.schedule
    .map((item) => ({
      ...item,
      start: item.time.split(':').reduce((sum, n, i) => sum + Number(n) * (i ? 1 : 60), 0),
    }))
    .filter((item) => Number.isFinite(item.start))
    .sort((a, b) => a.start - b.start);
  let current = entries[0];
  for (const item of entries) if (item.start <= today) current = item;
  if (!current || today < entries[0].start || today >= 1080)
    return {
      key: `schedule:off-hours`,
      activity: 'RESTING',
      room: 'lounge',
      endsAt: 1440,
      source: 'schedule',
    };
  const room = current.activity === 'WORKING' ? homeSpot(employee).room : current.room;
  return {
    key: `schedule:${current.start}:${current.activity}:${room}`,
    activity: current.activity,
    room,
    endsAt: entries.find((e) => e.start > today)?.start ?? 1080,
    source: 'schedule',
  };
}
