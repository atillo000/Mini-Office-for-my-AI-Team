import { useEffect, useState } from 'react';
import { ArrowRight, Check, Download, Film, Sparkles } from 'lucide-react';
import type {
  StudioSnapshot,
  VideoBrief,
  VideoIdea,
  VideoIdeaContent,
  WorkProfile,
} from '../../shared/studio';
import { api } from '../api';
import { useOffice } from '../store';
import { useResource } from './useResource';
import { ErrorText, Status, Submit, useAction, post, dateTime } from './common';
import { VideoBudget } from './VideoBudget';

type Idea = VideoIdea & { contentHash: string };
type Studio = Omit<StudioSnapshot, 'ideas'> & {
  ideas: Idea[];
  generationScopes: { withoutProfile: string; withProfile: string | null } | null;
  rememberedFeedback: string[];
};
export function MemoryChoice({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  const { data } = useResource<WorkProfile>('/work/profile');
  return (
    <label className="checkbox-label">
      <input
        type="checkbox"
        checked={checked}
        disabled={!data?.confirmed}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        Share my confirmed work profile and this project's linked knowledge with this AI task.{' '}
        {!data?.confirmed && 'Confirm your profile in Start here first.'}
      </span>
    </label>
  );
}

export function StartHere() {
  const { data, error, refresh } = useResource<Studio>('/studio');
  const [tab, setTab] = useState<'guide' | 'profile' | 'videos'>(
    useOffice.getState().targetId ? 'videos' : 'guide',
  );
  const action = useAction();
  const active = data?.jobs.some((j) => ['QUEUED', 'RUNNING', 'PLANNING'].includes(j.state));
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  }, [active, refresh]);
  return (
    <div className="panel-content start-panel">
      <span className="eyebrow">YOUR TEAM, YOUR APPROVAL</span>
      <h2>Start here</h2>
      <nav className="panel-tabs" aria-label="Getting started">
        {(
          [
            ['guide', 'How it works'],
            ['profile', 'My work profile'],
            ['videos', 'Video ideas'],
          ] as const
        ).map(([id, name]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            {name}
          </button>
        ))}
      </nav>
      <ErrorText error={error || action.error} />
      {!data ? (
        <p>Loading your workspace…</p>
      ) : (
        <>
          {tab === 'guide' && (
            <>
              <div className="work-actions">
                <button
                  className="text-button"
                  onClick={() => useOffice.getState().open('connections')}
                >
                  Connect Outlook and Zoho
                </button>
                <button
                  className="text-button"
                  onClick={() => useOffice.getState().open('notifications')}
                >
                  Open action inbox
                </button>
                <button
                  className="text-button"
                  onClick={() => useOffice.getState().open('timelogs')}
                >
                  My time logs
                </button>
              </div>
              <h3>Give direction. Let the team propose ideas.</h3>
              <p>
                Your video team will discuss horror, comedy, drama and other original ideas with
                broad Filipino appeal—“patok sa masa.” You choose which drafts to approve.
              </p>
              <ol className="guide-steps">
                <li>
                  <strong>Tell the team about you</strong>
                  <p>
                    Save your goals, responsibilities and routines in My work profile. Share it with
                    an AI task when useful.
                  </p>
                  <button className="text-button" onClick={() => setTab('profile')}>
                    Open my profile <ArrowRight size={13} />
                  </button>
                </li>
                <li>
                  <strong>Ask for video drafts</strong>
                  <p>
                    Your project manager proposes directions, your analyst reviews audience appeal,
                    and your writer creates scripts and scene plans. You do not need to choose a
                    topic first.
                  </p>
                  <button
                    className="text-button"
                    onClick={async () => {
                      if (!data.project) {
                        const result = await action.execute(
                          () => post('/studio/setup', {}),
                          'AI Video Studio set up',
                        );
                        if (!result) return;
                        await refresh();
                      }
                      setTab('videos');
                    }}
                    disabled={action.busy}
                  >
                    <Film size={14} />
                    {data.project ? 'Open Video ideas' : 'Set up my video project'}
                  </button>
                </li>
                <li>
                  <strong>Review and teach</strong>
                  <p>
                    Read a draft, edit it, approve it or ask for changes. Choose “Remember this
                    feedback” to guide future brainstorming.
                  </p>
                </li>
              </ol>
              <p className="studio-boundary">
                Available now: team discussions, scripts and idea approvals. Video rendering and
                YouTube/Facebook posting are not connected yet. Posting will need a separate
                approval.
              </p>
              <button className="text-button" onClick={() => useOffice.getState().open('assign')}>
                Create a coding task instead <ArrowRight size={13} />
              </button>
            </>
          )}
          {tab === 'profile' && (
            <ProfileEditor key={data.profile.version} profile={data.profile} refresh={refresh} />
          )}
          {tab === 'videos' &&
            (!data.project || !data.brief ? (
              <>
                <p>Set up the project with your audience goal already filled in.</p>
                <button
                  className="button primary"
                  disabled={action.busy}
                  onClick={async () => {
                    await action.execute(() => post('/studio/setup', {}));
                    await refresh();
                  }}
                >
                  Set up my video project
                </button>
              </>
            ) : (
              <VideoStudio data={data} refresh={refresh} />
            ))}
        </>
      )}
    </div>
  );
}

function ProfileEditor({
  profile,
  refresh,
}: {
  profile: WorkProfile;
  refresh: () => Promise<void>;
}) {
  const [form, setForm] = useState(profile);
  const action = useAction();
  const fields = [
    ['about', 'What I do', 'Describe your work, business or current project.'],
    ['responsibilities', 'My responsibilities', 'What do you own or decide?'],
    ['routines', 'My routines', 'When do you review ideas or work? Leave blank until you decide.'],
    ['communication', 'How I like to work', 'Language, tone, detail and approval preferences.'],
    ['goals', 'My goals', 'What should the team help you achieve?'],
  ] as const;
  return (
    <form
      className="stacked-form studio-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const { about, responsibilities, routines, communication, goals, confirmed, version } =
          form;
        const saved = await action.execute(
          () =>
            api('/work/profile', {
              method: 'PUT',
              body: JSON.stringify({
                about,
                responsibilities,
                routines,
                communication,
                goals,
                confirmed,
                version,
              }),
            }),
          'Work profile saved',
        );
        if (saved) await refresh();
      }}
    >
      <p>
        The team uses this saved context when you choose to share it. Update it as your work
        changes.
      </p>
      {fields.map(([key, label, hint]) => (
        <label key={key}>
          {label}
          <textarea
            aria-label={label}
            rows={key === 'about' ? 3 : 2}
            maxLength={['about', 'responsibilities'].includes(key) ? 4000 : 2000}
            value={form[key]}
            onChange={(e) => setForm({ ...form, [key]: e.target.value, confirmed: false })}
            placeholder={hint}
          />
        </label>
      ))}
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={form.confirmed}
          onChange={(e) => setForm({ ...form, confirmed: e.target.checked })}
        />
        <span>I reviewed this profile and confirm it describes my preferences.</span>
      </label>
      <p className="microcopy">
        Stored locally. Only your selected task context is shared with AI. This is saved memory and
        feedback, not model training or background monitoring.
      </p>
      <ErrorText error={action.error} />
      <Submit busy={action.busy}>Save my profile</Submit>
    </form>
  );
}

function VideoStudio({ data, refresh }: { data: Studio; refresh: () => Promise<void> }) {
  const employees = useOffice((s) => s.employees);
  const action = useAction();
  const [editingBrief, setEditingBrief] = useState(false);
  const [approved, setApproved] = useState(false);
  const [includeProfile, setIncludeProfile] = useState(false);
  const [selected, setSelected] = useState<string | null>(useOffice.getState().targetId);
  const [filter, setFilter] = useState('ALL');
  const brief = data.brief!;
  const active = data.jobs.some((j) => ['QUEUED', 'RUNNING', 'PLANNING'].includes(j.state));
  const latest = data.jobs.at(-1);
  const selectedIdea = data.ideas.find((i) => i.id === selected);
  const ready = useOffice((s) => s.snapshot?.codex.executionReady);
  return (
    <>
      <div className="studio-title">
        <h3>AI Video Studio</h3>
        <button className="text-button" onClick={() => setEditingBrief(!editingBrief)}>
          {editingBrief ? 'Close brief' : 'Edit direction'}
        </button>
      </div>
      {editingBrief ? (
        <BriefEditor
          key={brief.version}
          brief={brief}
          refresh={async () => {
            await refresh();
            setEditingBrief(false);
            setApproved(false);
          }}
        />
      ) : (
        <div className="studio-brief">
          <p>{brief.direction}</p>
          <small>
            {brief.audience} · {brief.durationSeconds}s
          </small>
          <p className="microcopy">{brief.language}</p>
        </div>
      )}
      <VideoBudget policy={data.production} refresh={refresh} />
      <form
        className="stacked-form studio-generate"
        key={brief.version}
        onSubmit={async (e) => {
          e.preventDefault();
          const result = await action.execute(
            () =>
              post('/studio/generate', {
                briefVersion: brief.version,
                approved,
                includeProfile,
                scopeHash: includeProfile
                  ? data.generationScopes?.withProfile
                  : data.generationScopes?.withoutProfile,
              }),
            'Team discussion queued. All ideas remain drafts.',
          );
          if (result) {
            setApproved(false);
            await refresh();
          }
        }}
      >
        <details>
          <summary>Context shared with the team</summary>
          <p>{data.project?.description}</p>
          <ul>
            {data.project?.responsibilities.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          {includeProfile && (
            <>
              <p>{data.profile.about}</p>
              <p>{data.profile.responsibilities}</p>
              <p>{data.profile.routines}</p>
              <p>{data.profile.communication}</p>
              <p>{data.profile.goals}</p>
            </>
          )}
          <p>
            {data.rememberedFeedback.length
              ? 'Remembered feedback:'
              : 'No remembered feedback yet.'}
          </p>
          <ul>
            {data.rememberedFeedback.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </details>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={includeProfile}
            disabled={!data.profile.confirmed || active}
            onChange={(e) => {
              setIncludeProfile(e.target.checked);
              setApproved(false);
            }}
          />
          <span>
            Include my confirmed work profile.{' '}
            {!data.profile.confirmed && 'Confirm it in My work profile first.'}
          </span>
        </label>
        <label className="checkbox-label">
          <input
            required
            type="checkbox"
            checked={approved}
            disabled={active}
            onChange={(e) => setApproved(e.target.checked)}
          />
          <span>
            I approve sending this brief,{' '}
            {includeProfile ? 'profile v' + data.profile.version + ', ' : ''}project direction and
            remembered feedback to AI to create three drafts. Model usage may incur charges.
          </span>
        </label>
        <Submit busy={action.busy} disabled={!approved || active || !ready}>
          <Sparkles size={14} />
          {active ? 'Team is discussing…' : 'Ask team for 3 drafts'}
        </Submit>
        {!ready && (
          <p className="microcopy">
            The runner must be ready.{' '}
            <button
              type="button"
              className="text-button"
              onClick={() => useOffice.getState().open('settings')}
            >
              Check execution in Settings
            </button>
          </p>
        )}
        <ErrorText error={action.error} />
      </form>
      {latest && (
        <section className="studio-discussion" aria-label="Team discussion">
          <div className="studio-title">
            <h3>Team discussion</h3>
            <Status state={latest.state} />
          </div>
          <p>{latest.result}</p>
          {['QUEUED', 'RUNNING', 'PLANNING'].includes(latest.state) && (
            <button
              className="text-button"
              disabled={action.busy}
              onClick={async () => {
                await action.execute(() => post('/jobs/' + latest.id + '/cancel', {}));
                await refresh();
              }}
            >
              Stop brainstorming
            </button>
          )}
          {latest.subtasks.map((task) => (
            <details key={task.id}>
              <summary>
                {employees.find((employee) => employee.id === task.agentId)?.name || task.agentId} ·{' '}
                {task.title} · {task.status}
              </summary>
              <pre className="report-text">
                {task.result || 'Waiting for the real AI response…'}
              </pre>
            </details>
          ))}
          <details>
            <summary>Saved execution log · {dateTime(latest.updatedAt)}</summary>
            <pre className="log-view">
              {latest.logs.map((l) => l.text).join('\n') || 'Waiting to start.'}
            </pre>
          </details>
        </section>
      )}
      <div className="studio-title">
        <h3>Your drafts</h3>
        <label className="studio-filter">
          Show
          <select
            aria-label="Filter video ideas"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setSelected(null);
            }}
          >
            <option value="ALL">All ideas</option>
            <option value="DRAFT">Drafts</option>
            <option value="APPROVED">Approved</option>
            <option value="CHANGES_REQUESTED">Changes requested</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </label>
      </div>
      <div className="studio-ideas">
        {data.ideas
          .filter((i) => filter === 'ALL' || i.status === filter)
          .toReversed()
          .map((idea) => (
            <button
              key={idea.id}
              className={selected === idea.id ? 'selected' : ''}
              onClick={() => setSelected(selected === idea.id ? null : idea.id)}
            >
              <div>
                <strong>{idea.title}</strong>
                <small>
                  {idea.genre} ·{' '}
                  {idea.origin === 'STARTER'
                    ? 'Starter example'
                    : idea.origin === 'AI'
                      ? 'AI draft'
                      : 'Your draft'}{' '}
                  · {idea.durationSeconds}s
                </small>
              </div>
              <Status state={idea.status} />
            </button>
          ))}
      </div>
      {selectedIdea && (
        <IdeaReview
          key={selectedIdea.id + '-' + selectedIdea.version}
          idea={selectedIdea}
          refresh={refresh}
        />
      )}
      <p className="studio-boundary">
        Idea approval saves your decision. Video rendering and YouTube/Facebook posting are not
        connected. No video has been produced or published by this workflow.
      </p>
    </>
  );
}

function BriefEditor({ brief, refresh }: { brief: VideoBrief; refresh: () => Promise<void> }) {
  const [form, setForm] = useState(brief);
  const action = useAction();
  return (
    <form
      className="stacked-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const { direction, audience, language, durationSeconds, version } = form;
        const result = await action.execute(
          () =>
            api('/studio/brief', {
              method: 'PUT',
              body: JSON.stringify({ direction, audience, language, durationSeconds, version }),
            }),
          'Direction saved',
        );
        if (result) await refresh();
      }}
    >
      {(['direction', 'audience', 'language'] as const).map((key) => (
        <label key={key}>
          {key === 'direction'
            ? 'What the team should explore'
            : key === 'audience'
              ? 'Audience'
              : 'Language guidance'}
          <textarea
            required
            aria-label={
              key === 'direction'
                ? 'What the team should explore'
                : key === 'audience'
                  ? 'Audience'
                  : 'Language guidance'
            }
            maxLength={key === 'language' ? 200 : 4000}
            rows={key === 'direction' ? 4 : 2}
            value={form[key]}
            onChange={(e) => setForm({ ...form, [key]: e.target.value })}
          />
        </label>
      ))}
      <label>
        Video length in seconds
        <input
          required
          type="number"
          min={15}
          max={180}
          value={form.durationSeconds}
          onChange={(e) => setForm({ ...form, durationSeconds: Number(e.target.value) })}
        />
      </label>
      <ErrorText error={action.error} />
      <Submit busy={action.busy}>Save direction</Submit>
    </form>
  );
}

function IdeaReview({ idea, refresh }: { idea: Idea; refresh: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [remember, setRemember] = useState(false);
  const action = useAction();
  const review = async (status: 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED') => {
    const result = await action.execute(
      () =>
        post('/studio/ideas/' + idea.id + '/review', {
          version: idea.version,
          contentHash: idea.contentHash,
          action: status,
          feedback,
          rememberFeedback: remember,
        }),
      status === 'APPROVED' ? 'Idea approved. Nothing has been published.' : 'Review saved',
    );
    if (result) await refresh();
  };
  return (
    <article className="studio-review" aria-label="Review video idea">
      <div className="studio-title">
        <h3>{idea.title}</h3>
        <button className="text-button" onClick={() => setEditing(!editing)}>
          {editing ? 'Cancel edit' : 'Edit draft'}
        </button>
      </div>
      {idea.origin === 'STARTER' && (
        <p className="microcopy">
          Starter example to show the review process. Ask the team above for real AI drafts.
        </p>
      )}
      {editing ? (
        <IdeaEditor idea={idea} refresh={refresh} />
      ) : (
        <>
          <p>
            <strong>Hook</strong>
            <br />
            {idea.hook}
          </p>
          <p>{idea.concept}</p>
          <small>
            {idea.language} · {idea.durationSeconds}s
          </small>
          <h4>Script</h4>
          <p className="studio-script">{idea.script}</p>
          <h4>Scene plan</h4>
          <ol className="studio-scenes">
            {idea.scenes.map((scene, i) => (
              <li key={i}>
                <strong>
                  {scene.seconds}s · {scene.visual}
                </strong>
                <p>{scene.narration}</p>
              </li>
            ))}
          </ol>
          <h4>YouTube caption</h4>
          <p>{idea.youtubeCaption}</p>
          <h4>Facebook caption</h4>
          <p>{idea.facebookCaption}</p>
          <label className="studio-feedback">
            Your feedback
            <textarea
              rows={3}
              maxLength={2000}
              placeholder="What works? What should change?"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            <span>Remember this feedback for future idea requests.</span>
          </label>
          <div className="job-actions">
            <button
              className="button primary"
              disabled={action.busy || idea.status === 'APPROVED'}
              onClick={() => review('APPROVED')}
            >
              <Check size={14} />
              Approve idea
            </button>
            <button
              className="button secondary"
              disabled={action.busy || !feedback.trim() || idea.status === 'CHANGES_REQUESTED'}
              onClick={() => review('CHANGES_REQUESTED')}
            >
              Request changes
            </button>
            <button
              className="text-button"
              disabled={action.busy || idea.status === 'REJECTED'}
              onClick={() => review('REJECTED')}
            >
              Reject
            </button>
          </div>
          {idea.approval && (
            <p className="microcopy">
              Idea v{idea.approval.version} approved {dateTime(idea.approval.at)}. Editing requires
              a new approval.
            </p>
          )}
          {idea.status === 'CHANGES_REQUESTED' && (
            <p className="microcopy">
              Edit this draft, or remember your feedback and ask the team for a fresh round above.
            </p>
          )}
          {idea.status === 'APPROVED' && (
            <button
              className="text-button"
              onClick={() => {
                const content = [
                  idea.title,
                  idea.genre + ' | ' + idea.language + ' | ' + idea.durationSeconds + 's',
                  'HOOK',
                  idea.hook,
                  'CONCEPT',
                  idea.concept,
                  'SCRIPT',
                  idea.script,
                  'FREE-ONLY PRODUCTION: Flow Veo 3.1 Lite, 10 credits per output, one output per scene. Four scenes = 40 credits + 10 retry reserve; five = 50 credits with no retries. Check actual model price and remaining free balance first. No paid top-ups. Use free editing to assemble short source clips. Only one approved idea fits this daily budget. Rendering is not connected.',
                  'SCENES',
                  ...idea.scenes.map(
                    (s, i) => i + 1 + '. ' + s.seconds + 's: ' + s.visual + '\n' + s.narration,
                  ),
                  'YOUTUBE CAPTION',
                  idea.youtubeCaption,
                  'FACEBOOK CAPTION',
                  idea.facebookCaption,
                  'Idea approved: ' + idea.approval?.contentHash,
                  'Production brief only. No video rendered or published.',
                ].join('\n\n');
                const url = URL.createObjectURL(
                  new Blob([content], { type: 'text/plain;charset=utf-8' }),
                );
                const a = document.createElement('a');
                a.href = url;
                a.download = 'approved-video-brief.txt';
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}
            >
              <Download size={13} />
              Download approved production brief
            </button>
          )}
          {idea.feedback.length > 0 && (
            <details>
              <summary>Review history</summary>
              {idea.feedback.map((f) => (
                <p key={f.id}>
                  {f.action.replaceAll('_', ' ')} · {f.text || 'No comment'}
                  {f.reusable ? ' · Remembered' : ''}
                </p>
              ))}
            </details>
          )}
          <ErrorText error={action.error} />
        </>
      )}
    </article>
  );
}

function IdeaEditor({ idea, refresh }: { idea: Idea; refresh: () => Promise<void> }) {
  const {
    title,
    genre,
    hook,
    concept,
    language,
    durationSeconds,
    script,
    scenes,
    youtubeCaption,
    facebookCaption,
  } = idea;
  const [form, setForm] = useState<VideoIdeaContent>({
    title,
    genre,
    hook,
    concept,
    language,
    durationSeconds,
    script,
    scenes,
    youtubeCaption,
    facebookCaption,
  });
  const action = useAction();
  return (
    <form
      className="stacked-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const result = await action.execute(
          () =>
            api('/studio/ideas/' + idea.id, {
              method: 'PUT',
              body: JSON.stringify({ version: idea.version, content: form }),
            }),
          'Draft saved. Any previous approval was cleared.',
        );
        if (result) await refresh();
      }}
    >
      {(
        [
          ['title', 'Title', 180],
          ['genre', 'Genre', 80],
          ['hook', 'Hook', 4000],
          ['concept', 'Concept', 4000],
          ['language', 'Language', 100],
          ['script', 'Script', 6000],
          ['youtubeCaption', 'YouTube caption', 4000],
          ['facebookCaption', 'Facebook caption', 4000],
        ] as const
      ).map(([key, label, max]) => (
        <label key={key}>
          {label}
          <textarea
            required
            aria-label={label}
            rows={key === 'script' ? 7 : 2}
            maxLength={max}
            value={form[key]}
            onChange={(e) => setForm({ ...form, [key]: e.target.value })}
          />
        </label>
      ))}
      <label>
        Total duration (seconds)
        <input
          required
          type="number"
          min={15}
          max={180}
          value={form.durationSeconds}
          onChange={(e) => setForm({ ...form, durationSeconds: Number(e.target.value) })}
        />
      </label>
      {form.scenes.map((scene, i) => (
        <fieldset className="studio-scene-edit" key={i}>
          <legend>Scene {i + 1}</legend>
          {(['visual', 'narration'] as const).map((key) => (
            <label key={key}>
              {key === 'visual' ? 'Visual direction' : 'Narration'}
              <textarea
                required
                maxLength={4000}
                rows={2}
                value={scene[key]}
                onChange={(e) =>
                  setForm({
                    ...form,
                    scenes: form.scenes.map((s, j) =>
                      j === i ? { ...s, [key]: e.target.value } : s,
                    ),
                  })
                }
              />
            </label>
          ))}
          <label>
            Seconds
            <input
              required
              type="number"
              min={1}
              max={180}
              value={scene.seconds}
              onChange={(e) =>
                setForm({
                  ...form,
                  scenes: form.scenes.map((s, j) =>
                    j === i ? { ...s, seconds: Number(e.target.value) } : s,
                  ),
                })
              }
            />
          </label>
          <button
            type="button"
            className="text-button"
            disabled={form.scenes.length === 1}
            onClick={() => setForm({ ...form, scenes: form.scenes.filter((_, j) => j !== i) })}
          >
            Remove scene
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        className="text-button"
        disabled={form.scenes.length >= 10}
        onClick={() =>
          setForm({ ...form, scenes: [...form.scenes, { visual: '', narration: '', seconds: 10 }] })
        }
      >
        Add scene
      </button>
      <p className="microcopy">
        Scene times must add up to {form.durationSeconds} seconds. Saving returns the idea to Draft.
      </p>
      <ErrorText error={action.error} />
      <Submit busy={action.busy}>Save draft edits</Submit>
    </form>
  );
}
