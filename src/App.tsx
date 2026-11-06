import { useEffect, useState, lazy, Suspense } from 'react';
import {
  Building2,
  Users,
  FolderKanban,
  Mail,
  CalendarDays,
  Activity,
  Settings2,
  Plus,
  ArrowUpRight,
  ArrowRight,
  Clock3,
  ChevronDown,
  Sun,
  Moon,
  CloudRain,
  Cloud,
  Maximize,
  ZoomIn,
  ZoomOut,
  X,
  Check,
  PanelRightClose,
  Plug,
  BriefcaseBusiness,
  Compass,
} from 'lucide-react';
import { useOffice, type Panel } from './store';
import { getSnapshot } from './api';
import { rooms } from '../shared/seed';
import { Panels, EmployeePanel } from './components/Panels';
import { useTeamRuntime } from './team/useTeamRuntime';
import { outfits } from '../shared/appearance';
import OfficeActivity from './components/OfficeActivity';
import { NotificationBell } from './components/ActionInbox';
const Office = lazy(() => import('./world/Office'));
const nav: { id: Panel; icon: typeof Users; label: string }[] = [
  { id: 'start', icon: Compass, label: 'Start here' },
  { id: 'focus', icon: BriefcaseBusiness, label: 'My projects' },
  { id: 'inbox', icon: Mail, label: 'Inbox' },
  { id: 'timelogs', icon: Clock3, label: 'Time logs' },
  { id: 'connections', icon: Plug, label: 'Connections' },
];
const tools: { id: Panel; icon: typeof Users; label: string }[] = [
  { id: 'settings', icon: Settings2, label: 'Settings' },
  { id: 'team', icon: Users, label: 'People' },
  { id: 'projects', icon: FolderKanban, label: 'Projects' },
  { id: 'meetings', icon: CalendarDays, label: 'Meetings' },
  { id: 'activity', icon: Activity, label: 'Activity' },
  { id: 'work', icon: BriefcaseBusiness, label: 'Work knowledge' },
];
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
export default function App() {
  useTeamRuntime();
  const s = useOffice();
  const [time, setTime] = useState(new Date());
  const [roomMenu, setRoomMenu] = useState(false);

  useEffect(() => {
    let live = true;
    const load = () =>
      getSnapshot()
        .then((data) => {
          if (live) s.setSnapshot(data);
        })
        .catch((e) => {
          if (live) s.patch({ connected: false, error: e.message });
        });
    load();
    const poll = setInterval(load, 15000);
    const clock = setInterval(() => setTime(new Date()), 1000);
    return () => {
      live = false;
      clearInterval(poll);
      clearInterval(clock);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const weather = s.snapshot?.weather;
  useEffect(() => {
    if (!useOffice.getState().autoLighting) return;
    const hour = Number(
      new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        hourCycle: 'h23',
        timeZone: weather?.timezone || 'Asia/Manila',
      }).format(time),
    );
    s.patch({ night: hour < 6 || hour >= 18 });
  }, [time, s.autoLighting, weather?.timezone]); // eslint-disable-line react-hooks/exhaustive-deps
  const WeatherIcon =
    weather?.condition === 'rainy' ? CloudRain : weather?.condition === 'cloudy' ? Cloud : Sun;
  const currentRoom = rooms.find((r) => r.id === s.room);
  const unread =
    s.snapshot?.messages.filter((m) => m.mode !== 'simulation' && !m.read && m.sender !== 'ceo')
      .length || 0;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button
          className="brand-mark"
          aria-label="Mini AI Office Home"
          onClick={() => {
            s.open(null);
            s.focus(null);
          }}
        >
          <Building2 size={27} />
        </button>
        <div className="nav-main">
          <button
            className={!s.panel && !s.selected ? 'nav-button active' : 'nav-button'}
            title="Your office"
            aria-label="Your office"
            onClick={() => s.open(null)}
          >
            <Building2 size={21} />
            <span className="nav-label">Office</span>
          </button>
          {nav.map((n) => (
            <button
              key={n.id}
              title={n.label}
              aria-label={n.label}
              className={`nav-button ${s.panel === n.id ? 'active' : ''}`}
              onClick={() => s.open(s.panel === n.id ? null : n.id)}
            >
              <n.icon size={21} />
              <span className="nav-label">{n.label}</span>
              {n.id === 'inbox' && unread > 0 && <i className="nav-dot" />}
            </button>
          ))}
          <NotificationBell navigation />
          <details className="more-tools">
            <summary>More tools</summary>
            <div>
              {tools.map((n) => (
                <button
                  key={n.id}
                  className={`nav-button ${s.panel === n.id ? 'active' : ''}`}
                  aria-label={n.label}
                  onClick={() => s.open(n.id)}
                >
                  <n.icon size={20} />
                  <span>{n.label}</span>
                </button>
              ))}
            </div>
          </details>
        </div>
        <div className="nav-bottom">
          <button
            className="ceo-avatar"
            aria-label="CEO briefing"
            onClick={() => s.open('briefing')}
          >
            C<span />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <a className="wordmark" href="#" onClick={(e) => e.preventDefault()}>
            Mini AI Office
          </a>
          <div className="top-center">
            <span className={`connection-dot ${s.connected ? 'online' : ''}`} />
            {s.connected ? 'Office is live' : 'Connecting to office'}
            <span className="separator" />{' '}
            <span className="local-time">
              {time.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                timeZone: weather?.timezone || 'Asia/Manila',
              })}
            </span>
          </div>
          <div className="top-actions">
            <div className="ceo-info">
              <span className="ceo-badge">C</span>
              <div>
                <strong>My workspace</strong>
                <small>You’re the CEO</small>
              </div>
              <ChevronDown size={14} />
            </div>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <h1>
                Your office<span className="heading-dot">.</span>
              </h1>
            </div>
            <div className="heading-actions">
              <button className="button secondary" onClick={() => s.open('start')}>
                <Sun size={16} />
                Start here
                <ArrowUpRight size={15} />
              </button>
              <button className="button primary" onClick={() => s.open('assign')}>
                <Plus size={17} />
                New task
              </button>
            </div>
          </div>
          <section
            className={`world-container ${s.night ? 'night' : ''}`}
            aria-label="Interactive miniature office"
          >
            <div className="world-top">
              <div className="floor-selector">
                <button onClick={() => setRoomMenu(!roomMenu)}>
                  <span className="floor-icon">
                    <Building2 size={17} />
                  </span>
                  <div>
                    <strong>{currentRoom?.name || 'The whole office'}</strong>
                  </div>
                  <ChevronDown size={15} />
                </button>
                {roomMenu && (
                  <div className="room-menu">
                    <button
                      onClick={() => {
                        s.focus(null);
                        setRoomMenu(false);
                      }}
                    >
                      The whole office
                    </button>
                    {rooms.map((r) => (
                      <button
                        key={r.id}
                        onClick={() => {
                          s.focus(r.id);
                          setRoomMenu(false);
                        }}
                      >
                        <i style={{ background: r.color }} />
                        {r.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="world-chips">
                <span className="live-chip">
                  <i />
                  {s.employees.length} people in the office
                </span>
                <button className="weather-chip" onClick={() => s.open('settings')}>
                  <WeatherIcon size={19} />
                  <strong>{weather ? `${Math.round(weather.temperature)}°` : '—°'}</strong>
                  <span>
                    {weather?.city || 'Manila'}
                    <small>
                      {weather?.source === 'live'
                        ? 'Live weather'
                        : weather?.source === 'cached'
                          ? 'Cached weather'
                          : 'Weather offline'}
                    </small>
                  </span>
                </button>
              </div>
            </div>
            <div className="canvas-wrap">
              <Suspense
                fallback={
                  <div className="world-loading">
                    <Building2 size={36} />
                    <span>Opening the office…</span>
                  </div>
                }
              >
                <Office />
              </Suspense>
            </div>
            <div className="world-bottom">
              <div className="world-controls">
                <button
                  title="Zoom in"
                  aria-label="Zoom in"
                  onClick={() =>
                    window.dispatchEvent(new CustomEvent('office-zoom', { detail: 1.2 }))
                  }
                >
                  <ZoomIn size={17} />
                </button>
                <button
                  title="Zoom out"
                  aria-label="Zoom out"
                  onClick={() =>
                    window.dispatchEvent(new CustomEvent('office-zoom', { detail: 1 / 1.2 }))
                  }
                >
                  <ZoomOut size={17} />
                </button>
                <span />
                <button title="Fit office" aria-label="Fit office" onClick={() => s.focus(null)}>
                  <Maximize size={16} />
                </button>
                <button
                  title={s.night ? 'Day lighting' : 'Night lighting'}
                  aria-label="Toggle day and night"
                  onClick={s.toggleLighting}
                >
                  {s.night ? <Moon size={16} /> : <Sun size={17} />}
                </button>
                <button
                  title="Toggle room labels"
                  aria-label="Toggle room labels"
                  onClick={() => s.patch({ labels: !s.labels })}
                >
                  <PanelRightClose size={16} />
                </button>
              </div>
            </div>
            {(s.panel || s.selected) && (
              <div
                className={`management-panel ${['projects', 'settings', 'work', 'connections', 'start', 'inbox', 'timelogs', 'notifications'].includes(s.panel || '') ? 'wide' : ''}`}
              >
                <button
                  className="panel-close"
                  aria-label="Close panel"
                  onClick={() => {
                    s.open(null);
                    s.select(null);
                  }}
                >
                  <X size={19} />
                </button>
                {s.selected ? (
                  <EmployeePanel key={s.selected} id={s.selected} />
                ) : (
                  <Panels panel={s.panel} />
                )}
              </div>
            )}
          </section>
          <section className="team-section">
            <div className="section-heading">
              <h2>
                Your people <span>{s.employees.length}</span>
              </h2>
              <button onClick={() => s.open('team')}>
                Meet the team
                <ArrowRight size={15} />
              </button>
            </div>
            <div className="team-strip">
              {s.employees.map((e) => (
                <button
                  key={e.id}
                  className={`team-card ${s.selected === e.id ? 'selected' : ''}`}
                  onClick={() => s.select(e.id)}
                >
                  <Portrait id={e.id} />
                  <div>
                    <strong>{e.name}</strong>
                    <span className="team-role">{e.role}</span>
                    <OfficeActivity runtime={s.runtime[e.id]} />
                  </div>
                </button>
              ))}
            </div>
          </section>
        </main>
      </div>
      {s.toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {s.toast}
        </div>
      )}
      {s.error && (
        <div className="connection-banner" role="alert">
          {s.error.includes('401') ? 'Sign in with your CEO token in Settings.' : s.error}
          <button onClick={() => s.open('settings')}>Settings</button>
        </div>
      )}
    </div>
  );
}
