// @vitest-environment jsdom
import type { CommandEntry } from '@runlith/executions/protocol/inventory';
import type { CommandFeedFrame, CommandFeedSnapshot } from '@tagma/server/executions/contract/wire/commandFeed';
import type { CommandListAnswer, CommandReading } from '@tagma/server/executions/contract/wire/commands';
import type { TerminalRow } from '@tagma/server/executions/contract/wire/terminals';
import { Graph } from '@runlith/layer/Graph';
import { Layer } from '@runlith/layer/Layer';
import { Scope } from '@runlith/layer/Scope';
import { worldHooks } from '@runlith/layer/svelte/App.svelte';
import { expect, test, vi } from 'vitest';
import type { Notices } from '$lib/features/notices/Service.svelte.js';
import type { WallClock } from '$lib/features/workspace/WallClock.svelte.js';
import type { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import type { LiveConnection } from '$lib/wire/Live.js';
import type { Door } from '$lib/wire/Door.js';
import { ExecutionActs } from '../acts.svelte.js';
import { COMMAND_FOLD } from './foldRecord.js';
import { CommandActivity, type CommandScope } from './Activity.svelte.js';
import type { CommandListKey, ExecutionsRepo } from '../Repo.js';
import { ThreadNames, type OwnerWords } from '$lib/shared/threads/Names.svelte.js';

const NOW = 1_700_000_000_000;
const PAGE = 200;

const entry = (phase: 'running' | 'ended', over: Partial<CommandEntry> = {}): CommandEntry =>
  ({
    admission: {
      origin: { scope: 'p', owner: 'thread:thread-1', cohort: 'c' },
      limits: { executionMs: 600_000, executionCeilingMs: 14_400_000, origin: 'rule' },
      policyIdentity: 'policy',
    },
    state: {
      transport: 'pipes',
      lifetime: 'command',
      purpose: 'command',
      phase,
      streams: { stdout: 'open', stderr: 'open', pty: 'eof' },
      cleanup: 'pending',
      record: 'available',
    },
    deadline: {
      revision: 0,
      executionMs: 600_000,
      ceilingMs: 14_400_000,
      origin: 'rule',
      armed: 'native-acquired',
      expiresAt: NOW + 559_000,
    },
    admittedAtMs: NOW - 41_000,
    ...over,
  }) as CommandEntry;

const row = (over: {
  readonly execution: string;
  readonly admittedAt: number;
  readonly program: string;
  readonly phase: 'running' | 'ended';
  readonly standing: boolean;
  readonly thread?: string;
}): CommandReading => {
  const thread = over.thread ?? 'thread-1';
  return {
    command: {
      projectId: 1,
      execution: { installation: 'inst', execution: over.execution, incarnation: 0 },
      owner: { _tag: 'Thread', thread },
      origin: { _tag: 'Thread', thread },
      policyIdentity: 'policy',
      program: over.program,
      admittedAt: over.admittedAt,
    },
    live: { _tag: 'Held', entry: entry(over.phase) },
    wait: over.standing ? { mode: 'foreground', revision: 0 } : undefined,
  } as unknown as CommandReading;
};

const filtersOf = (key: CommandListKey): string => JSON.stringify([key.owner ?? null, key.standing ?? null, key.order ?? null]);

function pageOf(catalog: readonly CommandReading[], key: CommandListKey, host?: unknown): CommandListAnswer {
  const filters = filtersOf(key);
  const direction = key.order === 'newest' ? -1 : 1;
  const ordered = catalog
    .filter((reading) => key.standing === undefined || (reading.wait !== undefined) === key.standing)
    .toSorted(
      (left, right) =>
        direction *
        (left.command.admittedAt - right.command.admittedAt ||
          left.command.execution.execution.localeCompare(right.command.execution.execution)),
    );
  let from = 0;
  if (key.after !== undefined) {
    const [minted, at] = JSON.parse(key.after) as [string, string];
    if (minted !== filters) throw new Error('selection-changed: a page is continued only under the selection that produced its cursor.');
    from = ordered.findIndex((reading) => reading.command.execution.execution === at) + 1;
  }
  const readings = ordered.slice(from, from + key.limit);
  const last = readings[readings.length - 1];
  return {
    readings,
    after:
      last !== undefined && from + readings.length < ordered.length
        ? JSON.stringify([filters, last.command.execution.execution])
        : undefined,
    host: host ?? { _tag: 'Answered', unmeasured: [] },
  } as unknown as CommandListAnswer;
}

let composed = NOW;

function frameOf(catalog: readonly CommandReading[], host?: unknown, terminals: readonly TerminalRow[] = []): CommandFeedSnapshot {
  const active = pageOf(catalog, { standing: true, order: 'newest', limit: PAGE }, host);
  const ended = pageOf(catalog, { standing: false, order: 'newest', limit: PAGE }, host);
  composed += 1;
  return {
    projectId: 1,
    composedAt: composed,
    active: active.readings,
    ended: ended.readings,
    endedAfter: ended.after,
    terminals,
    host: active.host,
    stale: false,
    operationKeys: {},
  } as unknown as CommandFeedSnapshot;
}

function doorOver(catalog: readonly CommandReading[], host?: unknown, terminals: readonly TerminalRow[] = []) {
  const refusals: unknown[] = [];
  let deliver: ((frame: CommandFeedFrame) => void) | null = null;
  let sequence = 0;
  const holds = { opened: 0 };
  const whole = (snapshot: CommandFeedSnapshot) => deliver?.({ _tag: 'Snapshot', sequence: ++sequence, snapshot });
  const read = { asked: 0, refuse: null as Error | null };
  const stopped: { readonly execution: string; readonly cause: string }[] = [];
  const repo = {
    commands: {
      key: (key: CommandListKey) => ({
        refresh: async () => pageOf(catalog, key, host),
      }),
    },
    commandFeed: {
      key: () => ({
        refresh: async () => {
          read.asked += 1;
          if (read.refuse !== null) throw read.refuse;
          return frameOf(catalog, host, terminals);
        },
      }),
    },
  } as unknown as ExecutionsRepo;
  const acts = new ExecutionActs({
    perform: async (operation: string, input: { readonly execution: string; readonly cause: string }) => {
      if (operation !== 'stop_command') throw new Error(`this suite makes no ${operation} call`);
      stopped.push({ execution: input.execution, cause: input.cause });
      return { receipt: { confirmed: [], residual: [], unverifiable: [] } };
    },
  } as unknown as Door);
  const live = {
    hold: (_open: unknown, onItem: (frame: CommandFeedFrame) => void) => {
      holds.opened += 1;
      deliver = onItem;
      return {
        unsubscribe: () => {
          if (deliver === onItem) deliver = null;
        },
      };
    },
  } as unknown as LiveConnection;
  const clock = { now: NOW, watch: () => () => undefined } as unknown as WallClock;
  const notices = {
    refusal: (error: unknown) => refusals.push(error),
    error: (...words: string[]) => refusals.push(words),
  } as unknown as Notices;
  const workspace = { find: (id: number) => (id === 1 ? { rootPath: '/repo' } : null) } as unknown as Workspace;
  const scope = Scope.make('command-activity-test');
  void new Graph(Layer.mergeAll(), { effectRoot: worldHooks.effectRoot }).open(scope);
  return {
    commands: new CommandActivity(repo, live, { projectId: 1 }, scope, clock, notices, workspace, ThreadNames.make(), acts),
    refusals,
    send: () => whole(frameOf(catalog, host, terminals)),
    compose: () => frameOf(catalog, host, terminals),
    deliver: (frame: CommandFeedSnapshot) => whole(frame),
    frame: (frame: CommandFeedFrame) => deliver?.(frame),
    holds,
    read,
    stopped,
  };
}

test('reading listeners receive fresh host answers and release their subscription', () => {
  const door = doorOver([]);
  const readings: string[] = [];
  const release = door.commands.onReading(() => readings.push(door.commands.readingFor([]).kind));
  door.deliver(frameOf([], { _tag: 'Unavailable', detail: 'offline' }));
  door.deliver({ ...frameOf([]), stale: true });
  door.send();
  release();
  door.send();
  expect(readings).toEqual(['ok']);
});

const wordsOf = (thread: string): OwnerWords => ({ label: thread, archived: false, harness: false });

function viewOver(catalog: readonly CommandReading[], scope: CommandScope, host?: unknown, terminals: readonly TerminalRow[] = []) {
  const door = doorOver(catalog, host, terminals);
  door.send();
  const activity = door.commands.forThread(scope.thread, wordsOf(scope.thread));
  return { ...door, activity };
}

const folds = (): readonly PerformanceEntry[] => performance.getEntriesByName(COMMAND_FOLD, 'mark');

const thread: CommandScope = { kind: 'thread', thread: 'thread-1' };

const history = (count: number): CommandReading[] =>
  Array.from({ length: count }, (_unused, at) =>
    row({
      execution: `old-${String(at).padStart(4, '0')}`,
      admittedAt: NOW - 86_400_000 + at,
      program: 'git status',
      phase: 'ended',
      standing: false,
    }),
  );

test('a command that ended while the feed delivered nothing stops being drawn as work that is running', async () => {
  vi.useFakeTimers();
  try {
    const catalog = [row({ execution: 'live-1', admittedAt: NOW - 41_000, program: 'find .', phase: 'running', standing: true })];
    const door = viewOver(catalog, thread);
    expect(door.activity.lines.map((line) => line.phase)).toEqual(['running']);

    catalog[0] = row({ execution: 'live-1', admittedAt: NOW - 41_000, program: 'find .', phase: 'ended', standing: false });
    const release = door.activity.watch();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(door.activity.lines).toEqual([]);
    expect(door.commands.lines.map((line) => line.phase)).toEqual(['ended']);
    expect(door.read.asked).toBe(1);

    release();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(door.read.asked).toBe(1);
  } finally {
    vi.useRealTimers();
  }
});

test('rows standing on a reading that stopped arriving are drawn as unconfirmed, with the reason the road back failed', async () => {
  vi.useFakeTimers();
  try {
    const catalog = [row({ execution: 'live-1', admittedAt: NOW - 41_000, program: 'find .', phase: 'running', standing: true })];
    const door = viewOver(catalog, thread);
    expect(door.commands.readingFor(door.activity.lines)).toEqual({ kind: 'ok' });

    door.read.refuse = new Error('the server could not be reached');
    const release = door.activity.watch();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(door.read.asked).toBeGreaterThan(0);
    expect(door.commands.readingFor(door.activity.lines)).toMatchObject({
      kind: 'stale',
      detail: 'the server could not be reached',
    });
    expect(door.activity.lines).toHaveLength(1);
    release();
  } finally {
    vi.useRealTimers();
  }
});

test('a thread view keeps following the feed after the component that first asked for it is gone', () => {
  const catalog = [row({ execution: 'live-1', admittedAt: NOW - 41_000, program: 'bun test', phase: 'running', standing: true })];
  const door = doorOver(catalog);
  door.send();
  let first: ReturnType<typeof door.commands.forThread> | undefined;
  const leave = $effect.root(() => {
    first = door.commands.forThread('thread-1', wordsOf('thread-1'));
    expect(first.lines.map((line) => line.phase)).toEqual(['running']);
  });
  leave();

  catalog[0] = row({ execution: 'live-1', admittedAt: NOW - 41_000, program: 'bun test', phase: 'ended', standing: false });
  door.send();

  const again = door.commands.forThread('thread-1', wordsOf('thread-1'));
  expect(again).toBe(first);
  expect(again.lines).toEqual([]);
  expect(door.commands.lines.map((line) => line.phase)).toEqual(['ended']);
});

test('a thread view answers its command by key while it runs and after it ended, carrying the exit its ending names', () => {
  const catalog = [row({ execution: 'live-1', admittedAt: NOW - 41_000, program: 'sleep 600', phase: 'running', standing: true })];
  const door = viewOver(catalog, thread);
  expect(door.activity.line('live-1:0')).toMatchObject({ phase: 'running', exit: null });

  const ended = row({ execution: 'live-1', admittedAt: NOW - 41_000, program: 'sleep 600', phase: 'ended', standing: false });
  catalog[0] = {
    ...ended,
    live: { _tag: 'Held', entry: entry('ended', { ending: { nativeExit: { _tag: 'Code', code: 3 } } } as never) },
  } as CommandReading;
  door.send();

  expect(door.activity.lines).toEqual([]);
  expect(door.activity.line('live-1:0')).toMatchObject({ phase: 'ended', exit: { _tag: 'Code', code: 3 } });
  expect(door.activity.line('other-1:0')).toBeNull();
});

test('a frame composed before the one standing never replaces it, whichever road delivers it late', async () => {
  const catalog = [row({ execution: 'live-1', admittedAt: NOW - 41_000, program: 'bun test', phase: 'running', standing: true })];
  const door = viewOver(catalog, thread);
  const late = door.compose();

  catalog[0] = row({ execution: 'live-1', admittedAt: NOW - 41_000, program: 'bun test', phase: 'ended', standing: false });
  await door.activity.refresh();
  expect(door.commands.lines.map((line) => line.phase)).toEqual(['ended']);

  door.deliver(late);
  expect(door.activity.lines).toEqual([]);
  expect(door.commands.lines.map((line) => line.phase)).toEqual(['ended']);

  door.send();
  expect(door.commands.lines.map((line) => line.phase)).toEqual(['ended']);
});

test('a stop over work that has already ended reads the truth rather than waiting for a frame that cannot come', async () => {
  const catalog = [row({ execution: 'live-1', admittedAt: NOW - 41_000, program: 'find .', phase: 'running', standing: true })];
  const door = viewOver(catalog, thread);
  const line = door.activity.lines[0];
  expect(line).toBeDefined();
  if (line === undefined) return;

  catalog[0] = row({ execution: 'live-1', admittedAt: NOW - 41_000, program: 'find .', phase: 'ended', standing: false });
  await door.activity.stop(line);

  expect(door.stopped).toEqual([{ execution: 'live-1', cause: 'explicit-stop' }]);
  expect(door.activity.lines).toEqual([]);
  expect(door.commands.lines.map((line) => line.phase)).toEqual(['ended']);
});

test('a command running now stands in its view though the window over ended work is full of older rows', () => {
  const running = row({ execution: 'live-1', admittedAt: NOW - 41_000, program: 'sleep 30', phase: 'running', standing: true });
  const { activity } = viewOver([...history(200), running], thread);

  expect(activity.lines.map((line) => line.key)).toContain('live-1:0');
});

test('a hole in the reading reaches a panel only through its own rows, and it names them', () => {
  const running = row({ execution: 'live-1', admittedAt: NOW - 41_000, program: 'sleep 30', phase: 'running', standing: true });
  const gone = {
    ...row({ execution: 'gone-1', admittedAt: NOW - 61_000, program: 'tsc --noEmit', phase: 'running', standing: true }),
    live: { _tag: 'Unheld' },
  } as CommandReading;
  const hole = {
    _tag: 'Answered',
    unmeasured: [{ region: '4 of the references asked about', detail: 'they name a generation this host has replaced' }],
  };

  expect(viewOver([running], thread, hole).activity.reading).toEqual({ kind: 'ok' });

  const own = viewOver([running, gone], thread, hole).activity.reading;
  expect(own).toMatchObject({ kind: 'partial', rows: ['tsc'] });
});

test('a held terminal is drawn by its label and command line, with the listeners the host tied to it', () => {
  const listing = (over: Partial<TerminalRow['record']>, listeners?: TerminalRow['listeners']): TerminalRow =>
    ({
      record: {
        projectId: 1,
        execution: { installation: 'inst', execution: over.execution?.execution ?? 'term-1', incarnation: 13 },
        transport: 'pty',
        lifetime: 'held',
        holder: 'thread:thread-1',
        heldBy: 'thread-1',
        revision: 0,
        generation: 0,
        acceptedAt: NOW - 450_000,
        ...over,
      },
      state: {
        transport: 'pty',
        lifetime: 'held',
        purpose: 'command',
        phase: 'running',
        streams: { stdout: 'eof', stderr: 'eof', pty: 'open' },
        cleanup: 'pending',
        record: 'available',
      },
      listeners,
    }) as unknown as TerminalRow;
  const socket = (port: number, address: string, tied: boolean) => ({
    protocol: 'tcp',
    address,
    port,
    holder: { pid: 23499 },
    association: tied ? { relation: 'ancestry', identity: 'unknown' } : undefined,
  });
  const report = {
    listeners: [socket(6111, '::1', true), socket(5433, '127.0.0.1', false), socket(9000, '10.0.0.4', true)],
  } as unknown as TerminalRow['listeners'];

  const named = listing(
    { label: 'Tagma app dev server', commandLine: 'bun run --bun vite --port 6111', program: 'bun', cwd: '/repo/apps/tagma/app' },
    report,
  );
  const { activity } = viewOver([], thread, undefined, [named]);
  const [line] = activity.lines;
  expect(line).toMatchObject({
    kind: 'terminal',
    label: 'Tagma app dev server',
    command: 'bun run --bun vite --port 6111',
    note: '/repo/apps/tagma/app',
    ports: [
      { port: 6111, address: '::1', url: 'http://localhost:6111/' },
      { port: 9000, address: '10.0.0.4', url: null },
    ],
  });

  const bare = viewOver([], thread, undefined, [listing({ program: '/bin/zsh' })]).activity.lines[0];
  expect(bare).toMatchObject({ label: null, command: '/bin/zsh', ports: [] });

  const shared = { listeners: [socket(3000, '*', true), socket(3000, '*', true)] } as unknown as TerminalRow['listeners'];
  const workers = viewOver([], thread, undefined, [listing({ program: 'node' }, shared)]).activity.lines[0];
  expect(workers?.ports).toEqual([{ port: 3000, address: '*', url: 'http://localhost:3000/' }]);
});

test('a held terminal is a line to find by its key whatever its transport, so a wait on it can name its target; a call-bound one is not', () => {
  const listing = (execution: string, transport: 'pty' | 'pipes', lifetime: 'held' | 'call'): TerminalRow =>
    ({
      record: {
        projectId: 1,
        execution: { installation: 'inst', execution, incarnation: 4 },
        transport,
        lifetime,
        holder: 'thread:thread-1',
        heldBy: 'thread-1',
        revision: 0,
        generation: 0,
        acceptedAt: NOW - 1000,
        program: 'tail',
      },
      state: { transport, lifetime, purpose: 'command', phase: 'running', streams: {}, cleanup: 'pending', record: 'available' },
    }) as unknown as TerminalRow;
  const { activity } = viewOver([], thread, undefined, [
    listing('held-pty', 'pty', 'held'),
    listing('held-pipes', 'pipes', 'held'),
    listing('bound-pipes', 'pipes', 'call'),
  ]);
  expect(activity.line('held-pty:4')).toMatchObject({ kind: 'terminal', command: 'tail' });
  expect(activity.line('held-pipes:4')).toMatchObject({ kind: 'terminal', command: 'tail', live: 'held' });
  expect(activity.line('bound-pipes:4')).toBeNull();
});

test('one frame of the reading is folded once, and every row reads its slice of it', () => {
  const threads = Array.from({ length: 200 }, (_unused, at) => `thread-${at}`);
  const catalog = threads.map((owner, at) =>
    row({
      execution: `live-${String(at).padStart(4, '0')}`,
      admittedAt: NOW - 200_000 + at,
      program: 'bun test',
      phase: 'running',
      standing: true,
      thread: owner,
    }),
  );
  const { commands, send } = doorOver(catalog);

  performance.clearMarks(COMMAND_FOLD);
  const views = threads.map((owner) => commands.forThread(owner, wordsOf(owner)));
  send();
  const slices = views.map((view) => view.lines);
  expect(slices.map((lines) => lines.length)).toEqual(threads.map(() => 1));
  expect(folds()).toHaveLength(1);

  send();
  views.forEach((view, at) => expect(view.lines).toBe(slices[at]));
  expect(folds()).toHaveLength(2);
});

test('a thread whose commands did not move keeps the slice its row holds, and the one that moved is built again', () => {
  const catalog: CommandReading[] = [
    row({ execution: 'live-1', admittedAt: NOW - 41_000, program: 'sleep 30', phase: 'running', standing: true, thread: 'thread-1' }),
    row({ execution: 'live-2', admittedAt: NOW - 31_000, program: 'sleep 40', phase: 'running', standing: true, thread: 'thread-2' }),
  ];
  const { commands, send } = doorOver(catalog);
  send();
  const first = commands.forThread('thread-1', wordsOf('thread-1'));
  const second = commands.forThread('thread-2', wordsOf('thread-2'));
  const before = [first.lines, second.lines];
  expect(before.map((lines) => lines.length)).toEqual([1, 1]);

  catalog[0] = row({
    execution: 'live-1',
    admittedAt: NOW - 41_000,
    program: 'sleep 30',
    phase: 'ended',
    standing: true,
    thread: 'thread-1',
  });
  send();

  expect(first.lines).not.toBe(before[0]);
  expect(first.lines[0]).toMatchObject({ phase: 'ended' });
  expect(second.lines).toBe(before[1]);
});

test('a thread’s ended commands join its lines, and a neighbour’s command ending leaves them as they were', () => {
  const catalog: CommandReading[] = [
    row({ execution: 'done-1', admittedAt: NOW - 90_000, program: 'git status', phase: 'ended', standing: false, thread: 'thread-1' }),
    row({ execution: 'live-2', admittedAt: NOW - 31_000, program: 'sleep 40', phase: 'running', standing: true, thread: 'thread-2' }),
  ];
  const { commands, send } = doorOver(catalog);
  send();
  const first = commands.forThread('thread-1', wordsOf('thread-1'));
  const second = commands.forThread('thread-2', wordsOf('thread-2'));
  const before = first.joined([]);
  expect(before.map((line) => [line.key, line.phase])).toEqual([['done-1:0', 'ended']]);

  catalog[1] = row({
    execution: 'live-2',
    admittedAt: NOW - 31_000,
    program: 'sleep 40',
    phase: 'ended',
    standing: false,
    thread: 'thread-2',
  });
  send();

  expect(first.joined([])).toBe(before);
  expect(second.joined([]).map((line) => [line.key, line.phase])).toEqual([['live-2:0', 'ended']]);
});

test('a line another owner holds joins a thread only by a key its calls linked, and stands unchanged while it does not move', () => {
  const base = row({ execution: 'support-1', admittedAt: NOW - 5_000, program: 'rg --files', phase: 'running', standing: true });
  const support = { ...base, command: { ...base.command, owner: { _tag: 'Service', scope: 'checkout' } } } as CommandReading;
  const catalog: CommandReading[] = [
    support,
    row({ execution: 'live-1', admittedAt: NOW - 41_000, program: 'bun test', phase: 'running', standing: true, thread: 'thread-1' }),
    row({ execution: 'live-2', admittedAt: NOW - 31_000, program: 'sleep 40', phase: 'running', standing: true, thread: 'thread-2' }),
  ];
  const { commands, send } = doorOver(catalog);
  send();
  const view = commands.forThread('thread-1', wordsOf('thread-1'));
  const links = ['support-1:0', 'live-1:0', 'gone-1:0'];
  expect(view.joined([]).map((line) => line.key)).toEqual(['live-1:0']);
  const joined = view.joined(links);
  expect(joined.map((line) => line.key)).toEqual(['live-1:0', 'support-1:0']);

  catalog[2] = row({
    execution: 'live-2',
    admittedAt: NOW - 31_000,
    program: 'sleep 40',
    phase: 'ended',
    standing: false,
    thread: 'thread-2',
  });
  send();
  expect(view.joined(links)).toBe(joined);

  catalog[0] = { ...support, live: { _tag: 'Held', entry: entry('ended') } } as CommandReading;
  send();
  expect(view.joined(links).find((line) => line.key === 'support-1:0')?.phase).toBe('ended');
});

test('a change over the reading the feed holds keeps every untouched line, and a change over any other reading opens the feed again', async () => {
  const catalog: CommandReading[] = [
    row({ execution: 'live-1', admittedAt: NOW - 41_000, program: 'sleep 30', phase: 'running', standing: true, thread: 'thread-1' }),
    row({ execution: 'live-2', admittedAt: NOW - 31_000, program: 'sleep 40', phase: 'running', standing: true, thread: 'thread-2' }),
  ];
  const door = doorOver(catalog);
  door.frame({ _tag: 'Snapshot', sequence: 3, snapshot: door.compose() });
  const first = door.commands.forThread('thread-1', wordsOf('thread-1'));
  const second = door.commands.forThread('thread-2', wordsOf('thread-2'));
  const before = second.lines;
  const ended = row({
    execution: 'live-1',
    admittedAt: NOW - 41_000,
    program: 'sleep 30',
    phase: 'ended',
    standing: true,
    thread: 'thread-1',
  });

  door.frame({ _tag: 'Delta', sequence: 4, base: 3, delta: { composedAt: NOW + 10_000_000, active: { readings: [ended], measured: [] } } });
  expect(first.lines[0]).toMatchObject({ phase: 'ended' });
  expect(second.lines).toBe(before);
  expect(door.holds.opened).toBe(1);

  door.frame({ _tag: 'Delta', sequence: 9, base: 7, delta: { composedAt: NOW + 20_000_000 } });
  await Promise.resolve();
  expect(door.holds.opened).toBe(2);
  expect(first.lines[0]).toMatchObject({ phase: 'ended' });
});
