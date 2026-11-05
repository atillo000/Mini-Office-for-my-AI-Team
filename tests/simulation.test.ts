import { describe, it, expect } from 'vitest';
import { initialEmployees, rooms } from '../shared/seed';
import { graph, findPath, initialize, sendTo, advance, scheduleAt } from '../src/simulation/engine';
describe('scheduled office behavior', () => {
  it('seats meeting participants apart instead of placing multiple people inside one another', () => {
    const runtime = Object.values(initialize(initialEmployees, 570));
    expect(runtime.every((person) => person.state === 'MEETING')).toBe(true);
    for (let i = 0; i < runtime.length; i++)
      for (let j = i + 1; j < runtime.length; j++)
        expect(
          Math.hypot(
            runtime[i].position[0] - runtime[j].position[0],
            runtime[i].position[1] - runtime[j].position[1],
          ),
        ).toBeGreaterThan(0.75);
  });
  it('connects every room through the waypoint graph', () => {
    for (const start of rooms)
      for (const end of rooms) {
        const path = findPath(start.id, end.id);
        expect(path[0]).toEqual(graph[start.id].point);
        expect(path.at(-1)).toEqual(graph[end.id].point);
      }
  });
  it('walks gradually and arrives before changing to the destination activity', () => {
    const employee = initialEmployees[1];
    const current = initialize([employee], 545)[employee.id];
    const walking = sendTo(current, employee, 'cafe', 'EATING', 720);
    expect(walking.state).toBe('WALKING');
    const next = advance(walking, 0.1, 720);
    expect(
      Math.hypot(next.position[0] - walking.position[0], next.position[1] - walking.position[1]),
    ).toBeLessThanOrEqual(0.126);
    expect(next.state).toBe('WALKING');
    const arrived = advance(next, 100, 721);
    expect(arrived.state).toBe('EATING');
    expect(arrived.path).toEqual([]);
    expect(arrived.history.at(-1)?.text).toContain('eating');
  });
  it('uses a daily schedule with lunch, wellness, and reporting', () => {
    const e = initialEmployees[1];
    expect(scheduleAt(e, 720).activity).toBe('EATING');
    expect(scheduleAt(e, 900).activity).toBe('EXERCISING');
    expect(scheduleAt(e, 1020).activity).toBe('REPORTING');
    expect(scheduleAt(e, 1200).activity).toBe('RESTING');
  });
  it('does not mutate existing runtime during a movement update', () => {
    const e = initialEmployees[0];
    const original = initialize([e], 545)[e.id];
    const before = JSON.stringify(original);
    const next = sendTo(original, e, 'meeting', 'MEETING', 570);
    advance(next, 10, 571);
    expect(JSON.stringify(original)).toBe(before);
  });
});
