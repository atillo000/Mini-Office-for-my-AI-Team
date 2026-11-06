import type { Store } from '../db';
import type { RemoteTimeLog, ZohoEntity } from '../../shared/connected';
import { Accounts } from './accounts';
export function providerId(value: unknown) {
  if (typeof value === 'string' && /^\d+$/.test(value)) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  throw new Error(
    'Provider returned an invalid or imprecise ID. Display numbers cannot substitute for API IDs.',
  );
}
type Resource = 'portals' | 'projects' | 'tasklists' | 'tasks' | 'issues' | 'users' | 'timelogs';
export class ZohoService {
  constructor(
    public store: Store,
    public accounts: Accounts,
  ) {}
  path(kind: Resource, portal?: string, project?: string) {
    if (kind === 'portals') return '/api/v3.1/portals';
    const base = '/api/' + (kind === 'users' ? 'v3.1' : 'v3') + '/portal/' + providerId(portal);
    if (kind === 'projects') return base + '/projects';
    if ((kind === 'tasks' || kind === 'timelogs') && !project) return base + '/' + kind;
    return base + '/projects/' + providerId(project) + '/' + kind;
  }
  async timeLogs(portalId: string, date: string, ownerId: string) {
    return this.timeLogsRange(portalId, date, date, ownerId);
  }
  async timeLogsRange(portalId: string, startDate: string, endDate: string, ownerId: string) {
    providerId(portalId);
    providerId(ownerId);
    if (
      ![startDate, endDate].every(
        (date) =>
          /^\d{4}-\d{2}-\d{2}$/.test(date) &&
          new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) === date,
      ) ||
      endDate < startDate ||
      Date.parse(endDate) - Date.parse(startDate) > 31 * 86400000
    )
      throw new Error('Choose a real work-date range of at most 32 dates.');
    const account = (await this.accounts.tokens('zoho')).account,
      logs = new Map<string, RemoteTimeLog>();
    for (const module of ['task', 'issue', 'general']) {
      let complete = false;
      for (let page = 1; page <= 200; page++) {
        const query = new URLSearchParams({
          page: String(page),
          per_page: '200',
          view_type: 'customdate',
          start_date: startDate,
          end_date: endDate,
          module: JSON.stringify({ type: module }),
          // Zoho's live portal returns 500 for a partial filter containing only assignee.
          filter: JSON.stringify({
            assignee: [ownerId],
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
        });
        const response = await this.accounts.request(
          'zoho',
          '/api/v3/portal/' + portalId + '/timelogs?' + query,
          {},
          account,
        );
        const raw = (await response.json()) as {
          time_logs?: { log_details?: Record<string, unknown>[] }[];
          page_info?: { has_next_page?: boolean };
        };
        if (!Array.isArray(raw.time_logs))
          throw new Error('Zoho did not return the time-log list contract.');
        const entries = raw.time_logs.flatMap((group) => {
          if (!Array.isArray(group.log_details))
            throw new Error('Zoho time-log group is incomplete.');
          return group.log_details;
        });
        for (const value of entries) {
          const id = providerId(value.id),
            owner = providerId((value.owner as { zpuid?: unknown })?.zpuid);
          const date = String(value.date || '');
          if (owner !== ownerId || date < startDate || date > endDate) continue;
          const duration = /^(\d{1,2}):([0-5]\d)$/.exec(String(value.log_hour || ''));
          const project = value.project as { id: unknown; name?: string },
            detail = value.module_detail as { id?: unknown } | undefined;
          logs.set(id, {
            id,
            projectId: providerId(project.id),
            projectName: String(project.name || project.id),
            ownerId: owner,
            date,
            minutes: duration ? Number(duration[1]) * 60 + Number(duration[2]) : null,
            description: String(value.notes || value.log_notes || value.name || ''),
            billing: String(value.billing_status || ''),
            module: String(value.type || module),
            moduleId: detail?.id ? providerId(detail.id) : undefined,
            startTime: typeof value.start_time === 'string' ? value.start_time : undefined,
            endTime: typeof value.end_time === 'string' ? value.end_time : undefined,
          });
        }
        if (raw.page_info?.has_next_page === false || entries.length === 0) {
          complete = true;
          break;
        }
        if (raw.page_info?.has_next_page !== true)
          throw new Error('Zoho time-log pagination is incomplete.');
      }
      if (!complete)
        throw new Error('Zoho time-log page limit reached; no complete history is claimed.');
    }
    return {
      items: [...logs.values()],
      complete: true as const,
      account,
      checkedAt: Date.now(),
      startDate,
      endDate,
    };
  }
  async list(kind: Resource, portal?: string, project?: string) {
    const account = (await this.accounts.tokens('zoho')).account;
    const endpoint = this.path(kind, portal, project);
    const output: ZohoEntity[] = [],
      seen = new Set<string>();
    let complete = false;
    for (let page = 1; page <= 1000; page++) {
      if ((await this.accounts.tokens('zoho')).account !== account)
        throw new Error('Zoho account changed during discovery. Reload the account.');
      const before = seen.size;
      const response = await this.accounts.request(
        'zoho',
        endpoint + '?page=' + page + '&per_page=200',
      );
      const raw = (await response.json()) as Record<string, unknown>;
      const values = Array.isArray(raw) ? raw : raw[kind];
      if (!Array.isArray(values))
        throw new Error(
          'Zoho response did not contain ' + kind + '. No discovery result is claimed.',
        );
      for (const value of values as Record<string, unknown>[]) {
        const id = providerId(value.id);
        if (seen.has(id)) continue;
        seen.add(id);
        const entity = {
          id,
          name: String(value.name || value.full_name || value.log_name || id),
          projectId: project,
          email: typeof value.email === 'string' ? value.email : undefined,
          status:
            typeof value.status === 'string'
              ? value.status
              : String((value.status as { name?: string })?.name || ''),
        };
        output.push(entity);
        this.store.put('zoho_entities', account + ':' + endpoint + ':' + id, {
          ...entity,
          account,
          resource: kind,
          portalId: portal,
          fetchedAt: Date.now(),
        });
      }
      const info = raw.page_info as { has_next_page?: boolean } | undefined;
      if (kind === 'portals' || info?.has_next_page === false || values.length === 0) {
        complete = true;
        break;
      }
      if (values.length && seen.size === before)
        throw new Error('Zoho repeated a page without progress. Discovery is incomplete.');
      if (info?.has_next_page === undefined && Array.isArray(raw)) continue;
      if (info?.has_next_page === undefined)
        throw new Error(
          'Zoho omitted pagination metadata. Discovery is incomplete; no missing projects are guessed.',
        );
    }
    if (!complete) throw new Error('Zoho discovery page limit reached. Results are incomplete.');
    return { items: output, complete, account, fetchedAt: Date.now() };
  }
  async entity(
    kind: Exclude<Resource, 'portals' | 'timelogs'>,
    portal: string,
    project: string | undefined,
    id: string,
  ) {
    const result = await this.list(kind, portal, project);
    const entity = result.items.find((e) => e.id === id);
    if (!entity)
      throw new Error('Selected ' + kind + ' item is no longer available to this account.');
    return entity;
  }
}
