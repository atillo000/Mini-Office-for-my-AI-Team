import { useOffice, type Panel } from '../store';
import { api } from '../api';
import { useAction, ErrorText } from './common';
export function WorkflowGuide({
  onVideos,
  videoLabel,
}: {
  onVideos: () => Promise<void>;
  videoLabel: string;
}) {
  const open = (panel: Panel) => useOffice.getState().open(panel);
  const action = useAction();
  return (
    <section className="workflow-guide">
      <h3>Your daily work, in five steps</h3>
      <button
        className="text-button"
        disabled={action.busy}
        onClick={() =>
          void action.execute(async () => {
            const guide = await api<{ markdown: string }>('/guide');
            const url = URL.createObjectURL(
              new Blob([guide.markdown], { type: 'text/markdown;charset=utf-8' }),
            );
            const link = document.createElement('a');
            link.href = url;
            link.download = 'mini-office-step-by-step.md';
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          })
        }
      >
        Download detailed step-by-step guide
      </button>
      <ErrorText error={action.error} />
      <ol className="guide-steps">
        <li>
          <strong>Connect your accounts once</strong>
          <p>
            Connect Zoho for projects and time-log history. Outlook and Teams use dedicated browser
            readers; sign in yourself. Sprout is under Time logs → After shift.
          </p>
          <button className="text-button" onClick={() => open('connections')}>
            Open Connections
          </button>
        </li>
        <li>
          <strong>Choose the projects you work on</strong>
          <p>
            Open My projects, load your Zoho portal, sync accessible projects, select numbers such
            as 20260109, and save your Teams name. The team uses these matches for work-related
            messages.
          </p>
          <button className="text-button" onClick={() => open('focus')}>
            Open My projects
          </button>
        </li>
        <li>
          <strong>Read relevant messages in Inbox</strong>
          <p>
            Inbox is the source: Outlook messages, Teams meeting candidates, AI reports and local
            reply drafts. Enable the automatic reader to let the team reopen its saved session and
            navigate work views. Enable AI review for new matching messages. Manual captures and
            watches remain optional.
          </p>
          <button className="text-button" onClick={() => open('inbox')}>
            Open Inbox
          </button>
        </li>
        <li>
          <strong>Act on Notifications</strong>
          <p>
            Notifications is your attention list: approvals, important findings, completed reviews
            and errors. Opening an item takes you to its source. It does not approve anything. Copy
            replies and send them yourself.
          </p>
          <button className="text-button" onClick={() => open('notifications')}>
            Open Notifications
          </button>
        </li>
        <li>
          <strong>Check dates before logging time</strong>
          <p>
            Time logs → Check dates reads actual Zoho entries, including your manual entries. After
            shift reads Sprout IN/OUT and proposes allocations. Confirm participation and durations,
            prepare drafts, then approve exact submissions.
          </p>
          <button className="text-button" onClick={() => open('timelogs')}>
            Open Time logs
          </button>
        </li>
      </ol>
      <details>
        <summary>First-time setup and missing time</summary>
        <p>
          Choose yourself as the Zoho user. Keep the backend and Sprout reader open. A day is
          “missing” only when a completed shift exists and the completed Zoho history check returns
          no entries. Drafts are not submitted hours. An invitation is not proof that you attended a
          meeting. Unknowns remain for your review.
        </p>
        <p>
          In More tools → Work knowledge, register your work responsibilities and confirm
          project/task mappings. General work uses SIN_TecSurge_General; proposal-stage prototyping
          uses SIN_TecSurge_BusinessDevelopment. Numbered project access alone does not establish
          approval stage.
        </p>
      </details>
      <details>
        <summary>What the other features do</summary>
        <dl className="feature-guide">
          <dt>Office / People</dt>
          <dd>
            The visual office and real worker/job status. Characters do not invent completed work.
          </dd>
          <dt>Projects / New task</dt>
          <dd>
            Coding repositories and isolated Codex jobs. Planning, edits, tests and acceptance have
            separate approvals. These are separate from your Zoho work projects.
          </dd>
          <dt>Meetings</dt>
          <dd>
            Internal AI-team planning and discussion. These records do not establish that you
            attended a real Teams call.
          </dd>
          <dt>Work knowledge</dt>
          <dd>
            Your confirmed work projects, roles, activities, Zoho mappings and reusable corrections.
            Saved preferences are context, not model retraining.
          </dd>
          <dt>My work profile</dt>
          <dd>
            Your responsibilities, routines and preferences. Confirm it and explicitly share it with
            relevant AI tasks.
          </dd>
          <dt>Activity / CEO briefing</dt>
          <dd>
            Saved work history and status summaries. These do not verify external submissions.
          </dd>
          <dt>Video ideas</dt>
          <dd>
            Real team brainstorming, scripts and scene prompts for your review. Free-tool planning
            uses four or five scenes. Rendering and publishing are not connected.
          </dd>
          <dt>Settings</dt>
          <dd>
            App access token, runner checks, appearance, timezone and the lightweight 2D view.
          </dd>
        </dl>
      </details>
      <h3>Personal video project</h3>
      <p>Use this separately from your employer projects and time logs.</p>
      <button className="button secondary" onClick={() => void onVideos()}>
        {videoLabel}
      </button>
    </section>
  );
}
