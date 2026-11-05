import { describe, expect, it } from 'vitest';
import { initialEmployees } from '../shared/seed';
import type { Employee, EmployeeRuntime, Meeting, Point } from '../shared/types';
import { initialize, stepOffice } from '../src/simulation/engine';
import { navigate, walkable } from '../src/simulation/navigation';
import { activityDescription } from '../src/simulation/presentation';

function runDay(
  employees: Employee[],
  startMinute: number,
  seconds: number,
  observe: (r: Record<string, EmployeeRuntime>) => void = () => {},
) {
  let runtime = initialize(employees, startMinute);
  let minute = startMinute;
  for (let i = 0; i < seconds * 5; i++) {
    minute += 0.04;
    runtime = stepOffice(employees, runtime, minute, 0.2, [], 1000);
    observe(runtime);
  }
  return runtime;
}
describe('human office routines', () => {
  it('routes between a desk and coffee service without crossing furniture or glass', () => {
    const start: Point = [-5.5, 3],
      end: Point = [6.3, -6.9];
    const route = navigate(start, end);
    expect(route.length).toBeGreaterThan(0);
    let previous = start;
    for (const next of route) {
      const samples = Math.ceil(Math.hypot(next[0] - previous[0], next[1] - previous[1]) / 0.05);
      for (let i = 1; i <= samples; i++)
        expect(
          walkable([
            previous[0] + ((next[0] - previous[0]) * i) / samples,
            previous[1] + ((next[1] - previous[1]) * i) / samples,
          ]),
        ).toBe(true);
      previous = next;
    }
  });
  it('walks to meetings and reroutes an unfinished trip when the next scheduled activity begins', () => {
    const employees = [initialEmployees[1]];
    let runtime = initialize(employees, 545);
    const start = [...runtime.alex.position];
    runtime = stepOffice(employees, runtime, 570, 0.2, [], 1000);
    expect(runtime.alex.state).toBe('WALKING');
    expect(runtime.alex.targetState).toBe('MEETING');
    expect(
      Math.hypot(runtime.alex.position[0] - start[0], runtime.alex.position[1] - start[1]),
    ).toBeLessThanOrEqual(0.251);
    runtime = stepOffice(employees, runtime, 600, 0.2, [], 1000);
    expect(runtime.alex.targetState).toBe('WORKING');
    expect(runtime.alex.goalKey).toContain('WORKING');
  });
  it('lets calendar meetings interrupt routines and returns participants to their schedule afterward', () => {
    const employees = [initialEmployees[1]];
    const meeting: Meeting = {
      id: 'standup',
      title: 'Standup',
      agenda: 'Discuss next steps',
      startsAt: 1000,
      duration: 5,
      participants: ['alex'],
      transcript: [],
      actions: [],
    };
    let runtime = initialize(employees, 899);
    runtime = stepOffice(employees, runtime, 900, 0.2, [meeting], 2000);
    expect(runtime.alex.goalKey).toBe('calendar:standup');
    expect(runtime.alex.targetState).toBe('MEETING');
    runtime = stepOffice(employees, runtime, 901, 0.2, [meeting], 400000);
    expect(runtime.alex.targetState).toBe('EXERCISING');
  });
  it('queues for coffee, serves one worker at a time, then returns each to their workstation', () => {
    const employees = initialEmployees.slice(0, 3).map(
      (e) =>
        ({
          ...e,
          schedule: [
            { time: '09:00', activity: 'WORKING', room: e.room },
            { time: '09:01', activity: 'CHATTING', room: 'cafe' },
            { time: '10:00', activity: 'WORKING', room: e.room },
          ],
        }) as Employee,
    );
    const served = new Set<string>();
    let waited = false;
    const result = runDay(employees, 540.9, 180, (runtime) => {
      expect(
        Object.values(runtime).filter((r) => r.resourceId === 'coffee-machine').length,
      ).toBeLessThanOrEqual(1);
      for (const [id, r] of Object.entries(runtime)) {
        if (r.interaction === 'coffee') served.add(id);
        if (r.waitingFor) waited = true;
      }
    });
    expect(waited).toBe(true);
    expect([...served].sort()).toEqual(employees.map((e) => e.id).sort());
    expect(Object.values(result).every((r) => r.state === 'WORKING')).toBe(true);
  });
  it('allocates distinct equipment and gives every gym visitor a turn before returning to work', () => {
    const exercised = new Set<string>();
    const interactions = new Set<string>();
    let waiting = false;
    const result = runDay(initialEmployees, 899.9, 175, (runtime) => {
      const reserved = Object.values(runtime)
        .map((r) => r.resourceId)
        .filter(Boolean);
      expect(new Set(reserved).size).toBe(reserved.length);
      for (const [id, r] of Object.entries(runtime)) {
        if (r.state === 'EXERCISING') {
          exercised.add(id);
          interactions.add(r.interaction!);
        }
        if (r.waitingFor === 'gym equipment') waiting = true;
      }
    });
    expect(waiting).toBe(true);
    expect([...exercised].sort()).toEqual(['alex', 'daniel', 'ethan', 'james']);
    expect(interactions).toEqual(new Set(['treadmill', 'weights', 'stretching']));
    expect(
      Object.values(result).every((r) => r.state === 'WORKING' || r.targetState === 'WORKING'),
    ).toBe(true);
  });
  it('gives lunch participants separate seats, including the courtyard and lounge', () => {
    const runtime = initialize(initialEmployees, 720);
    const people = Object.values(runtime);
    expect(
      people.every((r) => r.state === 'EATING' && r.interaction === 'eating' && r.seated),
    ).toBe(true);
    expect(new Set(people.map((r) => r.resourceId)).size).toBe(9);
    expect(new Set(people.map((r) => r.room))).toEqual(new Set(['cafe', 'courtyard', 'lounge']));
  });
  it('does not move or advance an interaction while paused', () => {
    const runtime = initialize(initialEmployees, 900);
    const before = JSON.stringify(runtime);
    expect(stepOffice(initialEmployees, runtime, 900, 0)).toBe(runtime);
    expect(JSON.stringify(runtime)).toBe(before);
  });
  it('describes office activity without claiming coding-job progress', () => {
    const working = initialize([initialEmployees[1]], 545).alex;
    expect(activityDescription(working)).toBe('Typing');
    const waiting = {
      ...working,
      state: 'IDLE' as const,
      waitingFor: 'gym equipment',
      interaction: 'waiting' as const,
    };
    expect(activityDescription(waiting)).toBe('Waiting for gym equipment');
    expect(activityDescription(waiting)).not.toMatch(/codex|execution|coding/i);
  });
});
