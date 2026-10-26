import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Clock, Deferred, Duration, Effect, Fiber, Queue, Stream } from 'effect';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import type { InventoryFeedItem } from '@runlith/executions/protocol/inventory';
import { appliedCommandFeed } from './feedDelta.js';
import { type CommandFeedFrame, type CommandFeedSnapshot, type CommandFeedSubscription } from '../contract/wire/commandFeed.js';
import type { CommandCursor, CommandLive } from '../contract/wire/commands.js';
import { TerminalUnavailable } from '../contract/wire/refusals.js';
import type { TerminalRow } from '../contract/wire/terminals.js';
import type { CommandReader } from '../contract/service/commands.js';
import { makeCommandFeed } from './feed.js';
import type { Custody } from '../contract/service/custody.js';
import type { ExecutionProcessEvidence } from '../contract/service/records.js';
import type { ManagedCommands } from '../contract/service/commands.js';
import type { Terminals } from '../contract/service/terminals.js';
import type { CommandWaitMark } from '../store/commandRows.js';
import { TerminalAdopters } from '../contract/service/adopters.js';
import { ThreadId } from '../../platform/contract/wire/thread.js';
import { noAdopters } from '../testing/doubles.js';
import { commandChannel } from './channel.js';

type Selection = {
  readonly standing?: boolean;
  readonly order?: string;
  readonly limit: number;
  readonly after?: CommandCursor;
};

type Child = { readonly pid: number; readonly birth: string; readonly command: string; readonly leader?: boolean };

type Feeds = Pick<CommandReader['Service'], 'follow'>;

const refOf = (execution: string): ExecutionRef => ({ installation: 'inst', execution, incarnation: 0 }) as ExecutionRef;

const usageRows = (execution: string, children: readonly Child[]) =>
  children.map((child) => ({
    identity: { pid: child.pid, birth: child.birth },
    cpuMicros: 0,
    residentBytes: 0,
    association: { execution: refOf(execution), relation: child.leader === true ? 'leader' : 'ancestry', identity: 'unknown' },
  }));

const term = (): TerminalRow => ({ record: { execution: { execution: 'term-1', incarnation: 0 } } }) as unknown as TerminalRow;

const cursor = (at: number): CommandCursor => String(at) as CommandCursor;

const floorOver = Effect.fnUntraced(function* (
  options: {
    readonly standing?: readonly string[];
    readonly ended?: readonly string[];
    readonly held?: boolean;
  } = {},
) {
  const owed = [...(options.standing ?? ['live-1', 'live-2'])];
  const discharged = [...(options.ended ?? ['old-1'])];
  const asked: Selection[] = [];
  const read: string[][] = [];
  const rosters: string[] = [];
  let inFlight = 0;
  let maxConcurrent = 0;
  const moves = yield* Queue.unbounded<InventoryFeedItem>();
  const custody = yield* Queue.unbounded<number>();
  const stored = {
    waits: [] as CommandWaitMark[],
    newest: null as string | null,
    terminals: [term()],
    stale: false,
    failing: false,
    unavailable: false,
    unheld: new Set<string>(),
    ended: new Set<string>(),
    children: [] as Child[],
    current: undefined as { readonly pid: number; readonly birth: string } | undefined,
    taken: 1,
    reports: 0,
    epoch: 0,
    revision: 0 as number | undefined,
    moved: new Map<string, number>(),
    watched: new Set<string>(options.held === false ? [] : [...owed, ...discharged]),
  };
  const rows = Effect.fnUntraced(function* (selection: Selection) {
    if (stored.failing) return yield* new TerminalUnavailable({ owner: 'store', message: 'the store could not be read' });
    asked.push(selection);
    inFlight += 1;
    maxConcurrent = Math.max(maxConcurrent, inFlight);
    yield* Effect.sleep(Duration.millis(1));
    inFlight -= 1;
    const catalog = selection.standing === true ? owed : discharged;
    const from = selection.after === undefined ? 0 : Number(selection.after) + 1;
    const page = catalog.slice(from, from + selection.limit);
    const more = from + page.length < catalog.length;
    return {
      rows: page.map((execution) => {
        const wait = stored.waits.find((mark) => mark.execution === execution);
        return {
          record: { execution: refOf(execution), admittedAt: 1 },
          wait: wait === undefined ? null : { execution: refOf(execution), mode: wait.mode, revision: wait.revision },
        };
      }),
      after: more ? cursor(from + page.length - 1) : undefined,
    };
  });
  const liveOf = (ref: ExecutionRef): CommandLive => {
    if (stored.unavailable) return { _tag: 'Unavailable', detail: 'the host did not answer' };
    if (stored.unheld.has(ref.execution)) return { _tag: 'Unheld' };
    return {
      _tag: 'Held',
      readAt: 1,
      entry: {
        state: { phase: stored.ended.has(ref.execution) ? 'ended' : 'running' },
        usage: {
          execution: ref,
          takenAtMicros: stored.taken,
          processes: usageRows(ref.execution, stored.children),
          current: stored.current,
        },
      },
    } as unknown as CommandLive;
  };
  const reader = {
    rows: (_projectId: number, selection: Selection) => rows(selection),
    lives: (refs: readonly ExecutionRef[]) =>
      Effect.sync(() => {
        read.push(refs.map((ref) => ref.execution));
        return {
          live: liveOf,
          host: stored.unavailable ? { _tag: 'Unavailable', detail: 'the host did not answer' } : { _tag: 'Answered', unmeasured: [] },
        };
      }),
    operationKeys: () => Effect.succeed({}),
    marks: () => Effect.sync(() => ({ waits: stored.waits, newest: stored.newest })),
  } as unknown as CommandReader['Service'];
  const terminals = {
    inventory: (projectId: number) =>
      Effect.sync(() => {
        rosters.push(String(projectId));
        return { terminals: stored.terminals, more: false, stale: stored.stale };
      }),
  } as unknown as Terminals['Service'];
  const commands = {
    changes: () => Stream.fromQueue(moves),
    moves: () =>
      Effect.sync(() => ({
        epoch: stored.epoch,
        revision: stored.revision,
        horizon: 0,
        movedAfter: (execution: string, revision: number) => (stored.moved.get(execution) ?? -1) > revision,
        holds: (ref: ExecutionRef) => stored.watched.has(ref.execution),
      })),
  } as unknown as ManagedCommands['Service'];
  const evidence = {
    processes: (execution: ExecutionRef) =>
      Effect.sync(() => {
        stored.reports += 1;
        return {
          processes: stored.children.map((child) => ({
            identity: { pid: child.pid, birth: child.birth },
            command: child.command,
            association: { execution, relation: child.leader === true ? 'leader' : 'ancestry', identity: 'unknown' },
          })),
        };
      }),
  } as unknown as ExecutionProcessEvidence['Service'];
  const moved = {
    moves: (projectId: number) =>
      Stream.fromQueue(custody).pipe(
        Stream.filter((one) => one === projectId),
        Stream.map(() => undefined),
      ),
  } as unknown as Custody['Service'];
  const adoptions = yield* Queue.unbounded<void>();
  const adopted = new Map<string, string>();
  const adopters = TerminalAdopters.of({
    of: (_projectId, executions) =>
      Effect.sync(() => new Map(executions.flatMap((one) => (adopted.has(one) ? [[one, adopted.get(one) ?? '']] : [])))),
    moves: Stream.fromQueue(adoptions),
  });
  const feeds = yield* makeCommandFeed({ terminals, evidence, commands, custody: moved, reader });
  return {
    feeds,
    adopters,
    adopt: (execution: string, thread: string | null) =>
      Effect.suspend(() => {
        if (thread === null) adopted.delete(execution);
        else adopted.set(execution, thread);
        return Queue.offer(adoptions, undefined);
      }),
    asked,
    read,
    rosters,
    moves,
    custody,
    stored,
    transition: (revision: number, ...movedOnes: readonly string[]) =>
      Effect.suspend(() => {
        stored.revision = revision;
        for (const execution of movedOnes) stored.moved.set(execution, revision);
        return Queue.offer(moves, { _tag: 'Moved', revision, usage: [] });
      }),
    admit: (execution: string) => {
      owed.push(execution);
      stored.newest = execution;
      stored.watched.add(execution);
      stored.waits = [...stored.waits, { execution, incarnation: 0, mode: 'foreground', revision: 0 }];
    },
    discharge: (execution: string) => {
      owed.splice(owed.indexOf(execution), 1);
      discharged.unshift(execution);
      stored.waits = stored.waits.filter((mark) => mark.execution !== execution);
    },
    get maxConcurrent() {
      return maxConcurrent;
    },
  };
});

const params: CommandFeedSubscription = { projectId: 1, ended: 50 };

const names = (readings: readonly CommandFeedSnapshot['active'][number][]): readonly string[] =>
  readings.map((reading) => reading.command.execution.execution as string);

const whole = (frame: CommandFeedFrame | undefined): CommandFeedSnapshot => {
  if (frame?._tag !== 'Snapshot') throw new Error(`expected a whole reading, got ${frame?._tag}`);
  return frame.snapshot;
};

const firstOf = (subscription: CommandFeedSubscription, feeds: Feeds) =>
  Effect.map(
    Stream.runCollect(Stream.take(commandChannel({ feeds, adopters: noAdopters })['commands.subscribe'](subscription), 1)),
    (frames) => whole(frames[0]),
  );

const follow = Effect.fnUntraced(function* (
  subscription: CommandFeedSubscription,
  feeds: Feeds,
  offset: { readonly ms: number } = { ms: 0 },
  adopters: TerminalAdopters['Service'] = noAdopters,
) {
  const frames = yield* Queue.unbounded<CommandFeedFrame>();
  const wall = yield* Clock.clockWith(Effect.succeed);
  const shifted: Clock.Clock = {
    currentTimeMillisUnsafe: () => wall.currentTimeMillisUnsafe() + offset.ms,
    currentTimeMillis: Effect.sync(() => wall.currentTimeMillisUnsafe() + offset.ms),
    currentTimeNanosUnsafe: () => wall.currentTimeNanosUnsafe(),
    currentTimeNanos: wall.currentTimeNanos,
    monotonicTimeNanosUnsafe: () => wall.monotonicTimeNanosUnsafe(),
    monotonicTimeNanos: wall.monotonicTimeNanos,
    sleep: (duration) => wall.sleep(duration),
  };
  let reading: CommandFeedSnapshot | undefined;
  let sequence = -1;
  const fiber = yield* Effect.forkScoped(
    Stream.runForEach(commandChannel({ feeds, adopters })['commands.subscribe'](subscription), (frame) => Queue.offer(frames, frame)).pipe(
      Effect.provideService(Clock.Clock, shifted),
    ),
  );
  const next = Effect.map(Queue.take(frames), (frame) => {
    if (frame._tag === 'Snapshot') reading = frame.snapshot;
    else {
      if (reading === undefined || frame.base !== sequence) throw new Error(`a change over ${frame.base} reached a reader at ${sequence}`);
      const applied = appliedCommandFeed(reading, frame.delta);
      if (applied === undefined) throw new Error('a change that does not follow from the reading it was sent over');
      reading = applied;
    }
    sequence = frame.sequence;
    return frame;
  });
  return {
    next,
    reading: Effect.map(next, () => reading as CommandFeedSnapshot),
    held: Queue.size(frames),
    ended: Fiber.await(fiber),
    stop: Fiber.interrupt(fiber),
  };
});

const quiet = Effect.sleep(Duration.millis(50));

const round = (revision: number, measured: readonly string[], takenAtMicros = 1): InventoryFeedItem =>
  ({
    _tag: 'Moved',
    revision,
    usage: measured.map((execution) => ({ execution: refOf(execution), takenAtMicros })),
  }) as unknown as InventoryFeedItem;

it.live('a subscription opens on one whole reading: the standing set newest first, the ended window and the roster', () =>
  Effect.gen(function* () {
    const floor = yield* floorOver();
    yield* floor.transition(1);
    const first = yield* firstOf(params, floor.feeds);

    expect(floor.asked).toEqual([
      { standing: true, order: 'newest', limit: 200 },
      { standing: false, order: 'newest', limit: 50 },
    ]);
    expect(floor.rosters).toEqual(['1']);
    expect(first).toMatchObject({ projectId: 1, stale: false });
    expect(first.endedAfter).toBeUndefined();
    expect(names(first.active)).toEqual(['live-1', 'live-2']);
    expect(names(first.ended)).toEqual(['old-1']);
    expect(first.terminals).toHaveLength(1);
    expect(first.host._tag).toBe('Answered');
    expect(floor.read).toEqual([['live-1', 'live-2', 'old-1']]);
  }),
);

it.live('the standing set is walked page by page, so live work longer than a page is not hidden', () =>
  Effect.gen(function* () {
    const many = Array.from({ length: 250 }, (_unused, at) => `live-${String(at).padStart(4, '0')}`);
    const ended = Array.from({ length: 120 }, (_unused, at) => `old-${String(at).padStart(4, '0')}`);
    const floor = yield* floorOver({ standing: many, ended });
    yield* floor.transition(1);
    const first = yield* firstOf(params, floor.feeds);

    expect(first.active).toHaveLength(250);
    expect(names(first.active)[0]).toBe('live-0000');
    expect(names(first.active)[249]).toBe('live-0249');
    expect(floor.asked).toEqual([
      { standing: true, order: 'newest', limit: 200 },
      { standing: true, order: 'newest', limit: 200, after: cursor(199) },
      { standing: false, order: 'newest', limit: 50 },
    ]);
    expect(first.ended).toHaveLength(50);
    expect(first.endedAfter).toBe(cursor(49));
    expect(floor.maxConcurrent).toBe(1);
  }),
);

it.live('a thread adopting a terminal’s CLI reaches the feed with its adopter, and so does the adoption ending', () =>
  Effect.gen(function* () {
    const floor = yield* floorOver();
    const feed = yield* follow(params, floor.feeds, { ms: 0 }, floor.adopters);
    yield* floor.transition(4);
    const first = yield* feed.reading;

    yield* floor.adopt('term-1', 'thread-9');
    const adopted = yield* feed.reading;
    yield* floor.adopt('term-1', null);
    const released = yield* feed.reading;
    yield* feed.stop;

    expect(first.terminals[0]?.record.adoptedBy).toBeUndefined();
    expect(adopted.terminals[0]?.record.adoptedBy).toBe(ThreadId.make('thread-9'));
    expect(released.terminals[0]?.record.adoptedBy).toBeUndefined();
  }),
);

it.live('a host that could not answer leaves every row unavailable, and the next transition reads everything again', () =>
  Effect.gen(function* () {
    const floor = yield* floorOver();
    floor.stored.unavailable = true;
    const feed = yield* follow(params, floor.feeds);
    yield* floor.transition(4);
    const first = yield* feed.reading;
    floor.stored.unavailable = false;
    yield* floor.transition(5);
    const again = yield* feed.reading;
    yield* feed.stop;

    expect(first.host).toMatchObject({ _tag: 'Unavailable' });
    expect(first.active.every((reading) => reading.live._tag === 'Unavailable')).toBe(true);
    expect(again.host._tag).toBe('Answered');
    expect(again.active.every((reading) => reading.live._tag === 'Held')).toBe(true);
    expect(floor.read).toEqual([
      ['live-1', 'live-2', 'old-1'],
      ['live-1', 'live-2', 'old-1'],
    ]);
  }),
);

it.live('a command discharged between the two reads is carried as ended, and never in both', () =>
  Effect.gen(function* () {
    const floor = yield* floorOver({ standing: ['live-1', 'live-2'], ended: ['live-2', 'old-1'] });
    yield* floor.transition(1);
    const first = yield* firstOf(params, floor.feeds);

    expect(names(first.active)).toEqual(['live-1']);
    expect(names(first.ended)).toEqual(['live-2', 'old-1']);
  }),
);

it.live('a transition of work no reading carries reads nothing and sends nothing', () =>
  Effect.gen(function* () {
    const floor = yield* floorOver();
    const feed = yield* follow(params, floor.feeds);
    yield* floor.transition(4);
    yield* feed.next;
    for (let revision = 5; revision < 15; revision += 1) yield* floor.transition(revision, `another-project-${revision}`);
    yield* quiet;

    expect(yield* feed.held).toBe(0);
    expect(floor.asked).toHaveLength(2);
    expect(floor.read).toHaveLength(1);
    yield* feed.stop;
  }),
);

it.live('a transition of one carried command reads that command alone and sends only its row', () =>
  Effect.gen(function* () {
    const floor = yield* floorOver();
    const feed = yield* follow(params, floor.feeds);
    yield* floor.transition(4);
    const first = yield* feed.reading;
    floor.stored.unheld.add('live-2');
    yield* floor.transition(5, 'live-2');
    const frame = yield* feed.next;
    yield* feed.stop;

    expect(frame._tag).toBe('Delta');
    if (frame._tag !== 'Delta') return;
    expect(frame.delta.active?.readings.map((reading) => reading.command.execution.execution as string)).toEqual(['live-2']);
    expect(frame.delta.ended).toBeUndefined();
    expect(floor.read.at(-1)).toEqual(['live-2']);
    expect(floor.asked).toHaveLength(2);
    expect(first.ended[0]?.live._tag).toBe('Held');
  }),
);

it.live(
  'standing work the host holds no state for is read again at every transition until it reads ended, because nothing stamps its moves',
  () =>
    Effect.gen(function* () {
      const floor = yield* floorOver({ standing: ['live-1', 'live-2', 'done-3'], held: false });
      floor.stored.ended.add('done-3');
      const feed = yield* follow(params, floor.feeds);
      yield* floor.transition(4);
      yield* feed.next;
      yield* floor.transition(5, 'another-project-1');
      yield* quiet;
      yield* floor.transition(6, 'another-project-2');
      yield* quiet;
      yield* feed.stop;

      expect(floor.read.slice(1)).toEqual([
        ['live-1', 'live-2'],
        ['live-1', 'live-2'],
      ]);
    }),
);

it.live('a gap, or moves the cell can no longer vouch for, reads everything again, even at the revision the reading stands at', () =>
  Effect.gen(function* () {
    const floor = yield* floorOver();
    const feed = yield* follow(params, floor.feeds);
    yield* floor.transition(2);
    yield* feed.next;
    yield* Queue.offer(floor.moves, { _tag: 'Gap', revision: 9, detail: '7 transitions passed' });
    yield* quiet;
    floor.stored.epoch += 1;
    yield* Queue.offer(floor.moves, round(2, []));
    yield* quiet;
    yield* feed.stop;

    expect(floor.asked).toHaveLength(6);
    expect(floor.read).toHaveLength(3);
  }),
);

it.live('a burst of transitions is read at most twice, one reading at a time, and a later transition still reads', () =>
  Effect.gen(function* () {
    const floor = yield* floorOver({ held: false });
    for (let revision = 1; revision <= 7; revision += 1) yield* floor.transition(revision);
    const feed = yield* follow(params, floor.feeds);
    yield* feed.next;
    yield* quiet;
    yield* feed.stop;

    expect(floor.read.length).toBeLessThanOrEqual(2);
    expect(floor.maxConcurrent).toBe(1);
  }),
);

it.live('a sampling round that measured none of the carried commands, over rows that did not move, reads nothing', () =>
  Effect.gen(function* () {
    const floor = yield* floorOver();
    const feed = yield* follow(params, floor.feeds);
    yield* floor.transition(4);
    yield* feed.next;
    yield* Queue.offer(floor.moves, round(4, ['another-project-1']));
    yield* Queue.offer(floor.moves, round(4, []));
    yield* quiet;
    yield* feed.stop;

    expect(yield* feed.held).toBe(0);
    expect(floor.asked).toHaveLength(2);
    expect(floor.read).toHaveLength(1);
  }),
);

it.live('a custody move in the project draws the roster again with no host read, and one in another project reads nothing', () =>
  Effect.gen(function* () {
    const floor = yield* floorOver();
    const feed = yield* follow(params, floor.feeds);
    yield* floor.transition(4);
    yield* feed.next;
    yield* Queue.offer(floor.custody, 2);
    yield* quiet;
    expect(yield* feed.held).toBe(0);

    floor.stored.terminals = [];
    yield* Queue.offer(floor.custody, 1);
    const moved = yield* feed.reading;
    yield* feed.stop;
    expect(moved.terminals).toEqual([]);
    expect(floor.read).toHaveLength(1);
  }),
);

it.live('a sampling round that measured a carried command the reading holds nothing for reads that command again', () =>
  Effect.gen(function* () {
    const floor = yield* floorOver();
    floor.stored.unheld.add('live-2');
    const feed = yield* follow(params, floor.feeds);
    yield* floor.transition(4);
    yield* feed.next;
    floor.stored.unheld.delete('live-2');
    yield* Queue.offer(floor.moves, round(4, ['live-2']));
    const drawn = yield* feed.reading;
    yield* feed.stop;

    expect(floor.read.at(-1)).toEqual(['live-2']);
    expect(drawn.active[1]?.live._tag).toBe('Held');
  }),
);

const takenOf = (frame: CommandFeedSnapshot, execution: string): number | undefined => {
  const live = frame.active.find((one) => one.command.execution.execution === execution)?.live;
  return live?._tag === 'Held' ? live.entry.usage?.takenAtMicros : undefined;
};

it.live('a sampling round draws the new cost of a held command as a measured change, reading neither the host nor a page', () =>
  Effect.gen(function* () {
    const floor = yield* floorOver();
    const feed = yield* follow(params, floor.feeds);
    yield* floor.transition(4);
    const first = yield* feed.reading;
    yield* Queue.offer(floor.moves, round(4, ['live-2'], 1));
    yield* quiet;
    const repeated = yield* feed.held;
    yield* Queue.offer(floor.moves, round(4, ['live-2'], 7));
    const frame = yield* feed.next;
    yield* Queue.offer(floor.moves, round(4, ['live-2'], 8));
    const measured = yield* feed.reading;
    yield* feed.stop;

    expect(repeated).toBe(0);
    expect(frame._tag === 'Delta' ? frame.delta.active : undefined).toMatchObject({ readings: [], measured: [{ key: 'live-2:0' }] });
    expect(floor.asked).toHaveLength(2);
    expect(floor.read).toHaveLength(1);
    expect(takenOf(measured, 'live-2')).toBe(8);
    expect(takenOf(measured, 'live-1')).toBe(1);
    expect(measured.active[0]).toBe(first.active[0]);
    expect(measured.composedAt).toBeGreaterThanOrEqual(first.composedAt);
  }),
);

const currentOf = (frame: CommandFeedSnapshot, execution: string): string | undefined =>
  frame.active.find((one) => one.command.execution.execution === execution)?.current?.command;

it.live('a held command names the host-selected child from one process report, read again only when that witness changes', () =>
  Effect.gen(function* () {
    const floor = yield* floorOver({ standing: ['live-1'] });
    floor.stored.children = [
      { pid: 10, birth: 'leader', command: '/bin/zsh -c make', leader: true },
      { pid: 11, birth: 'child', command: 'sleep 30' },
      { pid: 12, birth: 'other-child', command: 'make build' },
    ];
    floor.stored.current = { pid: 11, birth: 'child' };
    const tree = (taken: number): InventoryFeedItem =>
      ({
        _tag: 'Moved',
        revision: 4,
        usage: [
          {
            execution: refOf('live-1'),
            takenAtMicros: taken,
            processes: usageRows('live-1', floor.stored.children),
            current: floor.stored.current,
          },
        ],
      }) as unknown as InventoryFeedItem;
    const feed = yield* follow(params, floor.feeds);
    yield* floor.transition(4);
    const first = yield* feed.reading;
    const named: (string | undefined)[] = [];
    for (let taken = 2; taken <= 3; taken += 1) {
      yield* Queue.offer(floor.moves, tree(taken));
      named.push(currentOf(yield* feed.reading, 'live-1'));
    }
    const reportsOverRounds = floor.stored.reports;
    floor.stored.children = [...floor.stored.children, { pid: 13, birth: 'latest-child', command: 'bun test' }];
    floor.stored.current = { pid: 13, birth: 'latest-child' };
    yield* Queue.offer(floor.moves, tree(12));
    const moved = yield* feed.reading;
    yield* feed.stop;

    expect(currentOf(first, 'live-1')).toBe('sleep 30');
    expect(named.every((command) => command === 'sleep 30')).toBe(true);
    expect(reportsOverRounds).toBe(1);
    expect(currentOf(moved, 'live-1')).toBe('bun test');
    expect(floor.stored.reports).toBe(2);
  }),
);

it.live('views of one project share one composition: a joining view reads once for all and gets a whole reading', () =>
  Effect.gen(function* () {
    const floor = yield* floorOver();
    const first = yield* follow(params, floor.feeds);
    yield* floor.transition(4);
    yield* first.next;
    const second = yield* follow(params, floor.feeds);
    const joined = yield* second.next;
    yield* quiet;
    const resent = yield* first.held;
    const reads = floor.read.length;
    floor.stored.unheld.add('live-1');
    yield* floor.transition(5, 'live-1');
    const [one, other] = yield* Effect.all([first.reading, second.reading], { concurrency: 'unbounded' });
    yield* first.stop;
    yield* second.stop;
    yield* floor.transition(6, 'live-2');
    yield* quiet;

    expect(joined._tag).toBe('Snapshot');
    expect(resent).toBe(0);
    expect(reads).toBe(2);
    expect(floor.read).toHaveLength(3);
    expect(one.active[0]?.live._tag).toBe('Unheld');
    expect(other).toEqual(one);
  }),
);

it.live('a view that has not taken its last frame is handed the newest whole reading instead of the next change', () =>
  Effect.gen(function* () {
    const floor = yield* floorOver();
    const gate = yield* Deferred.make<void>();
    const frames: CommandFeedFrame[] = [];
    const fiber = yield* Effect.forkScoped(
      Stream.runForEach(commandChannel({ feeds: floor.feeds, adopters: noAdopters })['commands.subscribe'](params), (frame) =>
        Effect.gen(function* () {
          frames.push(frame);
          if (frames.length === 1) yield* Deferred.await(gate);
        }),
      ),
    );
    yield* floor.transition(4);
    yield* quiet;
    floor.stored.unheld.add('live-1');
    yield* floor.transition(5, 'live-1');
    yield* quiet;
    floor.stored.unheld.add('live-2');
    yield* floor.transition(6, 'live-2');
    yield* quiet;
    yield* Deferred.succeed(gate, undefined);
    yield* quiet;
    yield* Fiber.interrupt(fiber);

    expect(frames.map((frame) => frame._tag)).toEqual(['Snapshot', 'Snapshot']);
    expect(whole(frames[1]).active.map((reading) => reading.live._tag)).toEqual(['Unheld', 'Unheld']);
  }),
);

it.live('a composition that fails ends every view holding it, and the next view composes afresh', () =>
  Effect.gen(function* () {
    const floor = yield* floorOver();
    const first = yield* follow(params, floor.feeds);
    yield* floor.transition(4);
    yield* first.next;
    const second = yield* follow(params, floor.feeds);
    yield* second.next;
    floor.stored.failing = true;
    yield* Queue.offer(floor.moves, { _tag: 'Gap', revision: 5, detail: 'lost' });
    const [one, other] = yield* Effect.all([first.ended, second.ended], { concurrency: 'unbounded' });
    floor.stored.failing = false;
    const third = yield* follow(params, floor.feeds);
    yield* floor.transition(6);
    const fresh = whole(yield* third.next);
    yield* third.stop;

    expect(one._tag).toBe('Failure');
    expect(other._tag).toBe('Failure');
    expect(names(fresh.active)).toEqual(['live-1', 'live-2']);
  }),
);

it.live('a command admitted after the transition that announced it is drawn at the next round, reading only that command', () =>
  Effect.gen(function* () {
    const floor = yield* floorOver();
    const feed = yield* follow(params, floor.feeds);
    yield* floor.transition(4);
    yield* feed.next;
    floor.admit('live-3');
    yield* Queue.offer(floor.moves, round(4, []));
    const admitted = yield* feed.reading;
    yield* Queue.offer(floor.moves, round(4, []));
    yield* quiet;
    const settledHeld = yield* feed.held;
    yield* feed.stop;

    expect(names(admitted.active)).toEqual(['live-1', 'live-2', 'live-3']);
    expect(floor.read.at(-1)).toEqual(['live-3']);
    expect(settledHeld).toBe(0);
  }),
);

it.live('a command admitted and discharged between two rounds still reaches the ended half', () =>
  Effect.gen(function* () {
    const floor = yield* floorOver();
    const feed = yield* follow(params, floor.feeds);
    yield* floor.transition(4);
    yield* feed.next;
    floor.admit('brief-1');
    floor.discharge('brief-1');
    yield* Queue.offer(floor.moves, round(4, []));
    const after = yield* feed.reading;
    yield* feed.stop;

    expect(names(after.active)).toEqual(['live-1', 'live-2']);
    expect(names(after.ended)).toEqual(['brief-1', 'old-1']);
  }),
);

it.live('a reading taken while the roster was refreshing is taken again once the refresh lands, and only then', () =>
  Effect.gen(function* () {
    const floor = yield* floorOver();
    floor.stored.stale = true;
    const feed = yield* follow(params, floor.feeds);
    yield* floor.transition(4);
    const refreshing = yield* feed.reading;
    yield* Queue.offer(floor.moves, round(4, []));
    yield* quiet;
    const stillRefreshing = yield* feed.held;
    floor.stored.stale = false;
    yield* Queue.offer(floor.moves, round(4, []));
    const landed = yield* feed.reading;
    yield* feed.stop;

    expect(refreshing.stale).toBe(true);
    expect(stillRefreshing).toBe(0);
    expect(landed.stale).toBe(false);
  }),
);

it.live('while live work stands and nothing moved, an empty change confirms the reading every five seconds without composing', () =>
  Effect.gen(function* () {
    const floor = yield* floorOver();
    const offset = { ms: 0 };
    const feed = yield* follow(params, floor.feeds, offset);
    yield* floor.transition(4);
    const first = yield* feed.reading;
    offset.ms = 4_000;
    yield* Queue.offer(floor.moves, round(4, []));
    yield* quiet;
    const early = yield* feed.held;
    offset.ms = 6_000;
    yield* Queue.offer(floor.moves, round(4, []));
    const confirmed = yield* feed.next;
    yield* feed.stop;

    expect(early).toBe(0);
    expect(confirmed).toMatchObject({ _tag: 'Delta', delta: { composedAt: first.composedAt } });
    expect(confirmed._tag === 'Delta' ? Object.keys(confirmed.delta) : []).toEqual(['composedAt']);
    expect(floor.asked).toHaveLength(2);
  }),
);

it.live('a second subscription reads for itself rather than replaying what the first one saw', () =>
  Effect.gen(function* () {
    const floor = yield* floorOver();
    yield* floor.transition(1);
    yield* firstOf(params, floor.feeds);
    yield* floor.transition(2);
    yield* firstOf(params, floor.feeds);

    expect(floor.asked).toHaveLength(4);
    expect(floor.rosters).toEqual(['1', '1']);
  }),
);
