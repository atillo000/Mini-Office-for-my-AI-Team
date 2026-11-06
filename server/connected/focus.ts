import { z } from 'zod';
import type { Store } from '../db';
import type { WorkFocus, FocusCatalog, MessageRelevance } from '../../shared/focus';
import type { CapturedMessage } from '../../shared/reader';
import type { ExternalDraft, TimeLogPayload } from '../../shared/connected';
export const projectNumbers = (text: string) => [...new Set(text.match(/\b20\d{6}\b/g) || [])];
export function workFocus(store: Store): WorkFocus {
  const owner = store
    .list<ExternalDraft>('external_drafts')
    .filter((d) => d.kind === 'TIME_LOG')
    .at(-1)?.payload as TimeLogPayload | undefined;
  return (
    store.get<WorkFocus>('settings', 'work_focus') || {
      enabled: true,
      mode: 'SELECTED',
      selectedNumbers: ['20260109'],
      selfNames: owner?.ownerName ? [owner.ownerName] : [],
      portalId: owner?.portalId || '',
      version: 1,
    }
  );
}
export function focusCatalog(store: Store) {
  const focus = workFocus(store),
    catalog = store.get<FocusCatalog>('focus_catalogs', focus.portalId);
  const account = store.get<{ account: string }>('connected_account', 'zoho')?.account;
  return catalog && catalog.account === account ? catalog : null;
}
export function focusContext(store: Store) {
  const settings = workFocus(store),
    catalog = focusCatalog(store);
  const accessible = catalog?.projects.flatMap((p) => p.numbers) || [];
  const numbers =
    settings.mode === 'ACCESSIBLE'
      ? accessible
      : settings.selectedNumbers.filter((n) => accessible.includes(n));
  return {
    settings,
    catalog,
    numbers: [...new Set(numbers)],
    notice:
      settings.enabled && !catalog
        ? 'Sync your accessible Zoho projects to verify project matches.'
        : settings.enabled
          ? 'Matching only your verified project numbers and explicit meeting mentions.'
          : 'Work focus is off; captured messages may include unrelated content.',
  };
}
export function messageRelevance(
  store: Store,
  message: Pick<CapturedMessage, 'provider' | 'text' | 'scope'>,
): MessageRelevance {
  const context = focusContext(store);
  const found = projectNumbers(message.scope + '\n' + message.text),
    matched = found.filter((n) => context.numbers.includes(n));
  if (!context.settings.enabled)
    return { relevant: true, kind: 'OTHER', numbers: found, reason: 'Work focus is off.' };
  if (message.provider === 'outlook')
    return {
      relevant: !!matched.length,
      kind: matched.length ? 'PROJECT' : 'OTHER',
      numbers: matched,
      reason: matched.length
        ? 'Matches a selected project available in your Zoho account.'
        : 'No verified selected project number matched.',
    };
  const meeting =
    /\b(meeting|call|stand[ -]?up|huddle|joined|attendance|sync[- ]up|orientation)\b/i.test(
      message.text,
    );
  const normalize = (s: string) =>
    s
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  const body = ' ' + normalize(message.text) + ' ';
  const named = context.settings.selfNames.some(
    (name) => name.trim().length >= 3 && body.includes(' ' + normalize(name) + ' '),
  );
  const personal = /\byou (?:joined|attended|were invited)|\binvited you\b/i.test(message.text);
  const relevant = meeting && (named || personal || !!matched.length);
  return {
    relevant,
    kind: relevant ? 'MEETING_CANDIDATE' : 'OTHER',
    numbers: matched,
    reason: relevant
      ? 'Potential meeting involving your name or selected project; attendance and duration still need confirmation.'
      : 'No explicit personal/project meeting evidence matched.',
  };
}
export function saveWorkFocus(store: Store, raw: unknown) {
  const input = z
    .object({
      enabled: z.boolean(),
      mode: z.enum(['SELECTED', 'ACCESSIBLE']),
      selectedNumbers: z.array(z.string().regex(/^20\d{6}$/)).max(100),
      selfNames: z.array(z.string().trim().min(3).max(200)).max(10),
      portalId: z.string().regex(/^\d+$/),
      version: z.number().int().min(1),
    })
    .strict()
    .parse(raw);
  if (workFocus(store).version !== input.version)
    throw new Error('Project focus changed. Reload before saving.');
  const next = {
    ...input,
    selectedNumbers: [...new Set(input.selectedNumbers)],
    version: input.version + 1,
  };
  store.put('settings', 'work_focus', next);
  return next;
}
