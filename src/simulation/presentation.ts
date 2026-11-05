import type { EmployeeRuntime, Interaction } from '../../shared/types';
import { rooms } from '../../shared/seed';
const names: Record<Interaction, string> = {
  none: 'Arriving',
  typing: 'Typing',
  reading: 'Reading',
  speaking: 'Meeting · speaking',
  listening: 'Meeting · listening',
  coffee: 'Getting coffee',
  chatting: 'Coffee & conversation',
  eating: 'Having lunch',
  treadmill: 'Gym · treadmill',
  weights: 'Gym · dumbbells',
  stretching: 'Gym · stretching',
  relaxing: 'Taking a breather',
  reporting: 'CEO check-in',
  waiting: 'Waiting',
};
export function activityDescription(r?: EmployeeRuntime) {
  if (r?.realStatus) return r.realStatus;
  if (!r) return 'Arriving at the office';
  if (r.state === 'WALKING')
    return (r.blockedSeconds || 0) > 0.4
      ? 'Giving way'
      : `Walking to ${
          rooms
            .find((room) => room.id === r.targetRoom)
            ?.name.replace(/^The /, '')
            .toLowerCase() || 'next activity'
        }`;
  if (r.waitingFor) return `Waiting for ${r.waitingFor}`;
  return names[r.interaction || 'none'] || r.state.toLowerCase();
}
export function activityColor(r?: EmployeeRuntime) {
  return r?.waitingFor
    ? '#af8551'
    : r?.state === 'WALKING'
      ? '#597da4'
      : r?.state === 'EXERCISING'
        ? '#ac735c'
        : r?.state === 'MEETING'
          ? '#82739e'
          : r?.state === 'EATING' || r?.state === 'CHATTING'
            ? '#ad8b46'
            : '#62816b';
}
