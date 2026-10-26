import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Clock, Deferred, Effect, Queue } from 'effect';
import type { CommandFacts, CommandMove } from '@runlith/agent-tools/WorkspaceChanges';
import { WRITING } from '../testing/doubles.js';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import type { CommandEntry } from './commandRows.js';
import { makeCommandWrites } from './commands.js';
import { Lives } from './lives.js';
import { makeCommandQueue } from './queue.js';
import { GraphDirectory } from '../../workspace/contract/service/checkouts.js';

const AT = { projectId: 1, threadId: '', runHint: null, origin: null, spelling: '/repo', key: 'host:repo' };

const move = (name: string, bytes: number): CommandMove => ({
  name,
  before: null,
  after: `digest-${name}`,
  present: true,
  existed: null,
  written: null,
  bytes: new Uint8Array(bytes),
  link: false,
  mode: 0o644,
});

it.live('queued commands keep their bytes only within one budget, and the rest are read again by the worker', () =>
  Effect.gen(function* () {
    const stalled = yield* Queue.unbounded<CommandEntry>();
    const gate = yield* Deferred.make<void>();
    const queue = makeCommandQueue<CommandEntry, StoreFailure>({
      write: (entries) => Effect.andThen(Queue.offerAll(stalled, entries), Deferred.await(gate)),
    });
    const writes = yield* makeCommandWrites({ lives: new Lives(), queue, journal: null, keptBytes: 10 }).pipe(
      Effect.provideService(GraphDirectory, '.tagma'),
    );
    const settle = Effect.fnUntraced(function* (threadId: string, one: CommandMove) {
      const life = yield* writes.open({ ...AT, threadId }, WRITING, AT.spelling);
      life.opened();
      life.ended();
      const now = yield* Clock.currentTimeMillis;
      yield* life.settle({ base: null, window: { from: now - 1_000, to: now + 1_000 }, moves: [one] });
      life.close();
    });
    yield* settle('session-a', move('first.bin', 8));
    yield* settle('session-b', move('second.bin', 8));
    const written = [yield* Queue.take(stalled), yield* Queue.take(stalled)];

    expect(written.flatMap((entry) => entry.moves.map((one) => [one.name, one.bytes?.byteLength ?? null])).sort()).toEqual([
      ['first.bin', 8],
      ['second.bin', null],
    ]);
    yield* Deferred.succeed(gate, undefined);
    yield* queue.settled({ projectId: AT.projectId });
  }),
);

it.live(
  'a command that writes nothing claims and queues nothing, and an overlap is retained only by commands whose life met the write',
  () =>
    Effect.gen(function* () {
      let now = 0;
      const queued: CommandEntry[] = [];
      const queue = makeCommandQueue<CommandEntry, StoreFailure>({ write: (entries) => Effect.sync(() => void queued.push(...entries)) });
      const writes = yield* makeCommandWrites({ lives: new Lives(() => now), queue, journal: null }).pipe(
        Effect.provideService(GraphDirectory, '.tagma'),
      );
      const written = { ...move('a.ts', 1), written: { from: 500, to: 500 } };
      const window = { base: null, window: { from: 0, to: 2_000 }, moves: [written] };
      const reader = writes.reading({ ...AT, threadId: 'reader' });
      const first = yield* writes.open({ ...AT, threadId: 'first' }, WRITING, AT.spelling);
      const second = yield* writes.open({ ...AT, threadId: 'second' }, WRITING, AT.spelling);
      const late = yield* writes.open({ ...AT, threadId: 'late' }, WRITING, AT.spelling);
      for (const life of [reader, first, second]) life.opened();
      now = 1_000;
      first.ended();
      second.ended();
      late.opened();
      now = 2_000;
      reader.ended();
      late.ended();

      expect(yield* reader.settle(window)).toEqual([{ name: 'a.ts', verdict: 'unclaimed' }]);
      expect(yield* late.settle(window)).toEqual([{ name: 'a.ts', verdict: 'unclaimed' }]);
      expect(yield* first.settle(window)).toEqual([{ name: 'a.ts', verdict: 'overlap' }]);
      yield* queue.settled({ projectId: AT.projectId });
      const retained = (threadId: string) => writes.unattributed({ projectId: AT.projectId, threadId }).map((one) => one.path);
      expect([retained('reader'), retained('late'), retained('first')]).toEqual([[], [], ['a.ts']]);
      expect(queued.map((entry) => entry.threadId).sort()).toEqual(['first', 'late']);
    }),
);

const TESTING: CommandFacts = {
  readsOnly: false,
  parts: [{ readsOnly: false, named: [], signature: 'bun test', listed: true, implicit: ['__snapshots__/', '*.snap'] }],
};

const FORMATTING: CommandFacts = {
  readsOnly: false,
  parts: [{ readsOnly: false, named: ['/repo/src/a.ts'], signature: 'oxfmt', listed: false, implicit: [] }],
};

it.live(
  'a change the command alone lived at but does not name stays nobody’s and observed by it, and a path it names is its own beside an opaque writer',
  () =>
    Effect.gen(function* () {
      let now = 0;
      const queue = makeCommandQueue<CommandEntry, StoreFailure>({ write: () => Effect.void });
      const writes = yield* makeCommandWrites({ lives: new Lives(() => now), queue, journal: null }).pipe(
        Effect.provideService(GraphDirectory, '.tagma'),
      );
      const started = Effect.fnUntraced(function* (threadId: string, facts: CommandFacts) {
        const life = yield* writes.open({ ...AT, threadId }, facts, AT.spelling);
        life.opened();
        return life;
      });
      const at = (name: string, ms: number) => ({
        base: null,
        window: { from: ms - 500, to: ms + 500 },
        moves: [{ ...move(name, 1), written: { from: ms, to: ms } }],
      });
      const reasons = (threadId: string) => writes.unattributed({ projectId: AT.projectId, threadId }).map((one) => [one.path, one.reason]);

      const tests = yield* started('tests', TESTING);
      now = 1_000;
      tests.ended();
      expect(yield* tests.settle(at('src/panes/holder.ts', 500))).toEqual([{ name: 'src/panes/holder.ts', verdict: 'unproven' }]);

      now = 2_000;
      const build = yield* started('build', WRITING);
      now = 3_000;
      build.ended();
      expect(yield* build.settle(at('.mcp.json', 2_500))).toEqual([{ name: '.mcp.json', verdict: 'unproven' }]);

      now = 4_000;
      const generate = yield* started('generate', WRITING);
      now = 4_200;
      const format = yield* started('format', FORMATTING);
      now = 4_300;
      format.ended();
      now = 5_000;
      generate.ended();
      expect(yield* format.settle(at('src/a.ts', 4_250))).toEqual([{ name: 'src/a.ts', verdict: 'attributed' }]);
      expect(yield* generate.settle(at('src/a.ts', 4_250))).toEqual([{ name: 'src/a.ts', verdict: 'taken', by: 'format' }]);

      yield* queue.settled({ projectId: AT.projectId });
      expect([reasons('tests'), reasons('build'), reasons('format'), reasons('generate')]).toEqual([
        [['src/panes/holder.ts', 'unproven']],
        [['.mcp.json', 'unproven']],
        [],
        [],
      ]);
    }),
);
