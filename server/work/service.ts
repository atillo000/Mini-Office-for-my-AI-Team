import { Store } from '../db';
import type {
  KnowledgeProject,
  LearningRecord,
  WorkAudit,
  WorkClassification,
  WorkRecord,
  WorkRule,
  WorkSnapshot,
  ZohoMapping,
} from '../../shared/work';
import { classify } from './classifier';
import {
  correctionInput,
  mappingInput,
  minutes,
  projectInput,
  recordInput,
  ruleInput,
} from './schemas';
export class WorkService {
  constructor(public store: Store) {}
  audit(action: string, entityType: string, entityId: string, version?: number) {
    const event: WorkAudit = {
      id: crypto.randomUUID(),
      at: Date.now(),
      action,
      entityType,
      entityId,
      version,
    };
    this.store.put('work_audit', event.id, event);
  }
  snapshot(): WorkSnapshot {
    return {
      projects: this.store.list('knowledge_projects'),
      mappings: this.store.list('work_mappings'),
      rules: this.store.list('work_rules'),
      records: this.store.list('work_records'),
      learning: this.store.list('work_learning'),
      audit: this.store.list<WorkAudit>('work_audit').slice(-100),
    };
  }
  requireProject(id?: string | null) {
    if (id && !this.store.get('knowledge_projects', id))
      throw new Error('Registered work project not found');
  }
  requireMapping(id?: string | null, projectId?: string | null) {
    if (!id) return;
    const mapping = this.store.get<ZohoMapping>('work_mappings', id);
    if (!mapping || mapping.knowledgeProjectId !== projectId)
      throw new Error('Mapping must belong to the selected work project');
  }
  versioned<T extends { id: string; version: number; createdAt?: number }>(
    kind: string,
    id: string | undefined,
    expectedVersion: number | undefined,
    create: (old?: T) => T,
  ) {
    return this.store.transaction(() => {
      const old = id ? this.store.get<T>(kind, id) : undefined;
      if (id && (!old || old.version !== expectedVersion))
        throw new Error('This record changed. Reload before saving.');
      const value = create(old);
      this.store.put(kind, value.id, value);
      this.audit(old ? 'UPDATED' : 'CREATED', kind, value.id, value.version);
      return value;
    });
  }
  saveProject(raw: unknown, id?: string, version?: number) {
    const value = projectInput.parse(raw);
    if (value.repositoryId && !this.store.get('projects', value.repositoryId))
      throw new Error('Connected coding repository not found');
    const names = [value.name, ...value.aliases].map((s) => s.toLocaleLowerCase());
    if (new Set(names).size !== names.length)
      throw new Error('Project name and aliases must be distinct');
    return this.versioned<KnowledgeProject>('knowledge_projects', id, version, (old) => ({
      ...value,
      id: old?.id || crypto.randomUUID(),
      createdAt: old?.createdAt || Date.now(),
      version: (old?.version || 0) + 1,
      updatedAt: Date.now(),
    }));
  }
  saveMapping(raw: unknown, id?: string, version?: number) {
    const { confirmed: _confirmed, ...value } = mappingInput.parse(raw);
    void _confirmed;
    this.requireProject(value.knowledgeProjectId);
    if (
      id &&
      this.store
        .list<WorkRule>('work_rules')
        .some((r) => r.mappingId === id && r.knowledgeProjectId !== value.knowledgeProjectId)
    )
      throw new Error('Update referencing rules before moving this mapping');
    return this.versioned<ZohoMapping>('work_mappings', id, version, (old) => ({
      ...value,
      id: old?.id || crypto.randomUUID(),
      source: 'USER_CONFIRMED',
      verifiedAt: null,
      version: (old?.version || 0) + 1,
      updatedAt: Date.now(),
    }));
  }
  saveRule(raw: unknown, id?: string, version?: number, learningId?: string) {
    const { confirmed: _confirmed, ...value } = ruleInput.parse(raw);
    void _confirmed;
    this.requireProject(value.knowledgeProjectId);
    this.requireMapping(value.mappingId, value.knowledgeProjectId);
    if (learningId && !this.store.get<LearningRecord>('work_learning', learningId))
      throw new Error('Correction not found');
    return this.versioned<WorkRule>('work_rules', id, version, (old) => {
      const rule: WorkRule = {
        ...value,
        id: old?.id || crypto.randomUUID(),
        origin: learningId ? 'CONFIRMED_CORRECTION' : old?.origin || 'USER_CONFIRMED',
        version: (old?.version || 0) + 1,
        createdAt: old?.createdAt || Date.now(),
        updatedAt: Date.now(),
      };
      if (learningId) {
        const learning = this.store.get<LearningRecord>('work_learning', learningId)!;
        if (learning.ruleId) throw new Error('This correction already has a rule');
        learning.ruleId = rule.id;
        this.store.put('work_learning', learning.id, learning);
      }
      return rule;
    });
  }
  analyze(raw: unknown): WorkClassification {
    const value = recordInput.parse(raw);
    const durationMinutes =
      value.durationMinutes ??
      (value.startTime && value.endTime
        ? minutes(value.endTime) - minutes(value.startTime)
        : undefined);
    return classify(
      { ...value, durationMinutes },
      this.store.list('knowledge_projects'),
      this.store.list('work_rules'),
    );
  }
  saveRecord(raw: unknown) {
    const input = recordInput.parse(raw);
    const value: WorkRecord = {
      ...input,
      durationMinutes:
        input.durationMinutes ??
        (input.startTime && input.endTime
          ? minutes(input.endTime) - minutes(input.startTime)
          : undefined),
      provenance: 'MANUAL',
      id: crypto.randomUUID(),
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      classification: this.analyze(input),
    };
    return this.store.transaction(() => {
      this.store.put('work_records', value.id, value);
      this.audit('MANUAL_INPUT_SAVED', 'work_records', value.id, 1);
      return value;
    });
  }
  correct(id: string, raw: unknown) {
    const value = correctionInput.parse(raw);
    this.requireProject(value.projectId);
    this.requireMapping(value.mappingId, value.projectId);
    return this.store.transaction(() => {
      const record = this.store.get<WorkRecord>('work_records', id);
      if (!record || record.version !== value.version)
        throw new Error('Record changed; reload before correcting');
      const corrected: WorkClassification = {
        ...record.classification,
        labels: value.labels,
        projectId: value.projectId,
        candidateProjectIds: value.projectId ? [value.projectId] : [],
        mappingId: value.mappingId,
        conflict: false,
        confidence: 1,
        ruleIds: [],
        explanation: [`CEO correction for this record only: ${value.explanation}`],
      };
      const learning: LearningRecord = {
        id: crypto.randomUUID(),
        recordId: id,
        originalInput: {
          source: record.source,
          subject: record.subject,
          body: record.body,
          sender: record.sender,
        },
        previous: record.classification,
        corrected,
        explanation: value.explanation,
        scope: 'THIS_RECORD',
        createdAt: Date.now(),
      };
      record.classification = corrected;
      record.version++;
      record.updatedAt = Date.now();
      this.store.put('work_records', id, record);
      this.store.put('work_learning', learning.id, learning);
      this.audit('CLASSIFICATION_CORRECTED', 'work_records', id, record.version);
      return { record, learning };
    });
  }
  reclassify(id: string, version: number) {
    const record = this.store.get<WorkRecord>('work_records', id);
    if (!record || record.version !== version) throw new Error('Record changed; reload first');
    if (this.store.list<LearningRecord>('work_learning').some((l) => l.recordId === id))
      throw new Error('A CEO correction is preserved. Edit the classification explicitly instead.');
    return this.store.transaction(() => {
      record.classification = this.analyze({
        source: record.source,
        kind: record.kind,
        subject: record.subject,
        body: record.body,
        sender: record.sender,
        date: record.date,
        startTime: record.startTime,
        endTime: record.endTime,
        durationMinutes: record.durationMinutes,
        activityConfirmed: record.activityConfirmed,
        attendanceConfirmed: record.attendanceConfirmed,
      });
      record.version++;
      record.updatedAt = Date.now();
      this.store.put('work_records', id, record);
      this.audit('RECLASSIFIED', 'work_records', id, record.version);
      return record;
    });
  }
  issues() {
    const records = this.store
      .list<WorkRecord>('work_records')
      .filter((r) => ['ACTIVITY', 'MEETING'].includes(r.kind));
    return records.map((record, index) => {
      const others = records.slice(0, index);
      const duplicates = others
        .filter(
          (r) =>
            r.date &&
            r.date === record.date &&
            r.durationMinutes === record.durationMinutes &&
            r.body.trim().toLowerCase() === record.body.trim().toLowerCase(),
        )
        .map((r) => r.id);
      const overlaps = others
        .filter(
          (r) =>
            r.date === record.date &&
            r.startTime &&
            r.endTime &&
            record.startTime &&
            record.endTime &&
            r.startTime < record.endTime &&
            record.startTime < r.endTime,
        )
        .map((r) => r.id);
      return { recordId: record.id, missing: record.classification.missing, duplicates, overlaps };
    });
  }
}
