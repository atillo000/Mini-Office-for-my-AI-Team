import type {
  Activity,
  Employee,
  EmployeeRuntime,
  Interaction,
  Meeting,
  Point,
  RoomId,
} from '../../shared/types';
import { rooms } from '../../shared/seed';
import {
  allSpots,
  cafeSeats,
  coffeeMachine,
  courtyardSeats,
  gymSpots,
  homeSpot,
  loungeSeats,
  physicalRoom,
  sharedSpots,
  waitingSpot,
  type InteractionSpot,
} from '../../shared/office-spots';
import { routineGoal, type RoutineGoal } from './routine';
import { navigate } from './navigation';

// Coarse room graph remains useful for inspection; actual walking uses the clearance grid.
export const graph: Record<string, { point: Point; neighbors: string[] }> = {
  west: { point: [-10, -0.6], neighbors: ['mid', 'ceo', 'studio'] },
  mid: { point: [-3, -0.6], neighbors: ['west', 'east', 'meeting'] },
  east: { point: [5, -0.6], neighbors: ['mid', 'far', 'cafe', 'lounge', 'courtyard'] },
  far: { point: [10.2, -0.6], neighbors: ['east', 'gym', 'reception'] },
  ceo: { point: [-7.8, -2.2], neighbors: ['west'] },
  studio: { point: [-7.3, 1.2], neighbors: ['west'] },
  meeting: { point: [0.8, -2.3], neighbors: ['mid'] },
  cafe: { point: [7.6, -2.3], neighbors: ['east'] },
  gym: { point: [9.3, -2.4], neighbors: ['far'] },
  lounge: { point: [3.2, 1.2], neighbors: ['east'] },
  reception: { point: [9, 1.2], neighbors: ['far'] },
  courtyard: { point: [0, 10.3], neighbors: ['east'] },
};
export function findPath(start: string, end: string): Point[] {
  if (!graph[start] || !graph[end]) throw new Error('Unknown waypoint');
  const queue = [[start]],
    seen = new Set<string>();
  while (queue.length) {
    const path = queue.shift()!;
    const last = path.at(-1)!;
    if (last === end) return path.map((id) => [...graph[id].point] as Point);
    if (seen.has(last)) continue;
    seen.add(last);
    for (const next of graph[last].neighbors) queue.push([...path, next]);
  }
  return [];
}
export function scheduleAt(e: Employee, minute: number): { activity: Activity; room: RoomId } {
  const g = routineGoal(e, minute);
  return { activity: g.activity, room: g.room };
}
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const rotate = <T>(items: T[], index: number) =>
  items.length
    ? [...items.slice(index % items.length), ...items.slice(0, index % items.length)]
    : items;
function history(r: EmployeeRuntime, minute: number, text: string) {
  return [...r.history.slice(-29), { time: minute, text }];
}
function fresh(e: Employee): EmployeeRuntime {
  return {
    position: [...e.desk],
    room: homeSpot(e).room,
    state: 'IDLE',
    targetState: 'IDLE',
    path: [],
    nextChange: 0,
    elapsed: 0,
    history: [],
  };
}
function intent(goal: RoutineGoal, r: EmployeeRuntime, e: Employee): RoutineGoal {
  if (r.completedGoal === goal.key) {
    const working = goal.activity === 'CHATTING' || goal.activity === 'REPORTING';
    return {
      ...goal,
      key: goal.key + '/after',
      activity: working ? 'WORKING' : 'RESTING',
      room: working ? homeSpot(e).room : goal.activity === 'EATING' ? 'courtyard' : 'lounge',
    };
  }
  if (goal.activity === 'CHATTING' && goal.room === 'cafe')
    return { ...goal, key: goal.key + (r.breakPhase === 'social' ? '/social' : '/coffee') };
  return goal;
}
function candidates(e: Employee, g: RoutineGoal, index: number): InteractionSpot[] {
  if (g.activity === 'WORKING') return [homeSpot(e)];
  if (g.activity === 'MEETING')
    return rotate(
      sharedSpots.filter((s) => s.uses.includes('MEETING')),
      index,
    );
  if (g.activity === 'EXERCISING') return rotate(gymSpots, index);
  if (g.activity === 'EATING')
    return rotate(
      [...cafeSeats, ...courtyardSeats, ...loungeSeats.filter((s) => s.uses.includes('EATING'))],
      index,
    );
  if (g.activity === 'RESTING')
    return rotate(
      g.room === 'courtyard'
        ? [...courtyardSeats, ...loungeSeats]
        : [...loungeSeats, ...courtyardSeats],
      index,
    );
  if (g.activity === 'CHATTING')
    return g.key.endsWith('/coffee')
      ? [coffeeMachine]
      : rotate(
          sharedSpots.filter((s) => s.id !== 'coffee-machine' && s.uses.includes('CHATTING')),
          index,
        );
  if (g.activity === 'REPORTING')
    return [
      [-10.5, -3.5],
      [-9.5, -3.5],
      [-8.5, -3.5],
      [-7.4, -3.3],
    ].map((p, i) => ({
      id: `ceo-checkin-${i}`,
      name: 'CEO check-in',
      room: 'ceo',
      position: p as Point,
      heading: Math.PI,
      interaction: 'reporting',
      seated: false,
      uses: ['REPORTING'],
    }));
  return [
    { ...homeSpot(e), id: `idle-${e.id}`, interaction: 'none', seated: false, uses: ['IDLE'] },
  ];
}
function interaction(g: RoutineGoal, s: InteractionSpot): Interaction {
  if (g.activity === 'EATING') return 'eating';
  if (g.activity === 'CHATTING' && s.id !== 'coffee-machine') return 'chatting';
  return s.interaction;
}
function atSpot(
  r: EmployeeRuntime,
  s: InteractionSpot,
  g: RoutineGoal,
  minute: number,
): EmployeeRuntime {
  return {
    ...r,
    position: [...s.position],
    room: s.room,
    targetRoom: s.room,
    state: g.activity,
    targetState: g.activity,
    resourceId: s.id,
    interaction: interaction(g, s),
    targetInteraction: interaction(g, s),
    heading: s.heading,
    targetHeading: s.heading,
    seated: s.seated,
    targetSeated: s.seated,
    elevation: s.elevation || 0,
    targetElevation: s.elevation || 0,
    elapsed: 0,
    path: [],
    nextChange: g.endsAt,
    goalKey: g.key,
    waitingFor: undefined,
    blockedSeconds: 0,
    history: history(r, minute, `${g.activity.toLowerCase()} · ${s.name} (office simulation)`),
  };
}
export function initialize(
  employees: Employee[],
  minute: number,
  meetings: Meeting[] = [],
  now = Date.now(),
): Record<string, EmployeeRuntime> {
  const occupied = new Set<string>();
  const result: Record<string, EmployeeRuntime> = {};
  for (const [index, e] of employees.entries()) {
    const base = routineGoal(e, minute, meetings, now);
    let r = fresh(e);
    r.routineKey = base.key;
    const g = intent(base, r, e);
    const s = candidates(e, g, index).find((s) => !occupied.has(s.id));
    if (s) {
      occupied.add(s.id);
      r = atSpot(r, s, g, minute);
    } else {
      const wait = waitingSpot(g.room, index);
      r = {
        ...atSpot(r, wait, { ...g, activity: 'IDLE' }, minute),
        resourceId: undefined,
        waitingFor:
          g.activity === 'EXERCISING'
            ? 'gym equipment'
            : g.activity === 'CHATTING'
              ? 'coffee machine'
              : 'a free seat',
      };
    }
    result[e.id] = r;
  }
  return result;
}
function trip(
  r: EmployeeRuntime,
  spot: InteractionSpot,
  g: RoutineGoal,
  minute: number,
  fromSpot?: InteractionSpot,
): EmployeeRuntime | undefined {
  const exit =
    fromSpot?.approach && distance(r.position, fromSpot.position) < 0.35
      ? fromSpot.approach
      : undefined;
  const start = exit || r.position;
  const approach = spot.approach || spot.position;
  const route = navigate(start, approach);
  if (!route.length && distance(start, approach) > 0.3) return undefined;
  const path: Point[] = [...(exit ? [[...exit] as Point] : []), ...route];
  if (spot.approach) path.push([...spot.position]);
  return {
    ...r,
    state: 'WALKING',
    targetState: g.activity,
    targetRoom: spot.room,
    resourceId: spot.id,
    interaction: 'none',
    targetInteraction: interaction(g, spot),
    targetHeading: spot.heading,
    targetSeated: spot.seated,
    targetElevation: spot.elevation || 0,
    path,
    goalKey: g.key,
    nextChange: g.endsAt,
    elapsed: 0,
    seated: false,
    waitingFor: undefined,
    waitingSeconds: 0,
    blockedSeconds: 0,
    history: history(
      r,
      minute,
      `Walking to ${spot.name} · ${rooms.find((s) => s.id === spot.room)?.name}`,
    ),
  };
}
// Retained single-worker API; the office coordinator below adds reservations and avoidance.
export function sendTo(
  r: EmployeeRuntime,
  e: Employee,
  room: RoomId,
  activity: Activity,
  minute: number,
): EmployeeRuntime {
  const g: RoutineGoal = {
    key: `manual:${room}:${activity}`,
    room,
    activity,
    endsAt: minute + 30,
    source: 'schedule',
  };
  return (
    trip(r, candidates(e, g, 0)[0], g, minute) || {
      ...r,
      state: 'IDLE',
      interaction: 'waiting',
      waitingFor: 'a clear path',
    }
  );
}
export function advance(r: EmployeeRuntime, dt: number, minute: number): EmployeeRuntime {
  if (r.state !== 'WALKING' || !r.path.length || dt <= 0) return r;
  let budget = dt * 1.25;
  let position: Point = [...r.position];
  const path = r.path.map((p) => [...p] as Point);
  while (path.length && budget > 0) {
    const target = path[0];
    const d = distance(position, target);
    if (d <= budget) {
      position = path.shift()!;
      budget -= d;
    } else {
      position = [
        position[0] + ((target[0] - position[0]) * budget) / d,
        position[1] + ((target[1] - position[1]) * budget) / d,
      ];
      budget = 0;
    }
  }
  const arrived = !path.length;
  return {
    ...r,
    position,
    path,
    room: arrived ? r.targetRoom || r.room : physicalRoom(position) || r.room,
    state: arrived ? r.targetState : 'WALKING',
    interaction: arrived ? r.targetInteraction : 'none',
    heading: arrived ? r.targetHeading : r.heading,
    seated: arrived ? r.targetSeated : false,
    elevation: arrived ? r.targetElevation : physicalRoom(position) === 'courtyard' ? -0.25 : 0,
    elapsed: 0,
    history: arrived
      ? history(
          r,
          minute,
          `${r.targetState.toLowerCase()} · arrived at ${r.targetRoom || r.room} (office simulation)`,
        )
      : r.history,
  };
}
// This function deliberately accepts no jobs, model responses, or execution service state.
export function stepOffice(
  employees: Employee[],
  current: Record<string, EmployeeRuntime>,
  minute: number,
  dt: number,
  meetings: Meeting[] = [],
  now = Date.now(),
): Record<string, EmployeeRuntime> {
  if (dt <= 0) return current;
  if (dt > 0.21) {
    let next = current;
    let remaining = dt;
    while (remaining > 0) {
      const slice = Math.min(0.2, remaining);
      next = stepOffice(employees, next, minute, slice, meetings, now);
      remaining -= slice;
    }
    return next;
  }
  const runtime: Record<string, EmployeeRuntime> = {};
  const goals = new Map<string, RoutineGoal>();
  const departed = new Map<string, InteractionSpot>();
  const lookup = new Map(allSpots(employees).map((s) => [s.id, s]));
  // Release changed/finished interactions before anybody chooses the next resource.
  for (const e of employees) {
    let r = { ...(current[e.id] || fresh(e)), elapsed: (current[e.id]?.elapsed || 0) + dt };
    const base = routineGoal(e, minute, meetings, now);
    if (r.routineKey !== base.key) {
      r.completedGoal = undefined;
      r.breakPhase = undefined;
      r.carrying = undefined;
      r.routineKey = base.key;
    }
    if (r.state !== 'WALKING' && !r.waitingFor) {
      if (r.interaction === 'coffee' && r.elapsed >= 5) {
        r.breakPhase = 'social';
        r.carrying = 'mug';
      } else if (
        (base.activity === 'EXERCISING' && r.state === 'EXERCISING' && r.elapsed >= 45) ||
        (base.activity === 'EATING' && r.state === 'EATING' && r.elapsed >= 55) ||
        (base.activity === 'CHATTING' && r.interaction === 'chatting' && r.elapsed >= 25) ||
        (base.activity === 'REPORTING' && r.state === 'REPORTING' && r.elapsed >= 12)
      ) {
        r.completedGoal = base.key;
        r.carrying = undefined;
      }
    }
    const goal = intent(base, r, e);
    goals.set(e.id, goal);
    if (r.goalKey !== goal.key) {
      const old = r.resourceId ? lookup.get(r.resourceId) : undefined;
      if (old) departed.set(e.id, old);
      r = {
        ...r,
        resourceId: undefined,
        path: [],
        state: 'IDLE',
        interaction: 'none',
        waitingFor: undefined,
        goalKey: goal.key,
        elapsed: 0,
        retryIn: 0,
      };
    }
    r.retryIn = Math.max(0, (r.retryIn || 0) - dt);
    if (r.waitingFor) r.waitingSeconds = (r.waitingSeconds || 0) + dt;
    runtime[e.id] = r;
  }
  const occupied = new Set(
    Object.values(runtime)
      .map((r) => r.resourceId)
      .filter((id): id is string => !!id),
  );
  const order = employees
    .map((e, index) => ({ e, index }))
    .sort(
      (a, b) =>
        (runtime[b.e.id].waitingSeconds || 0) - (runtime[a.e.id].waitingSeconds || 0) ||
        a.index - b.index,
    );
  for (const { e, index } of order) {
    let r = runtime[e.id];
    const g = goals.get(e.id)!;
    if ((!r.resourceId || r.waitingFor) && !r.retryIn) {
      let chosen: EmployeeRuntime | undefined;
      for (const spot of candidates(e, g, index))
        if (!occupied.has(spot.id)) {
          chosen = trip(r, spot, g, minute, departed.get(e.id));
          if (chosen) {
            occupied.add(spot.id);
            break;
          }
        }
      if (chosen) r = chosen;
      else {
        const reason =
          g.activity === 'EXERCISING'
            ? 'gym equipment'
            : g.key.endsWith('/coffee')
              ? 'coffee machine'
              : g.activity === 'WORKING'
                ? 'workstation'
                : 'a free seat';
        if (!r.waitingFor) {
          const wait = waitingSpot(g.room, index);
          const walk = trip(r, wait, { ...g, activity: 'IDLE' }, minute, departed.get(e.id));
          r = walk
            ? { ...walk, resourceId: undefined, waitingFor: reason }
            : { ...r, state: 'IDLE', interaction: 'waiting', seated: false, waitingFor: reason };
        }
        r = { ...r, retryIn: 0.8 };
      }
    }
    if (r.state === 'WALKING') {
      const next = advance(r, dt, minute);
      const peers = Object.entries(runtime)
        .filter(([id]) => id !== e.id)
        .map(([, person]) => person.position);
      const blocked = peers.some(
        (p) =>
          distance(next.position, p) < 0.42 &&
          distance(next.position, p) < distance(r.position, p) - 0.001,
      );
      if (!blocked) r = { ...next, blockedSeconds: 0 };
      else {
        r = { ...r, blockedSeconds: (r.blockedSeconds || 0) + dt };
        if (r.blockedSeconds! > 1.2) {
          const spot = r.resourceId ? lookup.get(r.resourceId) : undefined;
          const end = spot?.approach || r.path.at(-1);
          if (end) {
            const route = navigate(
              r.position,
              end,
              peers.filter((p) => distance(p, r.position) < 5),
            );
            if (route.length)
              r = {
                ...r,
                path: [...route, ...(spot?.approach ? [[...spot.position] as Point] : [])],
                blockedSeconds: 0,
              };
          }
        }
      }
    } else if (r.state === 'WORKING')
      r.interaction = ((r.elapsed || 0) + index * 2) % 22 < 5 ? 'reading' : 'typing';
    else if (r.state === 'MEETING') {
      const participants = g.participants || employees.map((e) => e.id);
      const speaker = participants[Math.floor((minute * 5) / 7) % participants.length];
      r.interaction = e.id === speaker ? 'speaking' : 'listening';
    } else if (r.state === 'IDLE' && r.waitingFor) r.interaction = 'waiting';
    runtime[e.id] = r;
  }
  return runtime;
}
