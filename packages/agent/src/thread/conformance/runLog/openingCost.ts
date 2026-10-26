import { describe, expect } from 'bun:test';
import type { Tester } from '@runlith/effect-test';
import { Context, Deferred, Effect, Option, type Scope } from 'effect';
import { PUBLISHING, READING } from '../../run/ThreadSnapshots';
import { Message } from '@runlith/llm/schema/messages';
import type { ThreadStorageFactory, ThreadStorageHarness } from '../storagePort';
import { replyTurn, scriptedStep } from './scripts';
import { OWNER, openedRun, pump, startedTurn, type ScriptedTurn } from './world';
type Read = {
  readonly port: string;
  readonly call: string;
  readonly publishing: boolean;
  readonly rows: number;
};
const publishing: Effect.Effect<boolean> = Effect.map(Effect.option(Effect.currentParentSpan), (found) => {
  let span = Option.getOrUndefined(found);
  while (span !== undefined && span._tag === 'Span') {
    if (span.name === PUBLISHING || span.name === READING) return true;
    span = Option.getOrUndefined(span.parent);
  }
  return false;
});
type Ledger = {
  on: boolean;
  readonly units: WeakSet<object>;
  reads: Read[];
};
const UNITS: ReadonlySet<string> = new Set(['transaction', 'readAt', 'writeAt', 'writeAtIn']);
function held(work: (...given: unknown[]) => unknown, ledger: Ledger) {
  return (unit: unknown, ...rest: unknown[]) => {
    const tx =
      typeof unit === 'object' && unit !== null && 'tx' in unit
        ? (
            unit as {
              tx: unknown;
            }
          ).tx
        : unit;
    if (typeof tx === 'object' && tx !== null) ledger.units.add(tx);
    return work(unit, ...rest);
  };
}
const Opening = Context.Reference<boolean>('@runlith/agent/conformance/openingCost/Opening', { defaultValue: () => false });
function rowsIn(value: unknown): number {
  return Array.isArray(value) ? value.length : value === undefined || value === null ? 0 : 1;
}
function counted<T extends object>(port: string, faces: T, ledger: Ledger): T {
  return new Proxy(faces, {
    get(target, name, receiver) {
      const member = Reflect.get(target, name, receiver);
      if (typeof member !== 'function') return member;
      return (...args: unknown[]) => {
        const answer = member.apply(target, args);
        if (!Effect.isEffect(answer)) return answer;
        return Effect.flatMap(Effect.all([Opening, publishing]), ([opening, published]) => {
          const ours = opening || args.some((arg) => typeof arg === 'object' && arg !== null && ledger.units.has(arg));
          const given =
            ours && UNITS.has(String(name))
              ? args.map((arg) => (typeof arg === 'function' ? held(arg as (...given: unknown[]) => unknown, ledger) : arg))
              : args;
          return Effect.tap(member.apply(target, given) as Effect.Effect<unknown, unknown, never>, (value) =>
            Effect.sync(() => {
              if (ours && ledger.on) ledger.reads.push({ port, call: String(name), publishing: published, rows: rowsIn(value) });
            }),
          );
        });
      };
    },
  });
}
function measured<TTx, TWrite extends TTx>(storage: ThreadStorageHarness<TTx, TWrite>, ledger: Ledger): ThreadStorageHarness<TTx, TWrite> {
  return {
    ...storage,
    aggregate: counted('store', storage.aggregate, ledger),
    eventLog: counted('journal', storage.eventLog, ledger),
    transitions: counted('transitions', storage.transitions, ledger),
    inbox: counted('inbox', storage.inbox, ledger),
    runs: (input) => counted('runs', storage.runs(input), ledger),
  };
}
const reply = (id: string, text: string) =>
  replyTurn({
    chunks: [
      { type: 'text-start', id },
      { type: 'text-delta', id, text },
      { type: 'text-end', id },
    ],
    steps: [scriptedStep({ text, messages: [Message.assistant(text)] })],
  });
function marked(turn: ScriptedTurn, ledger: Ledger, at: Read[][], requested: () => void): ScriptedTurn {
  return (input) => {
    at.push([...ledger.reads]);
    ledger.on = false;
    requested();
    return turn(input);
  };
}
const HISTORY = 'transitions.readAt';
const nameOf = (read: Read) => `${read.port}.${read.call}`;
const tally = (reads: readonly Read[]) =>
  reads.reduce<Record<string, number>>((all, read) => {
    all[nameOf(read)] = (all[nameOf(read)] ?? 0) + 1;
    return all;
  }, {});
const rowsOf = (reads: readonly Read[]) => reads.filter((read) => nameOf(read) !== HISTORY).map((read) => [nameOf(read), read.rows]);
const openingAfter = Effect.fnUntraced(
  function* <TTx, TWrite extends TTx, R>(open: ThreadStorageFactory<TTx, TWrite, R>, turns: number) {
    const ledger: Ledger = { on: false, units: new WeakSet(), reads: [] };
    const at: Read[][] = [];
    const { world, thread } = yield* openedRun(() => Effect.map(open(), (storage) => measured(storage, ledger)));
    for (let index = 0; index < turns; index += 1) {
      world.plan.push(reply(`h${index}`, `Answer ${index}.`));
      yield* pump(yield* startedTurn(world, thread.id, `Question ${index}.`));
    }
    const published: { readonly runId: string | null; readonly life: string }[] = [];
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        world.harness.reads.subscribe(thread.id, (event) => {
          if (event.type === 'state' && ledger.on)
            published.push({ runId: event.frame.state.activeRun?.id ?? null, life: event.frame.state.status.life });
        }),
      ),
      (detach) => Effect.sync(detach),
    );
    const requested = yield* Deferred.make<void>();
    world.plan.push(
      marked(reply('w', 'Woken.'), ledger, at, () => {
        Deferred.doneUnsafe(requested, Effect.void);
      }),
    );
    ledger.reads = [];
    ledger.on = true;
    const said = yield* Effect.provideService(world.harness.threads.handle(thread.id, OWNER).send('Wake up.'), Opening, true);
    if (said.status !== 'started') return yield* Effect.die(`The wake answered ${said.status} instead of opening a run.`);
    yield* Deferred.await(requested);
    yield* pump({ world, threadId: thread.id, runId: said.runId, entry: said.entry });
    const reads = (at[0] ?? []).filter((read) => !read.publishing);
    const opened = published.filter((state) => state.runId === said.runId);
    return { reads, tally: tally(reads), published: [...new Set(opened.map((state) => state.life))] };
  },
  (effect, open, turns) => effect.pipe(Effect.scoped),
);
export function describeThreadOpeningCost<TTx, TWrite extends TTx = TTx, R = never>(
  name: string,
  open: ThreadStorageFactory<TTx, TWrite, R>,
  test: Tester<Scope.Scope | R>,
): void {
  describe(`${name}: what an opening reads before its first model request`, () => {
    test(
      'a wake reads each fact as often at two history lengths, reads the history once, and publishes one state before its first request',
      Effect.fnUntraced(function* () {
        const short = yield* openingAfter(open, 1);
        const long = yield* openingAfter(open, 2);
        expect(long.tally).toEqual(short.tally);
        expect(Object.entries(long.tally).filter(([, count]) => count !== 1)).toEqual([
          ['transitions.readRecord', 2],
          ['inbox.pending', 2],
        ]);
        expect(rowsOf(long.reads)).toEqual(rowsOf(short.reads));
        expect(short.published).toHaveLength(1);
        expect(long.published).toHaveLength(1);
      }),
    );
  });
}
