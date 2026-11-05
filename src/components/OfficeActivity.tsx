import {
  Armchair,
  BookOpen,
  Coffee,
  Dumbbell,
  Footprints,
  Keyboard,
  MessageCircle,
  Mic,
  Monitor,
  Users,
  Utensils,
  Clock3,
  type LucideIcon,
} from 'lucide-react';
import type { EmployeeRuntime } from '../../shared/types';
import { activityColor, activityDescription } from '../simulation/presentation';
export function ActivityIcon({ runtime, size = 12 }: { runtime?: EmployeeRuntime; size?: number }) {
  let Icon: LucideIcon = Monitor;
  if (runtime?.state === 'WALKING') Icon = Footprints;
  else if (runtime?.waitingFor) Icon = Clock3;
  else if (runtime?.state === 'MEETING') Icon = runtime.interaction === 'speaking' ? Mic : Users;
  else if (runtime?.state === 'EXERCISING') Icon = Dumbbell;
  else if (runtime?.state === 'EATING') Icon = Utensils;
  else if (runtime?.interaction === 'coffee') Icon = Coffee;
  else if (runtime?.interaction === 'chatting') Icon = MessageCircle;
  else if (runtime?.interaction === 'reading') Icon = BookOpen;
  else if (runtime?.state === 'RESTING') Icon = Armchair;
  else if (runtime?.interaction === 'typing') Icon = Keyboard;
  return <Icon size={size} aria-hidden="true" />;
}
export default function OfficeActivity({ runtime }: { runtime?: EmployeeRuntime }) {
  return (
    <span
      className="office-activity"
      data-office-state={runtime?.state || 'IDLE'}
      title={activityDescription(runtime)}
      style={{ color: activityColor(runtime) }}
    >
      <ActivityIcon runtime={runtime} />
      <span>{activityDescription(runtime)}</span>
    </span>
  );
}
