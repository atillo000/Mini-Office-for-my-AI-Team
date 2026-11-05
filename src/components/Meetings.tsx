import { useState } from 'react';
import { CalendarDays, Plus, Clock3, Users, MapPin, FileText } from 'lucide-react';
import { useOffice } from '../store';
import { api } from '../api';
import { Empty, ErrorText, Submit, useAction, post, dateTime } from './common';
import type { Meeting } from '../../shared/types';
import { ModelDiscussion } from './ModelDiscussion';
function localDate() {
  const date = new Date(Date.now() + 15 * 60000);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}
function MeetingNotes({ meeting }: { meeting: Meeting }) {
  const [transcript, setTranscript] = useState(meeting.transcript.join('\n'));
  const [actions, setActions] = useState(meeting.actions.join('\n'));
  const action = useAction();
  return (
    <form
      className="stacked-form"
      onSubmit={async (e) => {
        e.preventDefault();
        await action.execute(
          () =>
            api(`/meetings/${meeting.id}/notes`, {
              method: 'PUT',
              body: JSON.stringify({
                transcript: transcript.split('\n').filter(Boolean),
                actions: actions.split('\n').filter(Boolean),
              }),
            }),
          'Meeting notes saved',
        );
      }}
    >
      <label>
        Discussion notes ·{' '}
        {meeting.transcriptMode === 'execution' ? 'real agent discussion' : 'manually recorded'}
        <textarea
          rows={4}
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          placeholder="Record the discussion, one entry per line…"
        />
      </label>
      <label>
        Action items & owners
        <textarea
          rows={3}
          value={actions}
          onChange={(e) => setActions(e.target.value)}
          placeholder="Alex — review the API contract…"
        />
      </label>
      <p className="microcopy">
        Meeting attendance is simulated. Record notes yourself, or request an approved real AI
        discussion below.
      </p>
      <ErrorText error={action.error} />
      <Submit busy={action.busy}>Save meeting notes</Submit>
    </form>
  );
}
export function MeetingsPanel() {
  const s = useOffice();
  const meetings = s.snapshot?.meetings || [];
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [agenda, setAgenda] = useState('');
  const [startsAt, setStartsAt] = useState(localDate);
  const [duration, setDuration] = useState(30);
  const [participants, setParticipants] = useState(['sarah']);
  const [selected, setSelected] = useState('');
  const action = useAction();
  return (
    <div className="panel-content">
      <span className="eyebrow">MAKE ROOM FOR EACH OTHER</span>
      <h2>Better together</h2>
      <p>A little conversation can change everything.</p>
      <button className="button secondary full" onClick={() => setAdding(!adding)}>
        <Plus size={14} />
        {adding ? 'Close meeting form' : 'Bring the team together'}
      </button>
      {adding && (
        <form
          className="stacked-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const result = await action.execute(
              () =>
                post('/meetings', {
                  title,
                  agenda,
                  startsAt: new Date(startsAt).getTime(),
                  duration,
                  participants,
                }),
              'Meeting scheduled',
            );
            if (result) {
              setAdding(false);
              setTitle('');
              setAgenda('');
            }
          }}
        >
          <label>
            Meeting title
            <input
              required
              placeholder="A fresh perspective"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            What’s on the agenda?
            <textarea
              required
              rows={3}
              value={agenda}
              onChange={(e) => setAgenda(e.target.value)}
            />
          </label>
          <div className="form-columns">
            <label>
              Start time
              <input
                required
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </label>
            <label>
              Minutes
              <input
                type="number"
                min={5}
                max={240}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
              />
            </label>
          </div>
          <fieldset>
            <legend>Who’s joining?</legend>
            <div className="participant-options">
              {s.employees.map((e) => (
                <label className="checkbox-label" key={e.id}>
                  <input
                    type="checkbox"
                    checked={participants.includes(e.id)}
                    onChange={(event) =>
                      setParticipants(
                        event.target.checked
                          ? [...participants, e.id]
                          : participants.filter((id) => id !== e.id),
                      )
                    }
                  />
                  {e.name}
                </label>
              ))}
            </div>
          </fieldset>
          <ErrorText error={action.error} />
          <Submit busy={action.busy} disabled={!participants.length}>
            Schedule meeting
          </Submit>
        </form>
      )}
      {!meetings.length && !adding && (
        <Empty title="Room for a good conversation">
          Schedule a meeting and your teammates will walk to the meeting room when it begins.
        </Empty>
      )}
      <div className="meeting-list">
        {meetings
          .toSorted((a, b) => a.startsAt - b.startsAt)
          .map((m) => (
            <article key={m.id} className="meeting-card">
              <div className="meeting-date">
                <CalendarDays size={18} />
                <span>
                  {new Date(m.startsAt).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
              </div>
              <button
                className="meeting-summary"
                onClick={() => setSelected(selected === m.id ? '' : m.id)}
              >
                <h3>{m.title}</h3>
                <p>{dateTime(m.startsAt)}</p>
                <span>
                  <Clock3 size={11} />
                  {m.duration} min
                  <Users size={11} />
                  {m.participants.length}
                  <MapPin size={11} />
                  Meeting room
                </span>
              </button>
              {selected === m.id && (
                <div className="meeting-expanded">
                  <span className="section-label">AGENDA</span>
                  <p>{m.agenda}</p>
                  <span className="section-label">PARTICIPANTS</span>
                  <p>
                    {m.participants
                      .map((id) => s.employees.find((e) => e.id === id)?.name)
                      .join(', ')}
                  </p>
                  <MeetingNotes key={m.transcript.join()} meeting={m} />
                  <ModelDiscussion meetingId={m.id} />
                  <button
                    className="text-danger"
                    onClick={() =>
                      action.execute(
                        () => api(`/meetings/${m.id}`, { method: 'DELETE' }),
                        'Meeting cancelled',
                      )
                    }
                  >
                    Cancel meeting
                  </button>
                </div>
              )}
            </article>
          ))}
      </div>
      <ErrorText error={action.error} />
      <div className="callout">
        <FileText size={16} />
        <p>
          Good conversations lead to action. Turn an action item into an approved task in Projects.
        </p>
      </div>
    </div>
  );
}
