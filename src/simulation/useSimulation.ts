import { useEffect } from 'react';
import { useOffice } from '../store';
import { initialize, stepOffice } from './engine';
import { api, getSnapshot } from '../api';
export function useSimulation() {
  const ready = useOffice((s) => !!s.snapshot);
  useEffect(() => {
    if (!ready) return;
    const s = useOffice.getState();
    const saved = s.snapshot!.simulation;
    const elapsed = Math.min(Math.max(0, Date.now() - saved.savedAt), 8 * 60 * 60 * 1000) / 5000;
    const minute = (saved.minute + elapsed) % 1440;
    const reconstructed = initialize(s.employees, minute, s.snapshot?.meetings, Date.now());
    for (const e of s.employees)
      if (saved.history?.[e.id]?.length)
        reconstructed[e.id].history = [
          ...saved.history[e.id],
          { time: minute, text: 'Office reopened; schedule reconstructed' },
        ].slice(-30);
    s.patch({ minute, runtime: reconstructed });
    const history = () =>
      Object.fromEntries(
        Object.entries(useOffice.getState().runtime).map(([id, r]) => [id, r.history.slice(-10)]),
      );
    let last = performance.now();
    let lastSave = performance.now();
    const tick = setInterval(() => {
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 2);
      last = now;
      const s = useOffice.getState();
      if (!s.speed) return;
      const minute = (s.minute + (dt * s.speed) / 5) % 1440;
      const runtime = stepOffice(
        s.employees,
        s.runtime,
        minute,
        dt * s.speed,
        s.snapshot?.meetings,
        Date.now(),
      );
      s.patch({ minute, runtime });
      if (now - lastSave > 15000) {
        lastSave = now;
        api('/simulation', {
          method: 'PUT',
          body: JSON.stringify({ minute, savedAt: Date.now(), history: history() }),
        }).catch(() => {});
      }
    }, 200);
    const save = () => {
      const s = useOffice.getState();
      fetch('/api/simulation', {
        method: 'PUT',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          ...(sessionStorage.getItem('ceo-token')
            ? { Authorization: `Bearer ${sessionStorage.getItem('ceo-token')}` }
            : {}),
        },
        body: JSON.stringify({ minute: s.minute, savedAt: Date.now(), history: history() }),
      }).catch(() => {});
    };
    window.addEventListener('pagehide', save);
    return () => {
      clearInterval(tick);
      window.removeEventListener('pagehide', save);
      save();
    };
  }, [ready]);
  useEffect(() => {
    let stopped = false;
    let socket: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout>;
    async function connect() {
      try {
        const { ticket } = await api<{ ticket: string }>('/ws-ticket', {
          method: 'POST',
          body: '{}',
        });
        if (stopped) return;
        socket = new WebSocket(
          `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?ticket=${ticket}`,
        );
        socket.onmessage = () => {
          getSnapshot()
            .then((s) => useOffice.getState().setSnapshot(s))
            .catch(() => {});
        };
        socket.onclose = () => {
          if (!stopped) retry = setTimeout(connect, 5000);
        };
      } catch {
        if (!stopped) retry = setTimeout(connect, 10000);
      }
    }
    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      socket?.close();
    };
  }, []);
}
