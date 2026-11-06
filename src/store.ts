import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { initialEmployees } from '../shared/seed';
import type { Employee, EmployeeRuntime, Snapshot, RoomId } from '../shared/types';
export type Panel =
  | 'team'
  | 'projects'
  | 'inbox'
  | 'meetings'
  | 'activity'
  | 'settings'
  | 'briefing'
  | 'assign'
  | 'work'
  | 'connections'
  | 'start'
  | 'notifications'
  | 'timelogs'
  | 'focus'
  | null;
interface OfficeState {
  targetId: string | null;
  targetChannel: string | null;
  employees: Employee[];
  runtime: Record<string, EmployeeRuntime>;
  snapshot: Snapshot | null;
  selected: string | null;
  panel: Panel;
  room: RoomId | null;
  focusVersion: number;
  minute: number;
  speed: number;
  night: boolean;
  autoLighting: boolean;
  reduced: boolean;
  labels: boolean;
  connected: boolean;
  error: string;
  toast: string;
  select: (id: string | null) => void;
  open: (panel: Panel) => void;
  focus: (room: RoomId | null) => void;
  toggleLighting: () => void;
  setSnapshot: (data: Snapshot) => void;
  patch: (data: Partial<OfficeState>) => void;
  notify: (message: string) => void;
}
export const useOffice = create<OfficeState>()(
  persist(
    (set) => ({
      employees: initialEmployees,
      runtime: {},
      snapshot: null,
      selected: null,
      targetId: null,
      targetChannel: null,
      panel: null,
      room: null,
      focusVersion: 0,
      minute: 9 * 60 + 28,
      speed: 1,
      night: false,
      autoLighting: true,
      reduced:
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      labels: true,
      connected: false,
      error: '',
      toast: '',
      select: (selected) => set({ selected, panel: null }),
      open: (panel) => set({ panel, selected: null, targetId: null, targetChannel: null }),
      focus: (room) => set((s) => ({ room, focusVersion: s.focusVersion + 1 })),
      toggleLighting: () => set((s) => ({ night: !s.night, autoLighting: false })),
      setSnapshot: (snapshot) =>
        set({
          snapshot,
          employees: snapshot.employees,
          connected: true,
          error: '',
        }),
      patch: (data) => set(data),
      notify: (toast) => {
        set({ toast });
        setTimeout(() => set({ toast: '' }), 4500);
      },
    }),
    {
      name: 'little-company-view',
      partialize: (s) => ({
        night: s.night,
        autoLighting: s.autoLighting,
        reduced: s.reduced,
        labels: s.labels,
      }),
    },
  ),
);
