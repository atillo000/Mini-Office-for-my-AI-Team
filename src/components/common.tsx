import { useState } from 'react';
import { useOffice } from '../store';
import { api, getSnapshot } from '../api';
import { LoaderCircle } from 'lucide-react';
import { outfits } from '../../shared/appearance';
export function Portrait({ id, small = false }: { id: string; small?: boolean }) {
  const e = useOffice((s) => s.employees.find((e) => e.id === id));
  return (
    <span
      className={`portrait ${small ? 'small' : ''}`}
      style={
        {
          background: (outfits[id]?.shirt || e?.color || '#64748b') + '1c',
          '--skin': e?.skin,
          '--hair': e?.hair,
          '--shirt': outfits[id]?.shirt || e?.color,
        } as React.CSSProperties
      }
    >
      <span className="portrait-hair" />
      <span className="portrait-head">
        <i />
        <i />
      </span>
      <span className="portrait-shirt" />
    </span>
  );
}
export function Status({ state }: { state: string }) {
  return (
    <span className={`status ${state.toLowerCase()}`}>
      <i />
      {state === 'WORKING'
        ? 'At their desk'
        : state === 'WALKING'
          ? 'On the move'
          : state.toLowerCase().replaceAll('_', ' ')}
    </span>
  );
}
export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return {
    busy,
    error,
    execute: async <T,>(work: () => Promise<T>, message?: string): Promise<T | undefined> => {
      setBusy(true);
      setError('');
      try {
        const result = await work();
        useOffice.getState().setSnapshot(await getSnapshot());
        if (message) useOffice.getState().notify(message);
        return result;
      } catch (e) {
        setError((e as Error).message);
        return undefined;
      } finally {
        setBusy(false);
      }
    },
  };
}
export function ErrorText({ error }: { error: string }) {
  return error ? (
    <p className="form-error" role="alert">
      {error}
    </p>
  ) : null;
}
export function Submit({
  busy,
  children,
  disabled = false,
}: {
  busy: boolean;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button type="submit" className="button primary full" disabled={busy || disabled}>
      {busy && <LoaderCircle size={15} className="spin" />}
      {children}
    </button>
  );
}
export function dateTime(at: number) {
  return new Date(at).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
export async function post<T = unknown>(path: string, data: unknown = {}) {
  return api<T>(path, { method: 'POST', body: JSON.stringify(data) });
}
