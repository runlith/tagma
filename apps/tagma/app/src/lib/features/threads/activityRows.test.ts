import { describe, expect, test } from 'vitest';
import type { CallRecord } from '@runlith/agent/callProgress';
import { ExecutionId, Incarnation, InstallationId, HostRequestKey } from '@runlith/executions/protocol/execution';
import type { ProcessLine } from '../executions/processes/lines.js';
import { activityRows } from './activityRows.js';

const link = (execution = 'exec', incarnation = 1): CallRecord['executions'][number] => ({
  execution: {
    installation: InstallationId.make('host'),
    execution: ExecutionId.make(execution),
    incarnation: Incarnation.make(incarnation),
  },
  operation: { installation: InstallationId.make('host'), operation: HostRequestKey.make(`start-${execution}`) },
  kind: 'command',
  label: 'Check the tree',
});
const call = (over: Partial<CallRecord> = {}): CallRecord => ({
  threadId: 'thread',
  runId: 'run',
  toolCallId: 'call',
  name: 'bash',
  input: { command: 'bun test' },
  phase: 'running',
  mode: 'foreground',
  detachable: true,
  startedAt: 1000,
  admittedAt: 1000,
  endedAt: null,
  expiresAt: null,
  expiresBy: null,
  limitCeilingMs: null,
  detail: null,
  executions: [link()],
  ...over,
});
const processLine = (over: Partial<ProcessLine> = {}): ProcessLine => ({
  key: 'exec:1',
  address: { execution: 'exec', incarnation: 1 },
  kind: 'command',
  owner: { thread: 'thread', label: 'Thread', archived: false, internal: false },
  wait: 'foreground',
  phase: 'running',
  live: 'held',
  label: 'Check the tree',
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
  transport: 'pipes',
  opens: false,
  printed: null,
  stoppedByLimit: false,
  outer: false,
  unstarted: null,
  place: null,
  current: null,
  ...over,
});

describe('thread activity joins independently arriving call and process readings', () => {
  test('a linked command is one active item, regardless of which reading arrived first', () => {
    const native = processLine();
    const invoked = call();
    expect(activityRows('thread', [], [native]).map((row) => row.state)).toEqual(['active']);
    const preparing = activityRows('thread', [invoked], []);
    expect(preparing).toHaveLength(1);
    expect(preparing[0]?.executions[0]?.line).toBeNull();
    const joined = activityRows('thread', [invoked], [native]);
    expect(joined).toHaveLength(1);
    expect(joined[0]?.call).toBe(invoked);
    expect(joined[0]?.executions[0]?.line).toBe(native);
    expect(joined[0]?.key).toBe(preparing[0]?.key);
  });

  test('a completed tool receipt cannot hide a command still running in the background', () => {
    const invoked = call({ phase: 'completed', endedAt: 2000 });
    const native = processLine({ wait: 'background' });
    expect(activityRows('thread', [invoked], [native]).map((row) => row.state)).toEqual(['active']);
    const ended = activityRows('thread', [invoked], [{ ...native, phase: 'ended', endedAt: 3000 }]);
    expect(ended).toHaveLength(1);
    expect(ended[0]?.state).toBe('recent');
    expect(activityRows('thread', [], [native])[0]?.state).toBe('active');
  });

  test('labels never associate work, and a replacement incarnation is not the old execution', () => {
    const replacement = processLine({ key: 'exec:2', address: { execution: 'exec', incarnation: 2 } });
    const independent = processLine({ key: 'other:1', address: { execution: 'other', incarnation: 1 } });
    const rows = activityRows('thread', [call()], [replacement, independent]);
    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row.call !== null)?.executions[0]?.line).toBeNull();
    expect(rows.filter((row) => row.call === null).flatMap((row) => row.executions.map(({ line }) => line?.address))).toEqual([
      replacement.address,
      independent.address,
    ]);
  });

  test('supporting executions stay with their call even when the host attributes them to a service', () => {
    const support = processLine({ owner: { thread: null, label: 'Checkout', archived: false, internal: true } });
    const foreign = processLine({
      key: 'foreign:1',
      address: { execution: 'foreign', incarnation: 1 },
      owner: { thread: 'other-thread', label: 'Other', archived: false, internal: false },
    });
    const rows = activityRows(
      'thread',
      [call({ executions: [link(), link()] }), call({ threadId: 'other-thread', toolCallId: 'foreign' })],
      [support, foreign],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.executions).toHaveLength(1);
    expect(rows[0]?.executions[0]?.line).toBe(support);
  });

  test('an unreadable process is unknown rather than active, while an unheld one is recent', () => {
    const endedCall = call({ phase: 'completed', endedAt: 2000 });
    const unknown = processLine({ phase: null, live: 'unavailable' });
    const rows = activityRows('thread', [endedCall], [unknown]);
    expect(rows[0]?.state).toBe('unknown');
    expect(rows[0]?.status).toBe('Process state unavailable');
    expect(activityRows('thread', [], [unknown])[0]?.state).toBe('unknown');
    const unheld = activityRows('thread', [endedCall], [{ ...unknown, live: 'unheld' }]);
    expect(unheld[0]?.state).toBe('recent');
    expect(activityRows('thread', [], [{ ...unknown, live: 'unheld' }])[0]?.status).toBe('No longer held');
  });

  test('a standing call stays active while its process reads unknown', () => {
    const invoked = call({ phase: 'running' });
    const unknown = processLine({ phase: null, live: 'unavailable' });
    const rows = activityRows('thread', [invoked], [unknown]);
    expect(rows[0]?.state).toBe('active');
  });
});
