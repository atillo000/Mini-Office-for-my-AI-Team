import type { VideoProductionPolicy } from '../../shared/studio';
import type { Store } from '../db';
import { z } from 'zod';
export function productionPolicy(store: Store): VideoProductionPolicy {
  return (
    store.get<VideoProductionPolicy>('settings', 'video_production') || {
      version: 1,
      freeOnly: true,
      tool: 'Google Flow',
      model: 'Veo 3.1 Lite',
      dailyCreditLimit: 50,
      creditsPerGeneration: 10,
      outputsPerScene: 1,
      sceneCount: 5,
      verifyBalanceBeforeGeneration: true,
      allowPaidTopUps: false,
    }
  );
}
export function saveProductionPolicy(store: Store, raw: unknown) {
  const input = z
    .object({ version: z.number().int(), sceneCount: z.union([z.literal(4), z.literal(5)]) })
    .strict()
    .parse(raw);
  const old = productionPolicy(store);
  if (old.version !== input.version)
    throw new Error('Production settings changed. Reload before saving.');
  const next = { ...old, sceneCount: input.sceneCount, version: old.version + 1 };
  store.put('settings', 'video_production', next);
  return next;
}
export function productionInstructions(policy: VideoProductionPolicy) {
  return (
    'FREE-ONLY PRODUCTION POLICY: ' +
    JSON.stringify(policy) +
    '\nDraft exactly ' +
    policy.sceneCount +
    ' scenes per idea. Three ideas are alternatives; produce only one selected approved idea within the shared daily budget. At 10 credits per output, four scenes use 40 and reserve 10 for one retry; five use exactly 50 with no retries. Use one output per scene. Check the actual account balance and selected model price in Flow before generation; 50 is a ceiling, not proof of available credit. Stop if the displayed cost changes or free credits are insufficient. No paid plans, top-ups, extra outputs, upscales, or unbudgeted extensions. Plan each source clip as 4, 6, or 8 seconds; use free local editing, holds, cuts, narration or licensed reusable assets to fit the requested final scene durations. Do not imply a longer continuously generated clip. Prefer free local tools such as FFmpeg for assembly; verify asset licenses and credit requirements. Rendering and account access are not available in this drafting job. Never claim a video was generated. Prepare usable scene prompts and a free-tool production checklist.'
  );
}
