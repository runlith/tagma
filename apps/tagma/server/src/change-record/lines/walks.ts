import { availableParallelism } from 'node:os';
import { Clock, Data, Effect, Exit, type Tracer } from 'effect';
import { eventReason, workerGone } from '@runlith/utils/worker';
import type { LineHunk } from '@runlith/files/hunk';
import type { FoldInput } from './fold.js';
import { payloadOf, type FoldPayload, type FoldHandle, type FoldRecall, type JudgedFold, type ResidentFold } from './residence.js';
import { foldMemoryBudget } from './memory.js';
import { WorkLanes, type Lane } from './lanes.js';
import { unpackVerdict } from './packed.js';
import { contentFrom, contentOf, type Content, type PreparedBytes, type PreparedText, type TextContent } from './folding.js';
import type { BaseAlignment } from './projection.js';
import type { ReleasedSpan } from './released.js';
import type { DebtWindow } from './owed.js';
import type { DependencyAnswer, DependencyInput, DependencyProbe, ImportProbe, PlacementInput } from '../prepared/dependencyWalk.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { Authoring, Placed } from '../threadFiles/authored.js';
import type { LineTally, Tallied } from './tally.js';

export type Version = { readonly text: string } | { readonly bytes: Uint8Array } | { readonly file: string; readonly digest: string };

export type HunkPair = { readonly before: Version | null; readonly after: Version | null; readonly normalized: boolean };

export type Hunked = {
  readonly rewritten: boolean;
  readonly before: string | null;
  readonly after: string | null;
  readonly beforeDigest: string | null;
  readonly afterDigest: string | null;
  readonly hunk: LineHunk | null;
};

export type WalkQuestion =
  | {
      readonly kind: 'fold';
      readonly input: FoldPayload;
      readonly cached: FoldHandle | undefined;
      readonly alignment: BaseAlignment | undefined;
      readonly memory: number;
      readonly selected: ReadonlySet<string> | undefined;
    }
  | { readonly kind: 'text'; readonly text: string; readonly digest: string | undefined }
  | { readonly kind: 'bytes'; readonly bytes: Uint8Array }
  | { readonly kind: 'authored'; readonly authoring: Authoring }
  | { readonly kind: 'hunks'; readonly pairs: readonly HunkPair[] }
  | { readonly kind: 'digests'; readonly contents: readonly Uint8Array[] }
  | { readonly kind: 'tallies'; readonly rows: readonly Tallied[] }
  | { readonly kind: 'spans'; readonly hunks: readonly LineHunk[] }
  | { readonly kind: 'windows'; readonly before: string; readonly after: string }
  | { readonly kind: 'dependencies'; readonly input: DependencyInput }
  | { readonly kind: 'dependencyImports'; readonly input: DependencyProbe }
  | { readonly kind: 'placements'; readonly input: PlacementInput };

export type WalkAsk = { readonly id: number } & WalkQuestion;

export type WalkAnswer = { readonly id: number } & (
  | { readonly kind: 'fold'; readonly answer: ResidentFold }
  | { readonly kind: 'text'; readonly answer: PreparedText }
  | { readonly kind: 'bytes'; readonly answer: PreparedBytes }
  | { readonly kind: 'authored'; readonly answer: Placed }
  | { readonly kind: 'hunks'; readonly answer: readonly Hunked[] }
  | { readonly kind: 'digests'; readonly answer: readonly string[] }
  | { readonly kind: 'tallies'; readonly answer: readonly (LineTally | null)[] }
  | { readonly kind: 'spans'; readonly answer: readonly ReleasedSpan[] }
  | { readonly kind: 'windows'; readonly answer: readonly DebtWindow[] | null }
  | { readonly kind: 'dependencies'; readonly answer: DependencyAnswer }
  | { readonly kind: 'dependencyImports'; readonly answer: ImportProbe }
  | { readonly kind: 'placements'; readonly answer: readonly string[] }
  | { readonly kind: 'failed'; readonly reason: string }
);

type Answered<K extends WalkQuestion['kind']> = Extract<WalkAnswer, { readonly kind: K }>['answer'];

export class WalkUnfinished extends Data.TaggedError('WalkUnfinished')<{ readonly reason: string }> {}

export const walkCut = (path: string, unfinished: WalkUnfinished, ...ways: readonly string[]): GateRefusal<'walk-cut'> =>
  new GateRefusal('walk-cut', `the line walk over ${path} was cut before it answered: ${unfinished.reason}`, [
    'for a source or configuration error, correct its reported cause before retrying; retry a transient worker failure only after its cause clears',
    ...ways,
  ]);

type Queued = {
  readonly ask: WalkAsk;
  readonly preferred: Worker | undefined;
  readonly started: (worker: number) => void;
  readonly answer: (answer: WalkAnswer) => void;
};

type Running = { readonly queued: Queued; readonly lane: Lane; readonly bound: ReturnType<typeof setTimeout> };

const WALL_MS = 30_000;

const poolSize = (): number => Math.min(3, Math.max(1, Math.floor(availableParallelism() / 4)));

export type Walks = ReturnType<typeof makeWalks>;

export const makeWalks = ({
  size = poolSize(),
  wall = WALL_MS,
  memory = foldMemoryBudget(),
}: { readonly size?: number; readonly wall?: number; readonly memory?: number } = {}) => {
  const idle: Worker[] = [];
  const alive = new Set<Worker>();
  const identities = new WeakMap<Worker, number>();
  const routes = new WeakMap<FoldRecall, Worker>();
  const retained = new Map<Worker, number>();
  let workers = 0;
  const running = new Map<Worker, Running>();
  const lanes = new WorkLanes<Queued>((one) =>
    one.preferred !== undefined && alive.has(one.preferred) ? idle.includes(one.preferred) : idle.length > 0 || running.size < size,
  );
  const backgroundWidth = Math.max(1, size - 1);
  let asked = 0;
  let closed = false;

  const failed = (thread: Worker, reason: string): void => {
    if (!alive.delete(thread)) return;
    retained.delete(thread);
    const reported = closed ? reason : workerGone('walk worker', reason).message;
    const run = running.get(thread);
    running.delete(thread);
    const at = idle.indexOf(thread);
    if (at >= 0) idle.splice(at, 1);
    thread.terminate();
    if (run === undefined) return;
    clearTimeout(run.bound);
    run.queued.answer({ id: run.queued.ask.id, kind: 'failed', reason: reported });
    if (!closed) dispatch();
  };

  const answered = (thread: Worker, answer: WalkAnswer): void => {
    const run = running.get(thread);
    if (run === undefined || run.queued.ask.id !== answer.id) return;
    clearTimeout(run.bound);
    running.delete(thread);
    if (answer.kind === 'fold') {
      retained.set(thread, answer.answer.retained);
      if (answer.answer.record !== null) routes.set(answer.answer.record, thread);
    }
    thread.unref();
    idle.push(thread);
    run.queued.answer(answer);
    dispatch();
  };

  const started = (): Worker | undefined => {
    let thread: Worker;
    try {
      thread = new Worker(new URL('./walk.worker.ts', import.meta.url), { type: 'module' });
    } catch (cause) {
      const gone = workerGone('walk worker', `it could not start: ${String(cause)}`);
      const queued = lanes.drain();
      for (const one of queued) one.answer({ id: one.ask.id, kind: 'failed', reason: gone.message });
      return undefined;
    }
    alive.add(thread);
    identities.set(thread, ++workers);
    thread.addEventListener('message', (event: MessageEvent<WalkAnswer>) => answered(thread, event.data));
    thread.addEventListener('error', (event: ErrorEvent) => failed(thread, eventReason(event, 'a walk worker failed')));
    thread.addEventListener('messageerror', () => failed(thread, 'a walk answer could not be read'));
    thread.addEventListener('close', () => failed(thread, 'a walk worker closed'));
    return thread;
  };

  const behind = (): number => {
    let count = 0;
    for (const run of running.values()) if (run.lane === 'later') count += 1;
    return count;
  };

  const dispatch = (): void => {
    for (;;) {
      const ready = lanes.first(behind() < backgroundWidth);
      if (ready === undefined) return;
      const { lane, value: one } = ready;
      const preferred = one.preferred === undefined ? -1 : idle.indexOf(one.preferred);
      const thread = preferred >= 0 ? idle.splice(preferred, 1)[0] : (idle.pop() ?? (running.size < size ? started() : undefined));
      if (thread === undefined) return;
      lanes.remove(one);
      const bound = setTimeout(() => failed(thread, `the walk ran past its ${wall} ms wall bound`), wall);
      running.set(thread, { queued: one, lane, bound });
      thread.ref();
      one.started(identities.get(thread)!);
      try {
        thread.postMessage(one.ask);
      } catch (cause) {
        failed(thread, `it took no ask: ${String(cause)}`);
        return;
      }
    }
  };

  const queued = Effect.fnUntraced(function* (question: WalkQuestion, lane: Lane, preferred: Worker | undefined) {
    const clock = yield* Clock.clockWith(Effect.succeed);
    const tracer = yield* Effect.tracer;
    return yield* Effect.acquireUseRelease(
      Effect.makeSpan('Walks.queue', { attributes: { kind: question.kind, lane } }),
      (queue) =>
        Effect.callback<WalkAnswer, WalkUnfinished>((resume) => {
          const id = ++asked;
          let worker: Tracer.Span | undefined;
          const one: Queued = {
            ask: { id, ...question } as WalkAsk,
            preferred,
            started: (identity) => {
              const now = clock.currentTimeNanosUnsafe();
              queue.end(now, Exit.void);
              worker = tracer.span({
                name: 'Walks.worker',
                parent: queue.parent,
                annotations: queue.annotations,
                links: [],
                startTime: now,
                kind: 'internal',
                root: false,
                sampled: queue.sampled,
              });
              worker.attribute('worker', identity);
              worker.attribute('kind', question.kind);
              worker.attribute('lane', lane);
            },
            answer: (value) => {
              const span = worker ?? queue;
              if (value.kind === 'failed') {
                const failure = new WalkUnfinished({ reason: value.reason });
                span.end(clock.currentTimeNanosUnsafe(), Exit.fail(failure));
                resume(Effect.fail(failure));
              } else {
                if (value.kind === 'dependencies') span.attribute('dependency.parses', value.answer.parses);
                if (value.kind === 'dependencyImports') {
                  span.attribute('dependency.importReads', value.answer.reads);
                  span.attribute('dependency.importMs', value.answer.importMs);
                }
                span.end(clock.currentTimeNanosUnsafe(), Exit.succeed(value));
                resume(Effect.succeed(value));
              }
            },
          };
          if (closed) {
            one.answer({ id, kind: 'failed', reason: 'the walk workers closed with the server' });
            return;
          }
          lanes.offer(lane, one);
          dispatch();
          return Effect.sync(() => {
            lanes.remove(one);
          });
        }),
      (queue, exit) =>
        Effect.sync(() => {
          if (queue.status._tag === 'Started') queue.end(clock.currentTimeNanosUnsafe(), exit);
        }),
    );
  });

  const ask = <K extends WalkQuestion['kind']>(
    question: Extract<WalkQuestion, { readonly kind: K }>,
    lane: Lane,
    preferred?: Worker,
  ): Effect.Effect<Answered<K>, WalkUnfinished> =>
    Effect.flatMap(queued(question, lane, preferred), (answer) =>
      answer.kind === question.kind
        ? Effect.succeed(answer.answer as Answered<K>)
        : Effect.fail(new WalkUnfinished({ reason: answer.kind === 'failed' ? answer.reason : `the walk answered ${answer.kind}` })),
    );

  const fold = Effect.fnUntraced(function* (
    input: FoldInput,
    cached?: FoldRecall,
    alignment?: BaseAlignment,
    lane: Lane = 'now',
    selected?: ReadonlySet<string>,
  ): Effect.fn.Return<JudgedFold, WalkUnfinished> {
    const payload = yield* Effect.sync(() => payloadOf(input)).pipe(
      Effect.withSpan('Walks.inputs', { attributes: { rows: input.rows.length } }),
    );
    const handle = cached === undefined ? undefined : { token: cached.token, revision: cached.revision };
    const answer = yield* ask(
      { kind: 'fold', input: payload, cached: handle, alignment, memory: Math.floor(memory / size), selected },
      lane,
      cached === undefined ? undefined : routes.get(cached),
    );
    return { ...answer, result: unpackVerdict(answer.packed) };
  });

  return {
    get retained(): number {
      return [...retained.values()].reduce((sum, bytes) => sum + bytes, 0);
    },
    limit: Math.floor(memory / size) * size,
    fold,
    restore: (input: FoldInput, selected: ReadonlySet<string>, lane: Lane) => fold(input, undefined, undefined, lane, selected),
    authored: (authoring: Authoring) => ask({ kind: 'authored', authoring }, 'now'),
    hunks: (pairs: readonly HunkPair[]) => ask({ kind: 'hunks', pairs }, 'later'),
    digests: (contents: readonly Uint8Array[], lane: Lane = 'later') => ask({ kind: 'digests', contents }, lane),
    tallies: (rows: readonly Tallied[]) => ask({ kind: 'tallies', rows }, 'later'),
    spans: (hunks: readonly LineHunk[]) => ask({ kind: 'spans', hunks }, 'later'),
    windows: (before: string, after: string) => ask({ kind: 'windows', before, after }, 'later'),
    dependencies: (input: DependencyInput) => ask({ kind: 'dependencies', input }, 'now'),
    dependencyImports: (input: DependencyProbe) => ask({ kind: 'dependencyImports', input }, 'now'),
    placements: (input: PlacementInput) => ask({ kind: 'placements', input }, 'now'),

    content: (text: string | null, digest?: string, lane: Lane = 'now'): Effect.Effect<TextContent, WalkUnfinished> =>
      text === null
        ? Effect.succeed(contentOf(null))
        : ask({ kind: 'text', text, digest }, lane).pipe(Effect.map((prepared) => contentFrom(text, prepared))),
    file: (bytes: Uint8Array, blob: string | undefined, lane: Lane): Effect.Effect<Content, WalkUnfinished> =>
      ask({ kind: 'bytes', bytes }, lane).pipe(
        Effect.map((prepared): Content => (prepared.kind === 'text' ? contentFrom(prepared.text, prepared, blob) : prepared)),
      ),
    close: Effect.sync(() => {
      closed = true;
      retained.clear();
      const queued = lanes.drain();
      for (const one of queued) one.answer({ id: one.ask.id, kind: 'failed', reason: 'the walk workers closed with the server' });
      for (const thread of [...running.keys()]) failed(thread, 'the walk workers closed with the server');
      for (const thread of idle.splice(0)) {
        alive.delete(thread);
        thread.terminate();
      }
    }),
  };
};
