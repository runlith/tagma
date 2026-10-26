import { describe, expect, test } from 'vitest';
import type { CallRecord } from '@runlith/agent/callProgress';
import type { ChatEntry } from '@runlith/chat-ui/entries';
import { ExecutionId, HostRequestKey, Incarnation, InstallationId } from '@runlith/executions/protocol/execution';
import type { CommandActivity } from '$lib/features/executions/commands/Activity.svelte.js';
import type { ProcessLine } from '$lib/features/executions/processes/lines.js';
import type { ThreadNames } from '$lib/shared/threads/Names.svelte.js';
import type { CallActivity } from '../CallActivity.svelte.js';
import type { ShownThread } from '../ShownThread.js';
import { ToolActivity } from './ToolActivity.svelte.js';

const ended: CallRecord = {
  threadId: 'thread',
  runId: 'run',
  toolCallId: 'call',
  name: 'bash',
  input: { command: 'bun test' },
  phase: 'completed',
  mode: 'foreground',
  detachable: true,
  startedAt: 1000,
  admittedAt: 1000,
  endedAt: 4000,
  expiresAt: null,
  expiresBy: null,
  limitCeilingMs: null,
  detail: null,
  executions: [
    {
      execution: { installation: InstallationId.make('host'), execution: ExecutionId.make('exec'), incarnation: Incarnation.make(1) },
      operation: { installation: InstallationId.make('host'), operation: HostRequestKey.make('start-exec') },
      kind: 'command',
      label: 'bun test',
    },
  ],
};

const running: ProcessLine = {
  key: 'exec:1',
  address: { execution: 'exec', incarnation: 1 },
  kind: 'command',
  transport: 'pipes',
  opens: false,
  printed: null,
  owner: { thread: 'thread', label: 'Thread', archived: false, internal: false },
  wait: 'background',
  phase: 'running',
  live: 'held',
  label: 'bun test',
  command: 'bun test',
  cwd: null,
  note: null,
  ports: [],
  startedAt: 1001,
  endedAt: null,
  ranMs: null,
  exit: null,
  limit: null,
  waitMs: null,
  stoppedByLimit: false,
  outer: false,
  unstarted: null,
  place: null,
  current: null,
};

const open: ChatEntry = { id: 'call', runId: 'run', kind: 'tool', toolCallId: 'call', toolName: 'bash', toolState: 'input-available' };

describe('a call the feed still shows open', () => {
  test('whose call ended while its command runs on reads the live command, and its end once the command ends', () => {
    let line = running;
    const activity = new ToolActivity(
      { id: 'thread', projectId: 1 } as ShownThread,
      { of: () => ({ label: 'Thread', archived: false, harness: false }) } as unknown as ThreadNames,
      { forThread: () => ({ line: (key: string) => (key === line.key ? line : null) }) } as unknown as CommandActivity,
      { endedAt: () => ended } as unknown as CallActivity,
      () => new Map(),
    );
    expect(activity.launchedLine(open)).toBe(running);
    expect(activity.ended(open)).toBeNull();
    line = { ...running, phase: 'ended', ranMs: 51_000, exit: { _tag: 'Code', code: 0 } };
    expect(activity.launchedLine(open)).toBeNull();
    expect(activity.ended(open)).toEqual({ call: ended, line });
  });
});
