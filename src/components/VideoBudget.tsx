import type { VideoProductionPolicy } from '../../shared/studio';
import { api } from '../api';
import { ErrorText, useAction } from './common';
export function VideoBudget({
  policy,
  refresh,
}: {
  policy: VideoProductionPolicy;
  refresh: () => Promise<void>;
}) {
  const action = useAction();
  return (
    <div className="studio-brief">
      <label className="studio-feedback">
        Free-tool production plan
        <select
          aria-label="Video scene budget"
          value={policy.sceneCount}
          disabled={action.busy}
          onChange={async (e) => {
            await action.execute(() =>
              api('/studio/production', {
                method: 'PUT',
                body: JSON.stringify({
                  version: policy.version,
                  sceneCount: Number(e.target.value),
                }),
              }),
            );
            await refresh();
          }}
        >
          <option value={4}>4 scenes · 40 credits + 10 retry reserve</option>
          <option value={5}>5 scenes · 50 credits, no retry reserve</option>
        </select>
      </label>
      <p className="microcopy">
        Free-only · Flow Veo 3.1 Lite · one output per scene · 50-credit ceiling shared across the
        day. Verify the live price and available free balance before generating. No paid top-ups.
        Three idea drafts are alternatives, not three videos to generate that day.
      </p>
      <p className="microcopy">
        The team prepares scene prompts and a free editing plan. Flow rendering is not connected; no
        credits are spent by brainstorming.
      </p>
      <ErrorText error={action.error} />
    </div>
  );
}
