import { useState, useEffect, useRef } from 'react';
import { Send, Search, Hash } from 'lucide-react';
import { useOffice } from '../store';
import { Empty, ErrorText, useAction, post, dateTime } from './common';
import { InboxGroup } from './InboxGroup';
import { matchesSearch } from './inbox-groups';
export function Chat({ channel }: { channel: string }) {
  const [today] = useState(() =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(Date.now()),
  );
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const action = useAction();
  const end = useRef<HTMLDivElement>(null);
  const messages = useOffice((s) => s.snapshot?.messages) || [];
  const employees = useOffice((s) => s.employees);
  const filtered = messages.filter(
    (m) =>
      m.mode !== 'simulation' &&
      m.channel === channel &&
      matchesSearch(
        query,
        m.text,
        employees.find((e) => e.id === m.sender)?.name,
        m.sender === 'ceo' ? 'You' : m.sender,
        dateTime(m.at),
      ),
  );
  const dateKey = (at: number) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(at);
  const days = [...new Set(filtered.map((m) => dateKey(m.at)))];
  useEffect(() => {
    post('/messages/read', { channel }).catch(() => {});
  }, [channel, messages.length]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [messages.length]);
  return (
    <div className="chat">
      <label className="search-box">
        <Search size={14} />
        <input
          aria-label="Search messages"
          placeholder="Search this conversation"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="chat-history">
        {!filtered.length && (
          <Empty title="Start a conversation">
            Send a message to your AI teammate. Real responses appear here when the runner finishes.
          </Empty>
        )}
        {days.map((day) => (
          <InboxGroup
            key={day}
            title={day === today ? 'Today' : day}
            count={filtered.filter((m) => dateKey(m.at) === day).length}
            initiallyOpen={day === days.at(-1)}
            forceOpen={!!query.trim()}
          >
            {filtered
              .filter((m) => dateKey(m.at) === day)
              .map((m) => (
                <article className={`chat-message ${m.sender === 'ceo' ? 'mine' : ''}`} key={m.id}>
                  <div className="message-meta">
                    <strong>
                      {m.sender === 'ceo'
                        ? 'You'
                        : employees.find((e) => e.id === m.sender)?.name || m.sender}
                    </strong>
                    <span>
                      {m.mode === 'simulation'
                        ? 'Simulated'
                        : m.mode === 'execution'
                          ? 'AI team'
                          : 'CEO'}
                    </span>
                  </div>
                  <p>{m.text}</p>
                  <time>{dateTime(m.at)}</time>
                </article>
              ))}
          </InboxGroup>
        ))}
        <div ref={end} />
      </div>
      <ErrorText error={action.error} />
      <form
        className="chat-compose"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!text.trim()) return;
          const result = await action.execute(() => post('/messages', { channel, text }));
          if (result) setText('');
        }}
      >
        <textarea
          rows={2}
          aria-label="Message"
          placeholder="A little message…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={12000}
        />
        <button aria-label="Send message" disabled={action.busy || !text.trim()}>
          <Send size={17} />
        </button>
      </form>
      <p className="microcopy">
        Messages use the real Codex runner. Model usage may incur charges. External actions require
        your approval.
      </p>
    </div>
  );
}
export function InboxPanel() {
  const [channel, setChannel] = useState('inbox');
  const messages = useOffice((s) => s.snapshot?.messages) || [];
  return (
    <div className="panel-content">
      <span className="eyebrow">IN THE LOOP</span>
      <h2>Company inbox</h2>
      <p>A place for conversations, ideas, and updates.</p>
      <div className="channel-list">
        {['inbox', 'general', 'engineering', 'operations', 'announcements'].map((c) => (
          <button className={channel === c ? 'active' : ''} key={c} onClick={() => setChannel(c)}>
            <Hash size={12} />
            {c}
            {messages.some((m) => m.channel === c && !m.read) && <i />}
          </button>
        ))}
      </div>
      <Chat channel={channel} />
    </div>
  );
}
