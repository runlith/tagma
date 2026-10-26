import type { ProcessReport } from '@runlith/executions/protocol/evidence';
import type { TerminalRow } from '@tagma/server/executions/contract/wire/terminals';
import { describe, expect, test } from 'vitest';
import { placeStanding } from './standing.js';
import type { ProcessLine } from '../processes/lines.js';

const listing = (execution: string, over: Partial<TerminalRow['record']> = {}): TerminalRow =>
  ({
    record: {
      projectId: 1,
      execution: { installation: 'test', execution, incarnation: 1 },
      transport: 'pty',
      lifetime: 'held',
      holder: 'operator',
      revision: 1,
      program: 'zsh',
      rootId: 'tree',
      acceptedAt: 1,
      ...over,
    },
    state: { phase: 'running' },
  }) as unknown as TerminalRow;

const report = (execution: string, beneath: readonly string[]): ProcessReport =>
  ({
    processes: [
      { identity: { pid: 1 }, association: { execution: { installation: 'test', execution, incarnation: 1 }, relation: 'leader' } },
      ...beneath.map((command, index) => ({
        identity: { pid: 10 + index },
        command,
        association: { execution: { installation: 'test', execution, incarnation: 1 }, relation: 'work' },
      })),
    ],
  }) as unknown as ProcessReport;

const command = (key: string, place: string | null, over: Partial<ProcessLine> = {}): ProcessLine =>
  ({
    key,
    kind: 'command',
    owner: { thread: 'agent', label: 'builder', internal: false, archived: false },
    phase: 'running',
    live: 'held',
    label: null,
    command: 'bun test',
    place,
    ...over,
  }) as unknown as ProcessLine;

const read = placeStanding({
  roster: () => [
    listing('idle-1'),
    listing('idle-2'),
    listing('dev'),
    listing('agents', { holder: 'thread:agent' as never }),
    listing('cli', { launchedFor: 'agent' as never, program: 'claude' }),
    listing('elsewhere', { rootId: 'main' as never }),
  ],
  lines: () => [command('cmd-here', 'tree'), command('cmd-main', 'main'), command('cmd-done', 'tree', { phase: 'ended' })],
  processes: async (address) => report(address.execution, address.execution === 'dev' ? ['bun run dev'] : []),
  thread: (threadId) => `name of ${threadId}`,
});

describe('placeStanding', () => {
  test("an idle operator shell is only counted; what runs in a shell, an agent's terminal, a CLI and a live command of the place are listed", async () => {
    const standing = await read('tree');
    expect(standing.idle).toBe(2);
    expect(standing.runs.map((run) => [run.key, run.kind, run.what, run.holder])).toEqual([
      ['dev:1', 'terminal', 'bun run dev', null],
      ['agents:1', 'terminal', 'zsh', 'name of agent'],
      ['cli:1', 'terminal', 'claude', 'name of agent'],
      ['cmd-here', 'command', 'bun test', 'builder'],
    ]);
  });

  test('a shell whose process evidence cannot be read is listed rather than counted idle', async () => {
    const unread = placeStanding({
      roster: () => [listing('unknown')],
      lines: () => [],
      processes: async () => undefined,
      thread: (threadId) => threadId,
    });
    expect(await unread('tree')).toEqual({ runs: [{ key: 'unknown:1', kind: 'terminal', what: 'zsh', holder: null }], idle: 0 });
  });
});
