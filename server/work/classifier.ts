import type {
  KnowledgeProject,
  WorkClassification,
  WorkRecord,
  WorkRule,
  ClassificationLabel,
} from '../../shared/work';
const normalize = (v: string) => v.normalize('NFKC').toLocaleLowerCase('en-US');
export function contains(text: string, phrase: string) {
  const full = normalize(text),
    term = normalize(phrase);
  let offset = -1;
  while ((offset = full.indexOf(term, offset + 1)) !== -1) {
    const left = full[offset - 1] || ' ',
      right = full[offset + term.length] || ' ';
    if (!/[\p{L}\p{N}_]/u.test(left) && !/[\p{L}\p{N}_]/u.test(right)) return true;
  }
  return false;
}
export function classify(
  input: Pick<
    WorkRecord,
    | 'source'
    | 'kind'
    | 'body'
    | 'subject'
    | 'sender'
    | 'date'
    | 'durationMinutes'
    | 'attendanceConfirmed'
    | 'activityConfirmed'
  >,
  projects: KnowledgeProject[],
  rules: WorkRule[],
): WorkClassification {
  const text = `${input.subject}\n${input.body}`;
  const matched = rules.filter(
    (r) =>
      r.enabled &&
      (r.source === 'any' || r.source === input.source) &&
      (!r.sender || normalize(r.sender) === normalize(input.sender)) &&
      (r.match === 'ALL'
        ? r.terms.every((t) => contains(text, t))
        : r.terms.some((t) => contains(text, t))),
  );
  const named = projects
    .filter((p) => [p.name, ...p.aliases].some((term) => contains(text, term)))
    .map((p) => p.id);
  const specified = [
    ...new Set(matched.map((r) => r.knowledgeProjectId).filter((v): v is string => !!v)),
  ];
  const candidates = [...new Set([...named, ...specified])];
  const selected = specified.length ? specified : named;
  let conflict = selected.length > 1;
  const labels = new Set<ClassificationLabel>();
  const explanation: string[] = [];
  if (matched.length) {
    for (const rule of matched) {
      rule.labels.forEach((label) => labels.add(label));
      explanation.push(
        `Confirmed rule: ${rule.name}${rule.explanation ? ` — ${rule.explanation}` : ''}`,
      );
    }
  } else {
    const hints: [ClassificationLabel, string[]][] = [
      [
        'IT_HELPDESK',
        ['helpdesk', 'support ticket', 'cannot log in', 'password reset', 'login failed'],
      ],
      ['IT_ADVISORY', ['maintenance window', 'service outage', 'security advisory']],
      ['HR_COMMUNICATION', ['human resources', 'payroll', 'annual leave', 'HR']],
      ['MEETING', ['meeting', 'standup', 'calendar invitation', 'catch-up']],
      ['CLIENT_REQUEST', ['client request', 'customer request']],
      ['PROMOTIONAL', ['unsubscribe', 'special offer', 'newsletter']],
    ];
    for (const [label, terms] of hints)
      if (terms.some((term) => contains(text, term))) labels.add(label);
    if (input.kind === 'MEETING') labels.add('MEETING');
    if (labels.size)
      explanation.push('Local keyword hints; confirm the classification. No model was called.');
  }
  const project = selected.length === 1 ? projects.find((p) => p.id === selected[0]) : undefined;
  if (project) {
    explanation.push(
      `Project matched ${specified.length ? 'an explicit rule' : 'a registered name/alias'}; role is explicitly recorded as ${project.role}.`,
    );
    if (['PROJECT_OWNER', 'TECHNICAL_LEAD'].includes(project.role)) {
      if (labels.has('PROJECT_SUPPORT')) conflict = true;
      labels.add('PROJECT_LEAD');
    } else if (['DEVELOPER', 'SUPPORT_ENGINEER', 'BACKUP_SUPPORT'].includes(project.role)) {
      if (labels.has('PROJECT_LEAD')) conflict = true;
      labels.add('PROJECT_SUPPORT');
    } else if (labels.has('PROJECT_LEAD')) conflict = true;
  }
  if (labels.has('PROJECT_LEAD') && labels.has('PROJECT_SUPPORT')) conflict = true;
  const mappings = [...new Set(matched.map((r) => r.mappingId).filter((v): v is string => !!v))];
  if (mappings.length > 1) conflict = true;
  if (conflict) {
    labels.add('NEEDS_REVIEW');
    explanation.push('Conflicting project, role or mapping rules require a CEO decision.');
  }
  if (!labels.size) {
    labels.add('NEEDS_REVIEW');
    explanation.push('No confirmed rule or supported local hint matched.');
  }
  const missing = new Set<string>();
  const work = input.kind === 'ACTIVITY' || input.kind === 'MEETING';
  if (work) {
    if (!input.date) missing.add('date');
    if (!input.durationMinutes) missing.add('duration');
    if (!input.activityConfirmed) missing.add('confirmed work');
    if (input.kind === 'MEETING' && !input.attendanceConfirmed) missing.add('confirmed attendance');
  }
  for (const rule of matched)
    for (const field of rule.requiredFields) {
      if (
        (field === 'date' && !input.date) ||
        (field === 'duration' && !input.durationMinutes) ||
        (field === 'attendance' && !input.attendanceConfirmed) ||
        (field === 'project' && !project)
      )
        missing.add(field);
    }
  return {
    labels: [...labels],
    projectId: conflict ? null : project?.id || null,
    candidateProjectIds: candidates,
    confidence:
      conflict || labels.has('NEEDS_REVIEW')
        ? 0
        : matched.length
          ? Math.min(...matched.map((r) => r.confidence))
          : project
            ? 0.8
            : 0.55,
    explanation,
    ruleIds: matched.map((r) => r.id),
    conflict,
    missing: [...missing],
    mappingId: conflict ? null : mappings[0] || null,
  };
}
