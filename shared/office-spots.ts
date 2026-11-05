import type { Activity, Employee, Interaction, Point, RoomId } from './types';
import { conferenceSeats } from './office-seating';
export interface InteractionSpot {
  id: string;
  name: string;
  room: RoomId;
  position: Point;
  heading: number;
  interaction: Interaction;
  seated: boolean;
  uses: Activity[];
  approach?: Point;
  elevation?: number;
}
export function physicalRoom([x, z]: Point): RoomId | undefined {
  if (z >= 9) return 'courtyard';
  if (z < -1.8) return x < -6.1 ? 'ceo' : x < 1.7 ? 'meeting' : x < 8.35 ? 'cafe' : 'gym';
  if (z > 0.2) return x < 1.7 ? 'studio' : x < 8.3 ? 'lounge' : 'reception';
  return undefined;
}
export function homeSpot(e: Employee): InteractionSpot {
  return {
    id: e.id === 'sophia' ? 'meeting-3' : `work-${e.id}`,
    name: 'assigned workstation',
    room: physicalRoom(e.desk) || e.room,
    position: [...e.desk],
    heading: Math.PI,
    interaction: 'typing',
    seated: true,
    uses: ['WORKING'],
  };
}
const seats: InteractionSpot[] = conferenceSeats.map((position, i) => ({
  id: `meeting-${i}`,
  name: `meeting chair ${i + 1}`,
  room: 'meeting',
  position,
  heading: Math.atan2(-2.2 - position[0], -5.8 - position[1]),
  interaction: 'listening',
  seated: true,
  uses: ['MEETING'],
}));
export const cafeSeats: InteractionSpot[] = [
  { id: 'cafe-left', name: 'kitchen table', position: [3.5, -4.2], heading: Math.PI / 2 },
  { id: 'cafe-right', name: 'kitchen table', position: [6.5, -4.2], heading: -Math.PI / 2 },
  { id: 'cafe-front', name: 'kitchen table', position: [5, -2.9], heading: Math.PI },
].map((s) => ({
  ...s,
  position: s.position as Point,
  room: 'cafe',
  interaction: 'eating',
  seated: true,
  uses: ['EATING', 'CHATTING'],
}));
export const loungeSeats: InteractionSpot[] = [
  { id: 'lounge-orange-0', position: [5, 2.5], approach: [5, 3.35], heading: 0 },
  { id: 'lounge-orange-1', position: [6, 2.5], approach: [6, 3.35], heading: 0 },
  { id: 'lounge-blue-0', position: [6.6, 4.65], approach: [6, 3.3], heading: -Math.PI / 2 },
  { id: 'lounge-blue-1', position: [6.6, 5.75], approach: [5.95, 6.8], heading: -Math.PI / 2 },
  { id: 'lounge-chair-0', position: [2.9, 4.8], heading: Math.PI / 2 },
  { id: 'lounge-chair-1', position: [7.5, 7.2], heading: Math.PI },
].map((s) => ({
  ...s,
  position: s.position as Point,
  approach: s.approach as Point | undefined,
  name: 'lounge seat',
  room: 'lounge',
  interaction: 'reading',
  seated: true,
  uses: s.id.includes('orange') ? ['RESTING', 'EATING', 'CHATTING'] : ['RESTING', 'CHATTING'],
}));
export const courtyardSeats: InteractionSpot[] = [-5.2, -4.2, 4.2, 5.2].map((x, i) => ({
  id: `bench-${i}`,
  name: 'courtyard bench',
  room: 'courtyard',
  position: [x, 11.7],
  approach: [x, 10.8],
  heading: Math.PI,
  interaction: 'relaxing',
  seated: true,
  elevation: -0.25,
  uses: ['EATING', 'RESTING', 'CHATTING'],
}));
export const gymSpots: InteractionSpot[] = [
  {
    id: 'gym-treadmill',
    name: 'treadmill',
    position: [10.5, -6.45],
    approach: [10.5, -4.8],
    heading: Math.PI,
    interaction: 'treadmill',
    elevation: 0.3,
  },
  {
    id: 'gym-weights',
    name: 'dumbbells',
    position: [9.35, -3.3],
    heading: Math.PI,
    interaction: 'weights',
  },
  {
    id: 'gym-mat',
    name: 'stretching mat',
    position: [11.35, -3.7],
    heading: Math.PI,
    interaction: 'stretching',
    elevation: 0.07,
  },
].map((s) => ({
  ...s,
  interaction: s.interaction as Interaction,
  position: s.position as Point,
  approach: s.approach as Point | undefined,
  room: 'gym',
  seated: false,
  uses: ['EXERCISING'],
}));
export const coffeeMachine: InteractionSpot = {
  id: 'coffee-machine',
  name: 'coffee machine',
  room: 'cafe',
  position: [6.3, -6.9],
  heading: Math.PI,
  interaction: 'coffee',
  seated: false,
  uses: ['CHATTING'],
};
const standingCoffee: InteractionSpot[] = [
  [2.7, -2.8],
  [3.8, -2.5],
  [6.9, -3.1],
].map((p, i) => ({
  id: `coffee-chat-${i}`,
  name: 'coffee corner',
  room: 'cafe',
  position: p as Point,
  heading: Math.atan2(5 - p[0], -4.2 - p[1]),
  interaction: 'chatting',
  seated: false,
  uses: ['CHATTING'],
}));
export const sharedSpots: InteractionSpot[] = [
  ...seats,
  coffeeMachine,
  ...cafeSeats,
  ...standingCoffee,
  ...gymSpots,
  ...loungeSeats,
  ...courtyardSeats,
];
export function allSpots(employees: Employee[]) {
  return [...sharedSpots, ...employees.map(homeSpot)];
}
export function waitingSpot(room: RoomId, index: number): InteractionSpot {
  // Queues have their own standing points, clear of the furniture and entrances.
  const points: Record<RoomId, Point[]> = {
    cafe: [
      [7.3, -2.7],
      [7.7, -3.4],
      [7.5, -4.2],
      [6.5, -2.5],
      [4, -2.5],
      [2.7, -2.8],
    ],
    gym: [
      [12.2, -2.6],
      [12.2, -3.4],
      [12.2, -4.2],
      [12.2, -5],
    ],
    meeting: [
      [0.95, -3.1],
      [0.95, -4],
      [0.95, -5],
      [0.95, -6],
    ],
    lounge: [
      [2.3, 3.3],
      [2.3, 4.1],
      [2.3, 5],
      [7.6, 2],
    ],
    studio: [
      [-11.5, 0.8],
      [-10.7, 0.8],
      [-9.9, 0.8],
    ],
    ceo: [
      [-7.3, -3],
      [-8.1, -3],
    ],
    reception: [
      [9, 5],
      [9, 6],
    ],
    courtyard: [
      [-2, 10.5],
      [-1.2, 10.5],
      [1.2, 10.5],
      [2, 10.5],
    ],
  };
  const positions = points[room];
  const point = positions[index % positions.length];
  return {
    id: `waiting-${room}-${index}`,
    name: 'waiting area',
    room,
    position: [...point],
    heading: Math.PI,
    interaction: 'waiting',
    seated: false,
    uses: ['IDLE'],
    elevation: room === 'courtyard' ? -0.25 : 0,
  };
}
