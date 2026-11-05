import type { Point } from '../../shared/types';
export interface Obstacle {
  x: number;
  z: number;
  width: number;
  depth: number;
}
const rect = (x: number, z: number, width: number, depth: number): Obstacle => ({
  x,
  z,
  width,
  depth,
});
export const obstacles: Obstacle[] = [
  // Cutaway glass partitions, with the real door openings left clear.
  rect(-6.1, -5.4, 0.06, 7),
  rect(1.7, -5.4, 0.06, 7),
  rect(8.35, -5.4, 0.06, 7),
  rect(-10.9, -1.8, 3.5, 0.06),
  rect(-3.1, -1.8, 5.9, 0.06),
  rect(4.1, -1.8, 4.5, 0.06),
  rect(11.2, -1.8, 3.6, 0.06),
  rect(1.7, 4.9, 0.06, 7.2),
  rect(8.3, 5.5, 0.06, 5.9),
  ...[-9, -5.5, -2].flatMap((x) => [rect(x, 2, 2.7, 1.3), rect(x, 5.5, 2.7, 1.3)]),
  rect(-9.5, -5.8, 2.9, 1.3),
  rect(-2.2, -5.8, 4.7, 1.9),
  rect(4.8, -8.02, 5.35, 1.35),
  rect(7.55, -5.95, 0.86, 1),
  rect(5, -4.2, 1.95, 1.95),
  rect(2.5, -5.4, 1.25, 1),
  rect(4, 3.1, 1.35, 0.8),
  rect(10.5, -6.65, 1.38, 2.85),
  rect(9.35, -4.55, 0.7, 1.25),
  rect(5.4, 2.2, 2.65, 1.1),
  rect(6.6, 5.1, 1.1, 2.65),
  rect(5, 5.2, 1.85, 1.3),
  rect(10.6, 3.6, 3.2, 1.25),
  rect(10.5, 7.2, 2.65, 1.1),
  rect(4.3, 7.7, 2.7, 0.55),
  ...[-10, -7, 7, 10].map((x) => rect(x, 11, 1.75, 1.75)),
  ...[-4.7, 4.7].map((x) => rect(x, 11.8, 2.4, 0.8)),
];
const cell = 0.25;
const minX = -12.75,
  minZ = -8.5;
const columns = 103,
  rows = 87;
const point = (id: number): Point => [
  minX + (id % columns) * cell,
  minZ + Math.floor(id / columns) * cell,
];
const index = ([x, z]: Point) =>
  Math.round((z - minZ) / cell) * columns + Math.round((x - minX) / cell);
export function walkable([x, z]: Point, clearance = 0.2) {
  const inside = x >= -12.75 && x <= 12.75 && z >= -8.5 && z <= 8.65;
  const outside = x >= -12.6 && x <= 12.6 && z >= 9.6 && z <= 13;
  const entrance = Math.abs(x) <= 2.2 && z >= 8.4 && z <= 10;
  return (
    (inside || outside || entrance) &&
    !obstacles.some(
      (o) =>
        Math.abs(x - o.x) < o.width / 2 + clearance && Math.abs(z - o.z) < o.depth / 2 + clearance,
    )
  );
}
const permanent = new Uint8Array(columns * rows);
for (let i = 0; i < permanent.length; i++) permanent[i] = walkable(point(i)) ? 1 : 0;
function closest(p: Point, allowed: (id: number) => boolean) {
  const origin = index(p);
  if (origin >= 0 && origin < permanent.length && allowed(origin)) return origin;
  let best = -1,
    distance = Infinity;
  for (let dz = -6; dz <= 6; dz++)
    for (let dx = -6; dx <= 6; dx++) {
      const id = origin + dx + dz * columns;
      if (id < 0 || id >= permanent.length || !allowed(id)) continue;
      const q = point(id);
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d < distance) {
        best = id;
        distance = d;
      }
    }
  return best;
}
// A* over a clearance grid; route simplification never cuts through a wall or desk.
export function navigate(start: Point, end: Point, avoid: Point[] = []): Point[] {
  const allowed = (id: number) =>
    !!permanent[id] &&
    !avoid.some((p) => Math.hypot(point(id)[0] - p[0], point(id)[1] - p[1]) < 0.47);
  const source = closest(start, (id) => !!permanent[id]);
  const target = closest(end, allowed);
  if (source < 0 || target < 0) return [];
  const costs = new Map<number, number>([[source, 0]]),
    parents = new Map<number, number>();
  const open = new Set([source]);
  const closed = new Set<number>();
  const heuristic = (id: number) => {
    const p = point(id),
      q = point(target);
    return Math.hypot(p[0] - q[0], p[1] - q[1]);
  };
  while (open.size) {
    let current = -1,
      best = Infinity;
    for (const id of open) {
      const f = costs.get(id)! + heuristic(id);
      if (f < best) {
        current = id;
        best = f;
      }
    }
    if (current === target) {
      const route: Point[] = [];
      let node = current;
      while (node !== source) {
        route.push(point(node));
        node = parents.get(node)!;
      }
      route.reverse();
      if (walkable(end)) route.push([...end]);
      const result: Point[] = [];
      let previous = start;
      for (let i = 0; i < route.length;) {
        let furthest = i;
        for (let j = i + 1; j < route.length; j++) {
          const q = route[j];
          const d = Math.hypot(q[0] - previous[0], q[1] - previous[1]);
          const count = Math.ceil(d / 0.1);
          let clear = true;
          for (let n = 1; n <= count; n++) {
            const p: Point = [
              previous[0] + ((q[0] - previous[0]) * n) / count,
              previous[1] + ((q[1] - previous[1]) * n) / count,
            ];
            if (!walkable(p) || avoid.some((a) => Math.hypot(p[0] - a[0], p[1] - a[1]) < 0.45)) {
              clear = false;
              break;
            }
          }
          if (!clear) break;
          furthest = j;
        }
        result.push(route[furthest]);
        previous = route[furthest];
        i = furthest + 1;
      }
      return result;
    }
    open.delete(current);
    closed.add(current);
    const x = current % columns,
      y = Math.floor(current / columns);
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ]) {
      const nx = x + dx,
        ny = y + dy;
      if (nx < 0 || nx >= columns || ny < 0 || ny >= rows) continue;
      const next = ny * columns + nx;
      if (closed.has(next) || !allowed(next)) continue;
      if (dx && dy && (!allowed(y * columns + nx) || !allowed(ny * columns + x))) continue;
      const cost = costs.get(current)! + Math.hypot(dx, dy) * cell;
      if (cost < (costs.get(next) ?? Infinity)) {
        costs.set(next, cost);
        parents.set(next, current);
        open.add(next);
      }
    }
  }
  return [];
}
