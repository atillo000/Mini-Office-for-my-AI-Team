import { useEffect, useRef, useState } from 'react';
import { Bell, ArrowUpRight, Search } from 'lucide-react';
import type { NotificationItem } from '../../shared/connected';
import { useResource } from './useResource';
import { api } from '../api';
import { useOffice } from '../store';
import { ErrorText, dateTime } from './common';
import { InboxGroup } from './InboxGroup';
import {
  matchesSearch,
  notificationGroup,
  notificationGroups,
  notificationLabel,
} from './inbox-groups';
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
export function NotificationBell({ navigation = false }: { navigation?: boolean }) {
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
      className={navigation ? 'nav-button notification-button' : 'notification-button'}
      aria-label={'Notifications' + (unread ? ' (' + unread + ' unread)' : '')}
      title="Action inbox"
      onClick={() => useOffice.getState().open('notifications')}
    >
      <Bell size={19} />
      {navigation && <span className="nav-label">Notifications</span>}
      {unread > 0 && <span className="notification-count">{unread > 99 ? '99+' : unread}</span>}
    </button>
  );
}
export function ActionInbox() {
  const { data, error, refresh } = useNotifications();
  const [query, setQuery] = useState(''),
    [unreadOnly, setUnreadOnly] = useState(false);
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
      <h2>Notifications</h2>
      <p className="microcopy">Choose a category, then open an item to take action.</p>
      <label className="search-box">
        <Search size={16} />
        <input
          type="search"
          aria-label="Search notifications"
          placeholder="Search project, person, date or message"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="inbox-filters">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(e) => setUnreadOnly(e.target.checked)}
          />
          Unread only
        </label>
        <select
          aria-label="Notification type"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="ALL">All types</option>
          <option value="APPROVAL">Needs a decision</option>
          <option value="ERROR">Needs attention</option>
          <option value="URGENT">Urgent</option>
        </select>
      </div>
      <details>
        <summary>Desktop alert settings</summary>
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
      </details>
      <ErrorText error={error || failure} />
      <div className="action-items">
        {notificationGroups.map((group) => {
          const items = (data?.items || []).filter(
            (n) =>
              notificationGroup(n) === group.id &&
              (!unreadOnly || !n.read) &&
              (filter === 'ALL' || n.category === filter) &&
              matchesSearch(
                query,
                n.title,
                n.detail,
                group.title,
                notificationLabel(n),
                dateTime(n.at),
              ),
          );
          if (!items.length) return null;
          return (
            <InboxGroup
              key={group.id}
              title={group.title}
              description={group.description}
              count={items.length}
              initiallyOpen={group.open}
              forceOpen={!!query.trim()}
            >
              {items.map((item) => (
                <article key={item.id} className={item.read ? 'read' : 'unread'}>
                  <button className="action-open" onClick={() => open(item)}>
                    <small>
                      <span className={'notice-kind notice-' + item.category.toLowerCase()}>
                        {notificationLabel(item)}
                      </span>{' '}
                      · {dateTime(item.at)}
                      {!item.read && ' · New'}
                    </small>
                    <strong>{item.title}</strong>
                    <p className="notice-preview">{item.detail}</p>
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
            </InboxGroup>
          );
        })}
      </div>
      {data?.items.length === 0 && <p>You're all caught up.</p>}
      {!!data?.items.length &&
        !data.items.some(
          (n) =>
            (!unreadOnly || !n.read) &&
            (filter === 'ALL' || n.category === filter) &&
            matchesSearch(
              query,
              n.title,
              n.detail,
              notificationGroups.find((g) => g.id === notificationGroup(n))?.title,
              notificationLabel(n),
              dateTime(n.at),
            ),
        ) && <p>No notifications match your search.</p>}
      <p className="microcopy">
        Opening or marking an item read does not change its approval timer.
      </p>
    </div>
  );
}
