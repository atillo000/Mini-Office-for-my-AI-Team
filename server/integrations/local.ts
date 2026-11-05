import type { Store } from '../db';
import type {
  Application,
  AdapterHealth,
  KnowledgeProject,
  Operation,
  WorkRecord,
  ZohoMapping,
} from '../../shared/work';
import { IntegrationError, failure, type IntegrationAdapter } from './engine';
const manualCapabilities: Record<Application, Operation[]> = {
  outlook: ['listMessages', 'getMessage', 'classifyMessages', 'prepareBriefing'],
  teams: ['getAuthorizedMessages', 'classifyMessage'],
  zoho: ['listPortals', 'listProjects', 'listTasks', 'listIssues'],
};
function health(capabilities: Operation[]): AdapterHealth {
  return {
    health: 'HEALTHY',
    authentication: 'NOT_APPLICABLE',
    authorization: 'AUTHORIZED',
    capabilities,
    scopes: [],
  };
}
export function localAdapters(store: Store): IntegrationAdapter[] {
  return (['outlook', 'teams', 'zoho'] as const).flatMap((application): IntegrationAdapter[] => [
    {
      application,
      method: 'MANUAL',
      async inspect() {
        return health(manualCapabilities[application]);
      },
      async executeRead(request) {
        request.signal.throwIfAborted();
        if (!manualCapabilities[application].includes(request.operation))
          throw new IntegrationError(
            failure('UNSUPPORTED', 'No manual implementation for this operation.'),
          );
        // Local reads never claim to have checked a corporate mailbox or remote timesheet.
        const records = store
          .list<WorkRecord>('work_records')
          .filter(
            (r) =>
              r.source === application &&
              r.kind === (application === 'outlook' ? 'EMAIL' : 'MESSAGE'),
          );
        let items: unknown[] = [];
        if (application === 'zoho') {
          const mappings = store.list<ZohoMapping>('work_mappings');
          if (request.operation === 'listProjects')
            items = store.list<KnowledgeProject>('knowledge_projects').map((p) => ({
              id: p.id,
              name: p.name,
              zohoProjectIds: [
                ...new Set(
                  mappings
                    .filter((m) => m.knowledgeProjectId === p.id)
                    .map((m) => m.projectId)
                    .filter(Boolean),
                ),
              ],
            }));
          if (request.operation === 'listPortals')
            items = [...new Set(mappings.map((m) => m.portalId).filter(Boolean))].map((id) => ({
              id,
            }));
          if (request.operation === 'listTasks' || request.operation === 'listIssues') {
            if (!request.input.projectId)
              throw new IntegrationError(
                failure('VALIDATION', 'Select a registered work project.'),
              );
            if (!store.get('knowledge_projects', String(request.input.projectId)))
              throw new IntegrationError(failure('VALIDATION', 'Work project not found.'));
            items = mappings.filter(
              (m) =>
                m.knowledgeProjectId === request.input.projectId &&
                m.module === (request.operation === 'listTasks' ? 'TASK' : 'ISSUE'),
            );
          }
        } else if (['getMessage', 'classifyMessage'].includes(request.operation)) {
          const record = records.find((r) => r.id === request.input.recordId);
          if (!record)
            throw new IntegrationError(
              failure('VALIDATION', 'Choose a manually supplied message from this application.'),
            );
          items = [
            request.operation === 'classifyMessage'
              ? { id: record.id, classification: record.classification }
              : record,
          ];
        } else if (request.operation === 'classifyMessages')
          items = records
            .filter((r) => r.kind === 'EMAIL')
            .map((r) => ({ id: r.id, classification: r.classification }));
        else if (request.operation === 'prepareBriefing')
          items = [
            {
              manuallySuppliedMessages: records.length,
              needsReview: records.filter((r) => r.classification.labels.includes('NEEDS_REVIEW'))
                .length,
              projects: [
                ...new Set(records.map((r) => r.classification.projectId).filter(Boolean)),
              ],
            },
          ];
        else if (request.operation === 'createManualMeetingRecord')
          throw new IntegrationError(
            failure(
              'UNSUPPORTED',
              'Use Work knowledge → Add activity to confirm the meeting fields.',
            ),
          );
        else
          items = records.filter(
            (r) => r.kind === (application === 'outlook' ? 'EMAIL' : 'MESSAGE'),
          );
        const offset = Number(request.input.cursor || 0),
          limit = Number(request.input.limit || 25);
        return {
          verified: true,
          data: {
            provenance: 'MANUAL',
            detail:
              'Only CEO-supplied records. This does not verify a live connection or remote completeness.',
            items: items.slice(offset, offset + limit),
            nextCursor: offset + limit < items.length ? String(offset + limit) : null,
          },
        };
      },
    },
  ]);
}
