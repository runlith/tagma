import { expect, test } from 'bun:test';
import { TOOL_OUTPUT_MAX_BYTES } from '@runlith/agent/ToolOutputSpool';
import { localRunning, type ShellSettlement } from '../ShellRun';
import type { CommandVerdict } from '../WorkspaceChanges';
import type { ExecutionRef, HostRequestRef } from '@runlith/executions/protocol/execution';
import { finishedAnswer, measurement } from './answers';

const stdout = 'owned.ts(4,2): error TS2322: Type string is not assignable to number.';
const stderr = '1 check failed';
const name = `packages/peer/${'directory/'.repeat(10)}file.ts`;
const names = Array.from({ length: Math.ceil(TOOL_OUTPUT_MAX_BYTES / name.length) + 1 }, (_, at) => `${at}/${name}`);

const settlement = (
  verdicts: readonly CommandVerdict[],
  unread: readonly string[] = [],
  moved: readonly string[] = names,
  inspect: string | null = null,
): ShellSettlement => ({
  settled: { ...localRunning, code: 7 },
  stdout,
  stderr,
  cut: false,
  kept: null,
  outputUnavailable: null,
  checkouts: [{ tree: '/repo', own: true, moved, head: null, verdicts, unread, unmeasured: null }],
  inspect,
  shown: [],
  unseen: null,
});

for (const kind of ['overlap', 'taken', 'unread'] as const) {
  test(`shared ${kind} observations cannot evict the command result or its failure`, () => {
    const verdicts = names.map((name): CommandVerdict =>
      kind === 'taken' ? { name, verdict: 'taken', by: 'peer' } : { name, verdict: 'overlap' },
    );
    const result = settlement(kind === 'unread' ? [] : verdicts, kind === 'unread' ? names : []);
    const answer = finishedAnswer(
      { command: 'check', description: 'Check own files', waitMs: undefined, lifeMs: undefined, workdir: undefined },
      { ending: 'life ran out', words: '' },
      null,
      result,
      null,
    );
    const text = String(answer.value);
    expect(text).toContain(stdout);
    expect(text).toContain(stderr);
    expect(answer.verdict).toMatchObject({ kind: 'failed', error: 'Command exited with status 7.' });
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(TOOL_OUTPUT_MAX_BYTES);
  });
}

test('unread diagnostics survive in the retained observation and name a path in the command answer', () => {
  const unread = ['src/read-error.ts', 'src/another.ts'] as const;
  const result = settlement([], unread, unread, 'read the managed command');
  const observation = measurement(result, null);
  expect(observation).toContain(JSON.stringify(unread));
  const answer = finishedAnswer(
    { command: 'check', description: 'Check own files', waitMs: undefined, lifeMs: undefined, workdir: undefined },
    { ending: 'life ran out', words: '' },
    null,
    result,
    {
      execution: { installation: 'fixture', execution: 'command-1', incarnation: 1 } as ExecutionRef,
      operation: { installation: 'fixture', operation: 'operation-1' } as HostRequestRef,
    },
  );
  expect(String(answer.value)).toContain(unread[0]);
  expect(String(answer.value)).toContain('command-1');
  expect(String(answer.value)).toContain(stdout);
  expect(Buffer.byteLength(String(answer.value))).toBeLessThanOrEqual(TOOL_OUTPUT_MAX_BYTES);
});
