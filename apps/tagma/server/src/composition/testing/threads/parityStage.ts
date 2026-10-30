import { describe, expect } from 'bun:test';
import { layer, type LayerMethods } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { eq } from 'drizzle-orm';
import { Context, Effect, type FileSystem, Layer, Semaphore, type Scope } from 'effect';
import { ProviderRegistry } from '../../../providers/contract/service/registry.js';
import { parseThreadInboxItem } from '@runlith/agent/thread/persisted';
import { coreEntry } from '@runlith/agent/transcript/kinds';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { ThreadHarness } from '../../../threads/contract/service/engine.js';
import type { HarnessFailure } from '../../../threads/contract/service/failure.js';
import { answersOf, evidenceOf, threadInbox, threadRun, turnsOf } from '../../../threads/testing/doubles.js';
import { harnessRefusal } from '../../../threads/refusals.js';
import { parityWorld, type ParityWorld, type Seat, type SeatName } from './parityWorld.js';
import { lingered, WRITTEN } from './parityModel.js';
import { until } from './terminalDeliveryRig.js';

export type Checkpoint = {
  readonly at: string;
  readonly code: string | null;
  readonly life: string;
  readonly openQuestions: number;
  readonly ending: string | null;
  readonly queued: number;
  readonly steers: number;
  readonly journal: readonly string[];
  readonly stoppedBy?: string | null;
  readonly reports?: number;
  readonly model?: string;
};

export type Expected = readonly Checkpoint[] | 'n/a';

export type Expectation = { readonly common: Expected; readonly differs?: Readonly<Partial<Record<SeatName, Expected>>> };

export type Scenario = {
  readonly name: string;
  readonly drive: (seat: Seat) => Effect.Effect<readonly Checkpoint[] | 'n/a', unknown, World | Scope.Scope>;
};

type Outcome =
  | { readonly status: string; readonly replayed?: true }
  | { readonly runId: string }
  | { readonly threadId: string }
  | string
  | boolean;
const codeOf = (value: Outcome): string => {
  if (typeof value === 'boolean') return value ? 'unqueued' : 'not-queued';
  if (typeof value === 'string') return value;
  if ('status' in value) return value.replayed === true ? `${value.status}+replayed` : value.status;
  return 'threadId' in value ? 'branched' : 'answered';
};
const JOURNAL_KINDS: ReadonlySet<string> = new Set(['signal', 'withdrawal', 'interruption', 'run-end']);
const PROVIDERS: Record<SeatName, string> = { native: 'subscription', claude: 'claude-code', devin: 'devin', terminal: 'claude-code' };

export const SEATS = ['native', 'claude', 'devin', 'terminal'] as const;

const setup = Effect.fnUntraced(function* (own: string | undefined) {
  const parity = yield* parityWorld(own);
  const serial = yield* Semaphore.make(1);
  let moves = 0;
  const owners = () => parity.world.runtime.owners;
  const turns = () => turnsOf(owners());
  const kernel = () => Context.get(owners(), ThreadHarness);
  const snapshot = (threadId: string) => evidenceOf(owners()).snapshot(threadId, parity.projectId);
  const reportsTo = Effect.fnUntraced(function* (lead: string) {
    const db = Context.get(parity.world.runtime.graph, MachineStore).db;
    const rows = yield* Context.get(parity.world.runtime.graph, MachineUnits).read((unit) =>
      unit.run(db.select().from(threadInbox()).where(eq(threadInbox().threadId, lead)).all()),
    );
    return rows.map(parseThreadInboxItem).filter((item) => item.kind === 'envelope' && item.body.intent === 'report').length;
  });
  const read = Effect.fn('testing.parityCheckpoint')(function* (
    threadId: string,
    at: string,
    code: string | null = null,
    lead?: string,
  ): Effect.fn.Return<Checkpoint, unknown> {
    const state = yield* snapshot(threadId);
    return {
      at,
      code,
      life: state.status.life,
      openQuestions: state.status.openQuestions.length,
      ending: state.status.ending?.status ?? null,
      queued: state.pendingInput.queued.length,
      steers: state.pendingInput.steers.length,
      journal: state.transcript.flatMap((entry) =>
        coreEntry(entry) && entry.type === 'message'
          ? entry.role === 'user'
            ? ['message:user']
            : []
          : JOURNAL_KINDS.has(entry.type)
            ? [entry.type]
            : [],
      ),
      stoppedBy: lead === undefined ? undefined : (state.status.ending?.stoppedBy ?? null),
      reports: lead === undefined ? undefined : yield* reportsTo(lead),
    };
  });
  const coded = (work: Effect.Effect<Outcome, HarnessFailure>) =>
    Effect.match(harnessRefusal(work), {
      onSuccess: codeOf,
      onFailure: (failure) => ('code' in failure ? String(failure.code) : String(failure._tag)),
    });
  const ended = (threadId: string) =>
    until(
      Effect.map(snapshot(threadId), (state) => (state.status.life === 'idle' && state.status.ending !== undefined ? true : null)),
      'ended its run',
    );
  const notified = (threadId: string) =>
    until(
      Effect.map(snapshot(threadId), (state) => (state.status.ending?.notification === 'confirmed' ? true : null)),
      'confirmed its end to the parent',
    );
  const opened = Effect.fn('testing.openParitySeat')(function* (seat: Seat, text = seat.opening) {
    const threadId = yield* seat.born(null);
    const code = yield* coded(turns().send(threadId, parity.projectId, text));
    yield* seat.held(threadId);
    return { threadId, first: yield* read(threadId, 'opened', code) };
  });
  const adopted = Effect.fn('testing.adoptParitySeat')(function* (seat: Seat) {
    const lead = yield* parity.lead();
    const threadId = yield* seat.born(lead, seat.opening);
    yield* seat.held(threadId);
    return { lead, threadId, first: yield* read(threadId, 'opened', 'born') };
  });
  const firstWord = (threadId: string) =>
    Effect.map(snapshot(threadId), (state) => [...state.pendingInput.steers, ...state.pendingInput.queued][0]!.id);
  const asked = Effect.fn('testing.askParitySeat')(function* (seat: Seat) {
    if (seat.asking === null) return null;
    const threadId = yield* seat.born(null);
    const code = yield* coded(turns().send(threadId, parity.projectId, seat.asking.opening));
    yield* seat.held(threadId);
    yield* seat.asking.raise(threadId);
    const questionId = yield* until(
      Effect.map(snapshot(threadId), (state) => state.status.openQuestions[0] ?? null),
      'raised its question',
    );
    return { threadId, questionId, first: yield* read(threadId, 'awaiting', code) };
  });
  const answered = Effect.fn('testing.answeredParitySeat')(function* (seat: Seat, threadId: string) {
    yield* until(
      Effect.map(snapshot(threadId), (state) => (state.status.openQuestions.length === 0 ? true : null)),
      'closed its question',
    );
    if (seat.endsOnAnswer) yield* ended(threadId);
    else
      yield* until(
        Effect.map(snapshot(threadId), (state) => (state.status.life !== 'awaiting' ? true : null)),
        'went back to work after its answer',
      );
  });
  const movable = Effect.fnUntraced(function* (seat: Seat) {
    const catalog = yield* Context.get(owners(), ProviderRegistry).catalog;
    return catalog.models
      .modelsOf(PROVIDERS[seat.name])
      .filter((option) => option.operatorOnly !== true)
      .map((option) => option.id);
  });
  const ownedAgain = (threadId: string, runId: string, life: string) =>
    until(
      Effect.map(snapshot(threadId), ({ status }) =>
        status.runId === runId && status.ownership === 'held' && status.life === life ? true : null,
      ),
      'held the run under a live owner',
    );
  const runOf = (threadId: string) => Effect.map(snapshot(threadId), (state) => state.status.runId!);
  const phaseOf = Effect.fnUntraced(function* (threadId: string) {
    const db = Context.get(parity.world.runtime.graph, MachineStore).db;
    const rows = yield* Context.get(parity.world.runtime.graph, MachineUnits).read((unit) =>
      unit.run(
        db
          .select({ progress: threadRun().progress, status: threadRun().status })
          .from(threadRun())
          .where(eq(threadRun().threadId, threadId))
          .all(),
      ),
    );
    return rows.find((row) => row.status === 'running')?.progress.phase ?? null;
  });
  const answering = Effect.fn('testing.answerParitySeat')(function* (seat: Seat, threadId: string, questionId: string) {
    const code = yield* coded(answersOf(owners()).answer(threadId, parity.projectId, { questionId, answers: seat.answers(questionId) }));
    yield* answered(seat, threadId);
    return yield* read(threadId, 'answered', code);
  });
  const finished = Effect.fn('testing.finishParitySeat')(function* (seat: Seat) {
    const raised = yield* asked(seat);
    if (raised === null) return yield* Effect.die(new Error(`the ${seat.name} seat cannot finish a turn with a message`));
    yield* answering(seat, raised.threadId, raised.questionId);
    return raised.threadId;
  });
  return {
    parity,
    serial,
    owners,
    turns,
    kernel,
    snapshot,
    read,
    coded,
    ended,
    notified,
    opened,
    adopted,
    firstWord,
    asked,
    answered,
    answering,
    movable,
    finished,
    ownedAgain,
    runOf,
    phaseOf,
    nextMove: () => ++moves,
  };
});
export class World extends Context.Service<World, Effect.Success<ReturnType<typeof setup>>>()('testing/ParityWorld') {}

export const cp = (at: string, code: string | null, over: Partial<Checkpoint> = {}): Checkpoint => ({
  at,
  code,
  life: 'working',
  openQuestions: 0,
  ending: null,
  queued: 0,
  steers: 0,
  journal: ['message:user'],
  ...over,
});

export const OPENED = cp('opened', 'started');
export const BORN = cp('opened', 'born', { journal: ['signal'] });
export const TASKED_ENDED = ['signal', 'run-end'];
export const STOPPED = { life: 'idle', ending: 'aborted' } as const;
export const AWAITING = cp('awaiting', 'started', { life: 'awaiting', openQuestions: 1 });

export const describeParity = (title: string, body: (it: LayerMethods<World | FileSystem.FileSystem>) => void, own?: string): void =>
  describe(title, () => {
    layer(Layer.effect(World, setup(own)).pipe(Layer.provideMerge(BunFileSystem.layer)), {
      excludeTestServices: true,
    })('transport world', body);
  });

export const ROADS = ['native', 'claude'] as const;

export const runnerOpened = Effect.fnUntraced(function* (parity: ParityWorld, road: (typeof ROADS)[number], threadId: string) {
  if (road !== 'claude') return;
  yield* parity.seats.claude.held(threadId);
  yield* Context.get(parity.world.runtime.owners, ThreadHarness).runs.hosting().open(threadId, 'tagma');
  yield* parity.release(threadId);
});

export const scribbled = Effect.fn('testing.parityScribbled')(function* (ending: 'Esc' | 'a dead agent process' | 'a crashed server') {
  const { parity, serial, turns, ended, snapshot, kernel } = yield* World;
  yield* serial.withPermit(
    Effect.gen(function* () {
      const seen: Record<string, unknown> = {};
      const threads: Record<string, string> = {};
      for (const road of ROADS) {
        if (ending === 'a dead agent process' && road === 'native') continue;
        const threadId = yield* parity.seats[road].born(null);
        threads[road] = threadId;
        yield* turns().send(threadId, parity.projectId, 'SCRIBBLE the answer.');
        yield* runnerOpened(parity, road, threadId);
        const open = yield* until(
          Effect.sync(() => {
            const entry = kernel()
              .reads.openView(threadId)
              .open.find((one) => coreEntry(one) && one.type === 'tool');
            return entry !== undefined &&
              coreEntry(entry) &&
              entry.type === 'tool' &&
              entry.toolInputRaw?.kind === 'text' &&
              entry.toolInputRaw.text === WRITTEN.join('')
              ? entry
              : null;
          }),
          'showed the written input',
        );
        seen[road] = { state: open.toolState, title: open.toolDisplay?.title ?? null };
      }
      if (ending === 'a crashed server') {
        yield* parity.handover(false);
        yield* kernel().runs.recoverNow();
      }
      for (const [road, threadId] of Object.entries(threads)) {
        if (ending === 'a dead agent process') yield* parity.seats.claude.die(threadId);
        else {
          yield* until(
            Effect.map(snapshot(threadId), ({ status }) => (status.ownership === 'held' ? true : null)),
            'held the run',
          );
          yield* turns().stop(threadId, parity.projectId);
        }
        yield* ended(threadId);
        const landed = (yield* snapshot(threadId)).transcript.filter(
          (entry) => coreEntry(entry) && entry.type === 'tool' && entry.toolCallId === 'written-call',
        );
        seen[`${road}:landed`] = landed.map((entry) =>
          coreEntry(entry) && entry.type === 'tool'
            ? { state: entry.toolState, raw: entry.toolInputRaw?.kind === 'text' ? entry.toolInputRaw.text : null }
            : null,
        );
      }
      if (seen.native !== undefined) expect(seen.claude).toEqual(seen.native);
      expect(seen['claude:landed']).toEqual([{ state: 'input-interrupted', raw: WRITTEN.join('') }]);
      if (seen.native !== undefined) expect(seen['native:landed']).toEqual(seen['claude:landed']);
    }).pipe(Effect.ensuring(parity.quiet().pipe(Effect.orDie))),
  );
});

export const AFTER_STOP = [
  { code: 'started', lines: ['Interrupted by user'], partial: true },
  { code: 'queued', lines: ['Interrupted by user'], partial: true },
  { code: 'steered', lines: ['Interrupted to deliver 1 steer'], partial: true },
];

export const stoppingSteer = Effect.fn('testing.parityStoppingSteer')(function* (name: 'native' | 'claude', crashed: boolean) {
  const { parity, turns, snapshot, coded, kernel } = yield* World;
  const threadId = yield* parity.seats[name].born(null);
  yield* turns().send(threadId, parity.projectId, 'STREAM LINGER the answer.');
  const stopped = yield* until(
    Effect.map(snapshot(threadId), (state) =>
      state.live.open.some((entry) => coreEntry(entry) && entry.type === 'message' && entry.text.includes('Partial'))
        ? state.status.runId
        : null,
    ),
    'streamed its open text',
  );
  if (!crashed) {
    const db = Context.get(parity.world.runtime.graph, MachineStore).db;
    yield* until(
      Effect.map(
        Context.get(parity.world.runtime.graph, MachineUnits).read((unit) =>
          unit.run(db.select({ tail: threadRun().streamTail }).from(threadRun()).where(eq(threadRun().id, stopped)).get()),
        ),
        (row) => (row?.tail?.some((entry) => coreEntry(entry) && entry.type === 'message' && entry.text === 'Partial') ? true : null),
      ),
      'kept its open text as the tail of the run',
    );
  }
  yield* turns().stop(threadId, parity.projectId);
  if (crashed) yield* parity.handover(false);
  const code = yield* coded(turns().send(threadId, parity.projectId, 'STREAM the other table.'));
  if (crashed) yield* kernel().runs.recoverNow();
  if (name === 'claude') yield* parity.release(threadId);
  else lingered();
  const next = yield* until(
    Effect.map(snapshot(threadId), (state) =>
      state.status.runId !== null &&
      state.status.runId !== stopped &&
      state.live.open.some((entry) => coreEntry(entry) && entry.type === 'message' && entry.text.includes('Partial')) &&
      state.transcript.some(
        (entry) =>
          coreEntry(entry) &&
          (entry.type === 'signal' || (entry.type === 'message' && entry.role === 'user')) &&
          entry.text.includes('STREAM the other table.'),
      )
        ? state
        : null,
    ),
    'answered the words in the next run',
  );
  yield* turns().stop(threadId, parity.projectId);
  return {
    code,
    lines: next.transcript.flatMap((entry) => (coreEntry(entry) && entry.type === 'interruption' ? [entry.text] : [])),
    partial: next.transcript.some(
      (entry) =>
        coreEntry(entry) && entry.type === 'message' && entry.role === 'assistant' && entry.runId === stopped && entry.text === 'Partial',
    ),
  };
});

export const describeSeats = (title: string, scenarios: readonly Scenario[], expected: Readonly<Record<string, Expectation>>): void =>
  describeParity(title, (it) => {
    for (const name of SEATS) {
      describe(name, () => {
        for (const scenario of scenarios) {
          it.effect(scenario.name, () =>
            Effect.gen(function* () {
              const { parity, serial } = yield* World;
              const expectation = expected[scenario.name]!;
              yield* serial.withPermit(
                Effect.gen(function* () {
                  expect(yield* scenario.drive(parity.seats[name])).toEqual(expectation.differs?.[name] ?? expectation.common);
                }).pipe(Effect.ensuring(parity.quiet().pipe(Effect.orDie))),
              );
            }),
          );
        }
      });
    }
  });
