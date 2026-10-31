import { cpus, loadavg } from 'node:os';
import { Clock, Deferred, Effect, Fiber } from 'effect';
import { costLedgerLayer, rootCost } from '@runlith/performance/CostLedger';
import { GraphStore } from '../../../platform/contract/service/store.js';
import { GraphTools, graphToolsFixture } from './graphTools.fixture.js';

const count = (name: string, fallback: number): number => {
  const raw = Bun.argv.find((value) => value.startsWith(`--${name}=`));
  const value = raw === undefined ? fallback : Number.parseInt(raw.slice(name.length + 3), 10);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`--${name} must be a non-negative integer`);
  return value;
};
const quiet = count('quiet', 12);
const loaded = count('loaded', 12);
const peers = count('peers', 15);
const rounds = count('rounds', 30);
const chars = count('chars', 174_000);

const bodyOf = (slots: number): string => {
  const lines: string[] = [];
  let length = 0;
  for (let at = 0; length < chars; at += 1) {
    const line =
      at % 2 === 0
        ? `Line ${at}: the graph keeps the product's knowledge sourced to its code, and every act lands in one unit. `.repeat(2)
        : `Строка ${at}: граф хранит знание продукта рядом с кодом, и каждое действие ложится одной единицей. `.repeat(2);
    lines.push(line);
    length += line.length + 1;
  }
  for (let slot = 0; slot < slots; slot += 1) {
    const at = Math.floor((slot * lines.length) / slots);
    lines[at] = `${lines[at]} slot-${slot}-open.`;
  }
  return lines.join('\n');
};

type Unit = {
  readonly operation: string;
  readonly outcome: string;
  readonly waitMs: number | null;
  readonly holdMs: number | null;
  readonly childMs: number | null;
  readonly outsideMs: number | null;
};

const program = Effect.gen(function* () {
  const { call, rootName } = yield* GraphTools;
  const writers = (yield* GraphStore).processes.writerMetrics;
  const clock = yield* Clock.Clock;
  const now = () => Number(clock.monotonicTimeNanosUnsafe()) / 1e6;
  const root = yield* rootName();
  const body = bodyOf(quiet + loaded);
  const created = yield* call('create_block', { parentId: root, title: 'large decision', body });
  if (created.status !== 'ok') return yield* Effect.die(new Error(`the large block was refused: ${JSON.stringify(created)}`));
  const big = (created.block as { name: string }).name;
  let peerActs = 0;
  let peersEnded = 0;
  const report = (row: Record<string, unknown>) => Effect.sync(() => console.log(JSON.stringify(row)));
  yield* report({ machine: { cores: cpus().length, load: loadavg() }, chars: body.length, quiet, loaded, peers, rounds });
  const edit = Effect.fnUntraced(function* (phase: 'quiet' | 'loaded', slot: number) {
    const rootId = `bench-edit-${slot}`;
    const actsBefore = peerActs;
    const endedBefore = peersEnded;
    const started = now();
    const answer = yield* rootCost(
      'bench.edit',
      call('edit_block', { blockId: big, oldString: ` slot-${slot}-open.`, newString: ` slot-${slot}-done.` }),
      rootId,
    );
    const wallMs = now() - started;
    const units = writers.units({ rootId, limit: 32 }).rows as readonly Unit[];
    const sum = (key: 'waitMs' | 'holdMs' | 'childMs' | 'outsideMs') => units.reduce((total, unit) => total + (unit[key] ?? 0), 0);
    yield* report({
      phase,
      slot,
      status: answer.status,
      wallMs: Number(wallMs.toFixed(1)),
      units: units.map((unit) => `${unit.operation}:${unit.outcome}`),
      waitMs: Number(sum('waitMs').toFixed(1)),
      holdMs: Number(sum('holdMs').toFixed(1)),
      childMs: Number(sum('childMs').toFixed(1)),
      outsideMs: Number(sum('outsideMs').toFixed(1)),
      peerActsDuring: peerActs - actsBefore,
      peersRunning: peers - endedBefore,
    });
  });
  for (let slot = 0; slot < quiet; slot += 1) yield* edit('quiet', slot);
  const go = yield* Deferred.make<void>();
  const peer = Effect.fnUntraced(function* (index: number) {
    yield* Deferred.await(go);
    for (let round = 0; round < rounds; round += 1) {
      const made = yield* call('create_block', { parentId: root, title: `peer ${index} ${round}`, body: `peer body ${round} anchor` });
      if (made.status !== 'ok') return yield* Effect.die(new Error(`a peer create was refused: ${JSON.stringify(made)}`));
      const edited = yield* call('edit_block', {
        blockId: (made.block as { name: string }).name,
        oldString: 'anchor',
        newString: 'anchored',
      });
      if (edited.status !== 'ok') return yield* Effect.die(new Error(`a peer edit was refused: ${JSON.stringify(edited)}`));
      peerActs += 2;
    }
    peersEnded += 1;
  });
  const fibers = [];
  for (let index = 0; index < peers; index += 1) fibers.push(yield* Effect.forkChild(peer(index)));
  const loadStarted = now();
  yield* Deferred.succeed(go, undefined);
  for (let slot = quiet; slot < quiet + loaded; slot += 1) yield* edit('loaded', slot);
  for (const fiber of fibers) yield* Fiber.join(fiber);
  yield* report({ peersDone: peersEnded, peerActs, loadMs: Number((now() - loadStarted).toFixed(1)) });
});

await Effect.runPromise(
  program.pipe(Effect.provide(graphToolsFixture), Effect.provide(costLedgerLayer({ capacity: 1024 })), Effect.scoped),
);
