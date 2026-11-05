import { useEffect } from 'react';
import { api, getSnapshot } from '../api';
import { useOffice } from '../store';
import type { EmployeeRuntime } from '../../shared/types';
export function useTeamRuntime() {
  const jobs = useOffice((s) => s.snapshot?.jobs),
    employees = useOffice((s) => s.employees);
  useEffect(() => {
    const runtime: Record<string, EmployeeRuntime> = {};
    for (const employee of employees) {
      const task = jobs?.find(
        (job) =>
          ['PLANNING', 'RUNNING', 'TESTING', 'VERIFYING'].includes(job.state) &&
          (job.subtasks.length
            ? job.subtasks.some((s) => s.agentId === employee.id && s.status === 'running')
            : job.agentId === employee.id),
      );
      const waiting = jobs?.find(
        (job) =>
          ['DRAFT', 'AWAITING_APPROVAL', 'REVIEW', 'QUEUED'].includes(job.state) &&
          job.agentId === employee.id,
      );
      runtime[employee.id] = {
        position: employee.desk,
        state: task ? 'WORKING' : 'IDLE',
        room: employee.room,
        path: [],
        targetState: task ? 'WORKING' : 'IDLE',
        nextChange: 0,
        history: [],
        interaction: task ? 'typing' : 'waiting',
        realStatus: task
          ? task.kind === 'assistant-chat'
            ? 'Replying'
            : task.kind === 'content-ideas'
              ? 'Preparing video drafts'
              : task.state === 'TESTING'
                ? 'Running approved tests'
                : 'Working on approved task'
          : waiting
            ? waiting.state === 'QUEUED'
              ? 'Queued'
              : 'Needs your review'
            : 'Available',
      };
    }
    useOffice.getState().patch({ runtime, speed: 1 });
  }, [jobs, employees]);
  useEffect(() => {
    let stopped = false,
      socket: WebSocket | undefined,
      retry: ReturnType<typeof setTimeout>;
    async function connect() {
      try {
        const { ticket } = await api<{ ticket: string }>('/ws-ticket', {
          method: 'POST',
          body: '{}',
        });
        if (stopped) return;
        socket = new WebSocket(
          (location.protocol === 'https:' ? 'wss' : 'ws') +
            '://' +
            location.host +
            '/ws?ticket=' +
            ticket,
        );
        socket.onmessage = () => {
          void getSnapshot()
            .then((data) => {
              if (!stopped) useOffice.getState().setSnapshot(data);
            })
            .catch(() => undefined);
        };
        socket.onclose = () => {
          if (!stopped) retry = setTimeout(connect, 5000);
        };
      } catch {
        if (!stopped) retry = setTimeout(connect, 10000);
      }
    }
    void connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      socket?.close();
    };
  }, []);
}
