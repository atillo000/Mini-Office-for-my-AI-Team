import { useEffect, useState } from 'react';
import type { TimeAudit as Audit } from '../../shared/audit';
import type { ZohoEntity } from '../../shared/connected';
import { api } from '../api';
import { useOffice } from '../store';
import { ErrorText, useAction, post, dateTime } from './common';
const localDate = (at: number) => new Date(at + 28800000).toISOString().slice(0, 10);
export function TimeAudit({ reviewShift }: { reviewShift: () => void }) {
  const [portal, setPortal] = useState(''),
    [owner, setOwner] = useState(''),
    [portals, setPortals] = useState<ZohoEntity[]>([]),
    [users, setUsers] = useState<ZohoEntity[]>([]),
    [project, setProject] = useState('');
  const [start, setStart] = useState(() => localDate(Date.now() - 6 * 86400000)),
    [end, setEnd] = useState(() => localDate(Date.now())),
    [audit, setAudit] = useState<Audit | null>(null);
  const action = useAction();
  useEffect(() => {
    void api<{
      portalId?: string;
      ownerId?: string;
      projectId?: string;
      ownerName?: string;
      lastAudit?: Audit;
    }>('/zoho/work-context')
      .then((hints) => {
        if (hints.lastAudit) {
          setAudit(hints.lastAudit);
          setStart(hints.lastAudit.startDate);
          setEnd(hints.lastAudit.endDate);
        }
        if (hints.portalId) setPortal(hints.portalId);
        if (hints.projectId) setProject(hints.projectId);
        if (hints.ownerId) {
          setOwner(hints.ownerId);
          setUsers([{ id: hints.ownerId, name: hints.ownerName || 'Previously selected user' }]);
        }
      })
      .catch(() => undefined);
  }, []);
  return (
    <section className="time-audit">
      <h3>Check logged and missing dates</h3>
      <p>
        Reads Zoho entries, including those you added manually. Local drafts are shown separately
        and never count as submitted hours.
      </p>
      <form
        className="stacked-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const result = await action.execute(() =>
            post<Audit>('/zoho/audit', {
              portalId: portal,
              ownerId: owner,
              startDate: start,
              endDate: end,
            }),
          );
          if (result) setAudit(result);
        }}
      >
        <button
          type="button"
          className="text-button"
          disabled={action.busy}
          onClick={() =>
            void action.execute(async () =>
              setPortals((await api<{ items: ZohoEntity[] }>('/zoho/discover?kind=portals')).items),
            )
          }
        >
          Load portals
        </button>
        <label>
          Portal
          <select
            required
            value={portal}
            onChange={(e) => {
              setPortal(e.target.value);
              setOwner('');
              setUsers([]);
              setAudit(null);
            }}
          >
            <option value="">Choose portal</option>
            {portals.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            {portal && !portals.some((p) => p.id === portal) && (
              <option value={portal}>Previously selected portal</option>
            )}
          </select>
        </label>
        <button
          type="button"
          className="text-button"
          disabled={action.busy || !portal}
          onClick={() =>
            void action.execute(async () => {
              let id = project;
              if (!id) {
                const projects = await api<{ items: ZohoEntity[] }>(
                  '/zoho/discover?' + new URLSearchParams({ kind: 'projects', portalId: portal }),
                );
                id = projects.items[0]?.id || '';
                setProject(id);
              }
              if (!id) throw new Error('No accessible project was returned. Connect Zoho first.');
              setUsers(
                (
                  await api<{ items: ZohoEntity[] }>(
                    '/zoho/discover?' +
                      new URLSearchParams({ kind: 'users', portalId: portal, projectId: id }),
                  )
                ).items,
              );
            })
          }
        >
          Load project users
        </button>
        <label>
          My Zoho user
          <select
            required
            value={owner}
            onChange={(e) => {
              setOwner(e.target.value);
              setAudit(null);
            }}
          >
            <option value="">Select yourself</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        <div className="form-pair">
          <label>
            From
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} required />
          </label>
          <label>
            Through
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} required />
          </label>
        </div>
        <button className="button primary" disabled={action.busy || !portal || !owner}>
          Check Zoho dates
        </button>
        <ErrorText error={action.error} />
      </form>
      {audit && (
        <>
          <p className="microcopy">
            Checked {dateTime(audit.checkedAt)} · selected portal and user only. A failed or
            incomplete check is never reported as missing time.
          </p>
          <div className="audit-table">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>In Zoho</th>
                  <th>Work target</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {audit.days.map((day) => (
                  <tr key={day.date}>
                    <td>{day.date}</td>
                    <td>
                      {day.loggedMinutes === null
                        ? 'Unknown'
                        : (day.loggedMinutes / 60).toFixed(2) + 'h'}
                    </td>
                    <td>
                      {day.expectedMinutes === null
                        ? 'No shift evidence'
                        : (day.expectedMinutes / 60).toFixed(2) + 'h'}
                    </td>
                    <td>
                      {day.state.toLowerCase().replaceAll('_', ' ')}
                      {['MISSING', 'PARTIAL'].includes(day.state) && (
                        <button className="text-button" onClick={reviewShift}>
                          Review shift plan
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {audit.days.map((day) => (
            <details key={day.date}>
              <summary>
                {day.date} · {day.items.length} provider entries · {day.localDrafts.length} local
                drafts
              </summary>
              {day.items.map((log) => (
                <p key={log.id}>
                  {log.projectName} · {log.minutes ?? 'Unknown'} minutes · {log.description}
                </p>
              ))}
              {day.duplicateCandidates.length > 0 && (
                <p>
                  Matching entries already exist in Zoho. Review local drafts before creating
                  duplicates.
                </p>
              )}
            </details>
          ))}
        </>
      )}
      <button className="text-button" onClick={() => useOffice.getState().open('focus')}>
        Set up my project focus
      </button>
    </section>
  );
}
