import { useState } from 'react';
import { MessageSquare, Sparkles } from 'lucide-react';
import { useOffice } from '../store';
import { ErrorText, Submit, useAction, post } from './common';
import { MemoryChoice } from './StartHere';
export function ModelDiscussion({
  employeeId,
  meetingId,
}: {
  employeeId?: string;
  meetingId?: string;
}) {
  const s = useOffice();
  const [expanded, setExpanded] = useState(false);
  const [question, setQuestion] = useState('');
  const [projectId, setProjectId] = useState(s.snapshot?.projects[0]?.id || '');
  const action = useAction();
  const [useWorkMemory, setUseWorkMemory] = useState(false);
  return (
    <div className="model-discussion">
      <button className="text-button" onClick={() => setExpanded(!expanded)}>
        <Sparkles size={12} />
        {meetingId ? 'Request a real AI discussion' : 'Ask your teammate with Codex'}
      </button>
      {expanded && (
        <form
          className="stacked-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const meeting = s.snapshot?.meetings.find((m) => m.id === meetingId);
            const result = await action.execute(
              () =>
                post('/jobs', {
                  agentId: employeeId || 'sarah',
                  projectId,
                  instruction: meeting
                    ? `Discuss this agenda, refer to project evidence, and propose action items with owners: ${meeting.agenda}`
                    : question,
                  title: meeting
                    ? `AI discussion: ${meeting.title}`
                    : `Question for ${s.employees.find((e) => e.id === employeeId)?.name}`,
                  kind: meetingId ? 'meeting' : 'conversation',
                  relatedId: meetingId || employeeId,
                  useWorkMemory,
                }),
              'Discussion saved for your approval in Projects.',
            );
            if (result) s.open('projects');
          }}
        >
          <label>
            Project context
            <select required value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">Choose an approved project</option>
              {s.snapshot?.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {!meetingId && (
            <label>
              Your question
              <textarea
                required
                rows={3}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="What tradeoffs should we consider?"
              />
            </label>
          )}
          <p className="microcopy">
            Creates a draft for CEO approval. Codex reads an isolated copy of the project, then
            saves a real response {meetingId ? 'and meeting action items' : 'in this conversation'}.
            Model usage may incur charges.
          </p>
          <MemoryChoice checked={useWorkMemory} onChange={setUseWorkMemory} />
          <ErrorText error={action.error} />
          <Submit busy={action.busy} disabled={!projectId}>
            <MessageSquare size={13} />
            Request discussion for approval
          </Submit>
        </form>
      )}
    </div>
  );
}
