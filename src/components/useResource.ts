import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
// Panels fetch corporate work data on demand; it never enters office simulation snapshots.
export function useResource<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++sequence.current;
    if (!url) {
      setData(null);
      setError('');
      return;
    }
    try {
      const next = await api<T>(url);
      if (id === sequence.current) {
        setData(next);
        setError('');
      }
    } catch (e) {
      if (id === sequence.current) setError((e as Error).message);
    }
  }, [url]);
  useEffect(() => {
    void refresh();
    // This is a request counter, not a DOM ref; invalidate pending requests on unmount.
    return () => {
      sequence.current += 1;
    };
  }, [refresh]);
  return { data, error, refresh };
}
