export interface CodexRun {
  text: string;
  threadId: string;
  exitCode: 0;
  completed: true;
  startedAt: number;
  finishedAt: number;
}
export class CodexStream {
  private threadId = '';
  private completed = false;
  private failure = '';
  private message = '';
  consume(line: string) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    if (!event || typeof event !== 'object') return;
    if (event.type === 'thread.started') this.threadId = event.thread_id;
    if (event.type === 'turn.completed') this.completed = true;
    if (event.type === 'turn.failed' || event.type === 'error')
      this.failure = event.error?.message || event.message || 'Codex reported a failed turn';
    if (event.type === 'item.completed' && event.item?.type === 'agent_message')
      this.message = event.item.text;
  }
  result(exitCode: number | null, startedAt: number): CodexRun {
    if (exitCode !== 0) throw new Error(`Codex exited with code ${exitCode}; see saved logs.`);
    if (this.failure) throw new Error(this.failure);
    if (!this.threadId || !this.completed || !this.message?.trim())
      throw new Error('Codex did not return a verifiable completed turn. No success is claimed.');
    return {
      text: this.message,
      threadId: this.threadId,
      completed: true,
      exitCode: 0,
      startedAt,
      finishedAt: Date.now(),
    };
  }
}
