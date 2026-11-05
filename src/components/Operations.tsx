import { useState } from 'react';
import {
  Settings2,
  ShieldCheck,
  Sun,
  Cloud,
  RefreshCw,
  Check,
  Activity,
  GitBranch,
  AlertCircle,
  Clock3,
  Coffee,
  ArrowUpRight,
} from 'lucide-react';
import { useOffice } from '../store';
import { api, getSnapshot } from '../api';
import { Empty, ErrorText, Submit, useAction, dateTime, post } from './common';
export function SettingsPanel() {
  const s = useOffice();
  const [city, setCity] = useState(s.snapshot?.weather.city || 'Manila');
  const [lat, setLat] = useState('14.5995');
  const [lon, setLon] = useState('120.9842');
  const [zone, setZone] = useState(s.snapshot?.weather.timezone || 'Asia/Manila');
  const [authToken, setToken] = useState('');
  const action = useAction();
  const weather = s.snapshot?.weather;
  return (
    <div className="panel-content">
      <h2>Settings</h2>
      <div className="settings-block">
        <h3>
          <Settings2 size={15} />
          Office experience
        </h3>
        <label className="toggle-row">
          <div>
            <strong>Lightweight 2D view</strong>
            <small>For smaller devices and reduced motion</small>
          </div>
          <input
            type="checkbox"
            checked={s.reduced}
            onChange={(e) => s.patch({ reduced: e.target.checked })}
          />
        </label>
        <label className="toggle-row">
          <div>
            <strong>Room and teammate labels</strong>
          </div>
          <input
            type="checkbox"
            checked={s.labels}
            onChange={(e) => s.patch({ labels: e.target.checked })}
          />
        </label>
        <label className="toggle-row">
          <div>
            <strong>Evening lighting</strong>
          </div>
          <input
            type="checkbox"
            checked={s.night}
            onChange={(e) => s.patch({ night: e.target.checked, autoLighting: false })}
          />
        </label>
        <label className="toggle-row">
          <div>
            <strong>Follow local day and night</strong>
            <small>Use the weather location’s timezone</small>
          </div>
          <input
            type="checkbox"
            checked={s.autoLighting}
            onChange={(e) => s.patch({ autoLighting: e.target.checked })}
          />
        </label>
      </div>
      <form
        className="stacked-form settings-block"
        onSubmit={async (e) => {
          e.preventDefault();
          await action.execute(
            () =>
              api('/weather', {
                method: 'PUT',
                body: JSON.stringify({
                  city,
                  latitude: Number(lat),
                  longitude: Number(lon),
                  timezone: zone,
                }),
              }),
            'Office location updated',
          );
        }}
      >
        <h3>
          <Sun size={16} />
          Weather
        </h3>
        <label>
          City
          <input required value={city} onChange={(e) => setCity(e.target.value)} />
        </label>
        <div className="form-columns">
          <label>
            Latitude
            <input
              required
              type="number"
              step="any"
              min={-90}
              max={90}
              value={lat}
              onChange={(e) => setLat(e.target.value)}
            />
          </label>
          <label>
            Longitude
            <input
              required
              type="number"
              step="any"
              min={-180}
              max={180}
              value={lon}
              onChange={(e) => setLon(e.target.value)}
            />
          </label>
        </div>
        <label>
          Timezone
          <input
            required
            placeholder="Asia/Manila"
            value={zone}
            onChange={(e) => setZone(e.target.value)}
          />
        </label>
        <Submit busy={action.busy}>Update location & weather</Submit>
        <div className="weather-source">
          <Cloud size={14} />
          <p>
            {weather?.provider || 'Open-Meteo'} · {weather?.source || 'offline'}
            <br />
            {weather?.fetchedAt
              ? `Last checked ${dateTime(weather.fetchedAt)}`
              : 'Offline sample conditions; no live reading received.'}
          </p>
        </div>
      </form>
      <div className="settings-block">
        <h3>
          <ShieldCheck size={16} />
          Real development agents
        </h3>
        <div className="service-state">
          <i className={s.snapshot?.codex.executionReady ? 'online' : ''} />
          <div>
            <strong>{s.snapshot?.codex.version || 'Execution service not connected'}</strong>
            <p>{s.snapshot?.codex.detail || 'Start the local backend to connect.'}</p>
          </div>
        </div>
        <p className="microcopy">
          Build the agent image using Docker, configure CODEX_API_KEY or CODEX_AUTH_VOLUME, then
          connect a committed Git repository in Projects. Jobs use isolated copies; changes require
          review. See README.md for exact setup.
        </p>
        <button
          className="button secondary full"
          disabled={action.busy}
          onClick={() =>
            action.execute(() => post('/execution/check'), 'Execution status refreshed')
          }
        >
          <RefreshCw size={13} />
          Check execution service
        </button>
      </div>
      <form
        className="stacked-form settings-block"
        onSubmit={async (e) => {
          e.preventDefault();
          sessionStorage.setItem('ceo-token', authToken);
          await action.execute(() => getSnapshot(), 'CEO session connected');
        }}
      >
        <h3>
          <ShieldCheck size={16} />
          CEO access
        </h3>
        <p className="microcopy">
          Local access is available on loopback. Remote access requires the server’s CEO_TOKEN. Your
          token is kept only in this browser tab’s session storage.
        </p>
        <label>
          CEO token
          <input
            type="password"
            value={authToken}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
            placeholder="Enter your server token"
          />
        </label>
        <Submit busy={action.busy}>Connect CEO session</Submit>
      </form>
      <ErrorText error={action.error} />
    </div>
  );
}
export function BriefingPanel() {
  const s = useOffice();
  const jobs = (s.snapshot?.jobs || []).filter((j) => j.kind !== 'content-ideas' && j.kind !== 'assistant-chat' && j.kind !== 'communication-review' && j.kind !== 'shift-review');
  const completed = jobs.filter((j) => j.state === 'COMPLETED');
  const pending = jobs.filter((j) => ['REVIEW', 'DRAFT', 'AWAITING_APPROVAL'].includes(j.state));
  const active = jobs.filter((j) =>
    ['QUEUED', 'PLANNING', 'RUNNING', 'TESTING', 'VERIFYING'].includes(j.state),
  );
  const blockers = jobs.filter((j) => ['FAILED', 'INTERRUPTED', 'UNVERIFIED'].includes(j.state));
  const today = new Date().toDateString();
  const todays = jobs.filter((j) => new Date(j.updatedAt).toDateString() === today);
  return (
    <div className="panel-content">
      <span className="eyebrow">A MOMENT TO SEE THE BIG PICTURE</span>
      <h2>Your daily briefing</h2>
      <div className="work-actions">
        <button className="text-button" onClick={() => s.open('work')}>
          Work knowledge
        </button>
        <button className="text-button" onClick={() => s.open('connections')}>
          Connected applications
        </button>
      </div>
      <p>
        {new Date().toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
        })}{' '}
        · Based on saved company records
      </p>
      <div className="briefing-grid">
        <div>
          <Check size={18} />
          <strong>{completed.length}</strong>
          <span>Accepted</span>
        </div>
        <div>
          <Activity size={18} />
          <strong>{active.length}</strong>
          <span>In progress</span>
        </div>
        <div>
          <Clock3 size={18} />
          <strong>{pending.length}</strong>
          <span>Need your review</span>
        </div>
        <div>
          <AlertCircle size={18} />
          <strong>{blockers.length}</strong>
          <span>Blockers</span>
        </div>
      </div>
      <div className="briefing-section">
        <h3>What’s happening today</h3>
        {!todays.length ? (
          <p>No development activity recorded today. A fresh start awaits.</p>
        ) : (
          todays.map((j) => (
            <button className="briefing-job" key={j.id} onClick={() => s.open('projects')}>
              <span>{j.title}</span>
              <small>{j.state.toLowerCase()}</small>
              <ArrowUpRight size={13} />
            </button>
          ))
        )}
      </div>
      <div className="briefing-section">
        <h3>Decisions on your desk</h3>
        {pending.length ? (
          pending.map((j) => (
            <p key={j.id}>
              {j.state === 'DRAFT'
                ? 'Planning approval'
                : j.state === 'AWAITING_APPROVAL'
                  ? 'Execution approval'
                  : 'Result review'}
              : {j.title}
            </p>
          ))
        ) : (
          <p>All clear. Nothing is waiting for your approval.</p>
        )}
      </div>
      <div className="briefing-section">
        <h3>Test results from execution</h3>
        {jobs.some((j) => j.testResult !== 'Not run') ? (
          jobs
            .filter((j) => j.testResult !== 'Not run')
            .map((j) => (
              <p key={j.id}>
                <strong>{j.title}</strong>
                <br />
                {j.testResult.slice(0, 500)}
              </p>
            ))
        ) : (
          <p>No tests have run. The briefing will show real saved results as jobs finish.</p>
        )}
      </div>
      <div className="callout">
        <Coffee size={17} />
        <p>
          Office life · simulated
          <br />
          {Object.values(s.runtime).filter((r) => r.state === 'WORKING').length} teammates at work,{' '}
          {Object.values(s.runtime).filter((r) => r.state === 'WALKING').length} on the move. These
          activities are separate from technical execution.
        </p>
      </div>
      <button
        className="button secondary full"
        onClick={() => {
          s.focus('ceo');
          s.open(null);
        }}
      >
        Take a moment in your office
        <ArrowUpRight size={14} />
      </button>
    </div>
  );
}
export function ActivityPanel() {
  const jobs = useOffice((s) => s.snapshot?.jobs) || [];
  const activity = jobs
    .flatMap((j) => [
      { at: j.createdAt, text: `Task created: ${j.title}`, job: j },
      ...j.logs.map((l) => ({ ...l, job: j })),
    ])
    .toSorted((a, b) => b.at - a.at)
    .slice(0, 100);
  return (
    <div className="panel-content">
      <span className="eyebrow">THE WORK BEHIND THE WORLD</span>
      <h2>Development activity</h2>
      <p>Actual task events and saved execution logs.</p>
      {!activity.length && (
        <Empty title="A quiet start">
          Approved development runs will appear here. Office animations do not produce technical
          activity.
        </Empty>
      )}
      <div className="activity-feed">
        {activity.map((event, i) => (
          <article key={i}>
            <span>
              <GitBranch size={13} />
            </span>
            <div>
              <time>{dateTime(event.at)}</time>
              <strong>{event.job.title}</strong>
              <pre>{event.text.slice(0, 1500)}</pre>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
