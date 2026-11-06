// Read-only provider diagnostics. Uses the existing encrypted consent; never submits a log.
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { Store } from '../server/db';
import { Accounts } from '../server/connected/accounts';
import { CredentialVault } from '../server/connected/vault';
import { ZohoService } from '../server/connected/zoho';
import type { ExternalDraft, TimeLogPayload } from '../shared/connected';
const file = path.resolve(process.env.COMPANY_DB || '.data/company.sqlite');
const db = new DatabaseSync(file, { readOnly: true });
const memory = new Store(':memory:');
for (const row of db.prepare("SELECT id,data FROM records WHERE kind='account_config'").all() as {
  id: string;
  data: string;
}[])
  memory.put('account_config', row.id, JSON.parse(row.data));
const latest = db
  .prepare(
    "SELECT data FROM records WHERE kind='external_drafts' AND json_extract(data,'$.kind')='TIME_LOG' ORDER BY rowid DESC LIMIT 1",
  )
  .get() as { data: string } | undefined;
const accounts = new Accounts(memory, new CredentialVault(file + '.credentials'));
if (!latest) throw new Error('Save a time-log draft before running these read-only checks.');
const p = (JSON.parse(latest.data) as ExternalDraft).payload as TimeLogPayload;
const query = new URLSearchParams({
  page: '1',
  per_page: '200',
  view_type: 'customdate',
  start_date: p.date,
  end_date: p.date,
  module: JSON.stringify({ type: 'task' }),
  filter: JSON.stringify({ assignee: [p.ownerId] }),
});
if (process.argv.includes('--legacy'))
  for (const [label, endpoint] of [
    ['projects', '/api/v3/portal/' + p.portalId + '/projects'],
    ['settings', '/api/v3/portal/' + p.portalId + '/settings/timelog'],
    ['current_history', '/api/v3/portal/' + p.portalId + '/timelogs?' + query],
    [
      'corrected_history',
      '/api/v3/portal/' +
        p.portalId +
        '/timelogs?' +
        new URLSearchParams({
          page: '1',
          per_page: '200',
          report_type: 'user',
          view_type: 'customdate',
          custom_range: JSON.stringify({ start_date: p.date, end_date: p.date }),
          filter: JSON.stringify({ assignee: [p.ownerId] }),
        }),
    ],
    [
      'history_no_filter',
      '/api/v3/portal/' +
        p.portalId +
        '/timelogs?' +
        new URLSearchParams({
          page: '1',
          per_page: '200',
          view_type: 'customdate',
          start_date: p.date,
          end_date: p.date,
          module: JSON.stringify({ type: 'task' }),
        }),
    ],
    [
      'history_module_id',
      '/api/v3/portal/' +
        p.portalId +
        '/timelogs?' +
        new URLSearchParams({
          page: '1',
          per_page: '200',
          view_type: 'customdate',
          start_date: p.date,
          end_date: p.date,
          module: JSON.stringify({ type: 'task', id: '-' }),
          filter: JSON.stringify({ assignee: [p.ownerId] }),
        }),
    ],
    [
      'project_history',
      '/api/v3/portal/' + p.portalId + '/projects/' + p.projectId + '/timelogs?' + query,
    ],
    [
      'general_history',
      '/api/v3/portal/' +
        p.portalId +
        '/timelogs?' +
        new URLSearchParams({
          page: '1',
          per_page: '200',
          view_type: 'customdate',
          start_date: p.date,
          end_date: p.date,
          module: JSON.stringify({ type: 'general' }),
          filter: JSON.stringify({ assignee: [p.ownerId] }),
        }),
    ],
    [
      'complete_filter',
      '/api/v3/portal/' +
        p.portalId +
        '/timelogs?' +
        new URLSearchParams({
          page: '1',
          per_page: '200',
          view_type: 'customdate',
          start_date: p.date,
          end_date: p.date,
          module: JSON.stringify({ type: 'task' }),
          filter: JSON.stringify({
            assignee: [p.ownerId],
            project: [],
            billtype: [],
            approvaltype: [],
            tsheetperiod: [],
            clientcompany: [],
            content: [],
            invoicestatus: [],
            usergroups: [],
            criteria: [],
          }),
        }),
    ],
    [
      'week_no_filter',
      '/api/v3/portal/' +
        p.portalId +
        '/timelogs?' +
        new URLSearchParams({
          page: '1',
          per_page: '200',
          view_type: 'customdate',
          start_date: '2026-11-01',
          end_date: '2026-11-06',
          module: JSON.stringify({ type: 'task' }),
        }),
    ],
  ] as const) {
    try {
      const r = await accounts.request('zoho', endpoint);
      const data = await r.json();
      console.log(
        JSON.stringify({
          label,
          status: r.status,
          keys: Object.keys(data),
          groups: Array.isArray(data.time_logs) ? data.time_logs.length : undefined,
          pageInfo: data.page_info,
        }),
      );
    } catch (error) {
      console.log(JSON.stringify({ label, error: (error as Error).message }));
    }
  }
const history = await new ZohoService(memory, accounts).timeLogsRange(
  p.portalId,
  '2026-11-01',
  '2026-11-06',
  p.ownerId,
);
console.log(
  JSON.stringify({
    historyComplete: history.complete,
    logs: history.items.length,
    dates: [...new Set(history.items.map((log) => log.date))],
    totalMinutes: history.items.reduce((n, log) => n + (log.minutes || 0), 0),
  }),
);
db.close();
memory.close();
