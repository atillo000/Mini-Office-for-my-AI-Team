import { useEffect, useRef, useState } from 'react';
import { Bell, ArrowUpRight } from 'lucide-react';
import type { NotificationItem } from '../../shared/connected';
import { useResource } from './useResource';
import { api } from '../api';
import { useOffice } from '../store';
import { ErrorText, dateTime } from './common';
export function useNotifications() {
  const resource = useResource<{ items: NotificationItem[] }>('/notifications');
  const refresh = resource.refresh;
  const snapshot = useOffice((s) => s.snapshot);
  useEffect(() => {
    void refresh();
  }, [snapshot, refresh]);
  useEffect(() => {
    const timer = setInterval(() => void refresh(), 10000);
    return () => clearInterval(timer);
  }, [refresh]);
  return resource;
}
export function NotificationBell() {
  const { data } = useNotifications();
  const seen = useRef<Set<string> | null>(null);
  const items = data?.items,
    unread = items?.filter((n) => !n.read).length || 0;
  useEffect(() => {
    if (!items) return;
    const keys = new Set(items.map((n) => n.id + ':' + n.revision));
    if (
      seen.current &&
      localStorage.getItem('office-desktop-notifications') === 'on' &&
      'Notification' in window &&
      Notification.permission === 'granted'
    ) {
      const fresh = items.filter((n) => !n.read && !seen.current!.has(n.id + ':' + n.revision));
      if (fresh.length) {
        const notice = new Notification('AI Office', {
          body: fresh.length + ' new item(s) need your attention.',
          tag: 'ai-office-actions',
        });
        notice.onclick = () => {
          window.focus();
          useOffice.getState().open('notifications');
          notice.close();
        };
      }
    }
    seen.current = keys;
  }, [items]);
  return (
    <button
      className="notification-button"
      aria-label={'Notifications' + (unread ? ' (' + unread + ' unread)' : '')}
      title="Action inbox"
      onClick={() => useOffice.getState().open('notifications')}
    >
      <Bell size={19} />
      {unread > 0 && <span className="notification-count">{unread > 99 ? '99+' : unread}</span>}
    </button>
  );
}
export function ActionInbox() {
  const { data, error, refresh } = useNotifications();
  const [filter, setFilter] = useState('ALL'),
    [failure, setFailure] = useState('');
  const [desktop, setDesktop] = useState(
    localStorage.getItem('office-desktop-notifications') === 'on',
  );
  const open = async (item: NotificationItem) => {
    try {
      await api('/notifications/' + encodeURIComponent(item.id) + '/read', {
        method: 'POST',
        body: JSON.stringify({ revision: item.revision }),
      });
    } catch (e) {
      setFailure((e as Error).message);
      return;
    }
    useOffice.getState().patch({
      panel: item.target.panel,
      selected: null,
      targetId: item.target.id,
      targetChannel: item.target.channel || null,
    });
  };
  return (
    <div className="panel-content">
      <h2>Action inbox</h2>
      <p>Approvals, Outlook email and real team replies.</p>
      <div className="panel-tabs">
        {['ALL', 'URGENT', 'APPROVAL', 'EMAIL', 'CHAT', 'RESULT', 'ERROR'].map((f) => (
          <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
            {f.toLowerCase()}
          </button>
        ))}
      </div>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={desktop}
          onChange={async (e) => {
            const enabled = e.target.checked;
            if (
              enabled &&
              (!('Notification' in window) ||
                (await Notification.requestPermission()) !== 'granted')
            ) {
              setFailure(
                'Browser notifications are unavailable or were declined. In-app alerts stay enabled.',
              );
              return;
            }
            localStorage.setItem('office-desktop-notifications', enabled ? 'on' : 'off');
            setDesktop(enabled);
          }}
        />
        <span>Desktop notifications while the office is open</span>
      </label>
      <ErrorText error={error || failure} />
      <div className="action-items">
        {data?.items
          .filter((n) => filter === 'ALL' || n.category === filter)
          .map((item) => (
            <article key={item.id} className={item.read ? 'read' : 'unread'}>
              <button className="action-open" onClick={() => open(item)}>
                <small>
                  {item.category.toLowerCase()} · {dateTime(item.at)}
                </small>
                <strong>{item.title}</strong>
                <p>{item.detail}</p>
                <span>
                  {item.actions.includes('REVIEW')
                    ? 'Review and act'
                    : item.actions.includes('REPLY')
                      ? 'Open and reply'
                      : 'Open result'}{' '}
                  <ArrowUpRight size={13} />
                </span>
              </button>
              {!item.read && (
                <button
                  className="text-button"
                  onClick={async () => {
                    try {
                      await api('/notifications/' + encodeURIComponent(item.id) + '/read', {
                        method: 'POST',
                        body: JSON.stringify({ revision: item.revision }),
                      });
                      await refresh();
                    } catch (e) {
                      setFailure((e as Error).message);
                    }
                  }}
                >
                  Mark read
                </button>
              )}
            </article>
          ))}
      </div>
      {data?.items.length === 0 && <p>You're all caught up.</p>}
      <p className="microcopy">
        Desktop alerts require this app to be open. A read marker never approves or sends anything.
      </p>
    </div>
  );
}
