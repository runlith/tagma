import { availableParallelism } from 'node:os';
import { Clock, Data, Effect, Exit, type Tracer } from 'effect';
import { eventReason, workerGone } from '@runlith/utils/worker';
import type { LineHunk } from '@runlith/files/hunk';
import { foldWork, type FoldInput, type Folded } from './fold.js';
import {
  contentFrom,
  contentOf,
  type CachedFold,
  type Content,
  type PreparedBytes,
  type PreparedText,
  type TextContent,
} from './folding.js';
import type { BaseAlignment } from './projection.js';
import type { FoldJob, FoldResponse } from './jobs.js';
import type { ReleasedSpan } from './released.js';
import type { DebtWindow } from './owed.js';
import type { DependencyAnswer, DependencyInput, DependencyProbe, ImportProbe } from '../prepared/dependencyWalk.js';
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
  | { readonly kind: 'fold'; readonly job: FoldJob; readonly limit: number }
  | { readonly kind: 'text'; readonly text: string; readonly digest: string | undefined }
  | { readonly kind: 'bytes'; readonly bytes: Uint8Array }
  | { readonly kind: 'authored'; readonly authoring: Authoring }
  | { readonly kind: 'hunks'; readonly pairs: readonly HunkPair[] }
  | { readonly kind: 'digests'; readonly contents: readonly Uint8Array[] }
  | { readonly kind: 'tallies'; readonly rows: readonly Tallied[] }
  | { readonly kind: 'spans'; readonly hunks: readonly LineHunk[] }
  | { readonly kind: 'windows'; readonly before: string; readonly after: string }
  | { readonly kind: 'dependencies'; readonly input: DependencyInput }
  | { readonly kind: 'dependencyImports'; readonly input: DependencyProbe };

export type WalkAsk = { readonly id: number } & WalkQuestion;

export type WalkAnswer = { readonly id: number } & (
  | { readonly kind: 'fold'; readonly answer: FoldResponse }
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
  | { readonly kind: 'failed'; readonly reason: string }
);

type Answered<K extends WalkQuestion['kind']> = Extract<WalkAnswer, { readonly kind: K }>['answer'];

export class WalkUnfinished extends Data.TaggedError('WalkUnfinished')<{ readonly reason: string }> {}

export const walkCut = (path: string, unfinished: WalkUnfinished, ...ways: readonly string[]): GateRefusal<'walk-cut'> =>
  new GateRefusal('walk-cut', `the line walk over ${path} was cut before it answered: ${unfinished.reason}`, [
    'ask again: a walk cut on a busy server finishes once the walk workers are free',
    ...ways,
  ]);

export type Lane = 'now' | 'later';

type Queued = { readonly ask: WalkAsk; readonly started: (worker: number) => void; readonly answer: (answer: WalkAnswer) => void };

type Running = { readonly queued: Queued; readonly lane: Lane; readonly bound: ReturnType<typeof setTimeout> };

const WALL_MS = 30_000;

const poolSize = (): number => Math.min(3, Math.max(1, Math.floor(availableParallelism() / 4)));

export type Walks = ReturnType<typeof makeWalks>;

export const makeWalks = ({ size = poolSize(), wall = WALL_MS }: { readonly size?: number; readonly wall?: number } = {}) => {
  const idle: Worker[] = [];
  const alive = new Set<Worker>();
  const identities = new WeakMap<Worker, number>();
  let workers = 0;
  const running = new Map<Worker, Running>();
  const lanes: Record<Lane, Queued[]> = { now: [], later: [] };
  const backgroundWidth = Math.max(1, size - 1);
  let asked = 0;
  let closed = false;

  const failed = (thread: Worker, reason: string): void => {
    if (!alive.delete(thread)) return;
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
      const queued = [...lanes.now.splice(0), ...lanes.later.splice(0)];
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
      const lane: Lane | undefined =
        lanes.now.length > 0 ? 'now' : lanes.later.length > 0 && behind() < backgroundWidth ? 'later' : undefined;
      if (lane === undefined) return;
      const thread = idle.pop() ?? (running.size < size ? started() : undefined);
      if (thread === undefined) return;
      const one = lanes[lane].shift() as Queued;
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

  const queued = Effect.fnUntraced(function* (question: WalkQuestion, lane: Lane) {
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
          lanes[lane].push(one);
          dispatch();
          return Effect.sync(() => {
            const waiting = lanes[lane].indexOf(one);
            if (waiting >= 0) lanes[lane].splice(waiting, 1);
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
  ): Effect.Effect<Answered<K>, WalkUnfinished> =>
    Effect.flatMap(queued(question, lane), (answer) =>
      answer.kind === question.kind
        ? Effect.succeed(answer.answer as Answered<K>)
        : Effect.fail(new WalkUnfinished({ reason: answer.kind === 'failed' ? answer.reason : `the walk answered ${answer.kind}` })),
    );

  return {
    authored: (authoring: Authoring) => ask({ kind: 'authored', authoring }, 'now'),
    hunks: (pairs: readonly HunkPair[]) => ask({ kind: 'hunks', pairs }, 'later'),
    digests: (contents: readonly Uint8Array[], lane: Lane = 'later') => ask({ kind: 'digests', contents }, lane),
    tallies: (rows: readonly Tallied[]) => ask({ kind: 'tallies', rows }, 'later'),
    spans: (hunks: readonly LineHunk[]) => ask({ kind: 'spans', hunks }, 'later'),
    windows: (before: string, after: string) => ask({ kind: 'windows', before, after }, 'later'),
    dependencies: (input: DependencyInput) => ask({ kind: 'dependencies', input }, 'now'),
    dependencyImports: (input: DependencyProbe) => ask({ kind: 'dependencyImports', input }, 'now'),
    fold: Effect.fnUntraced(function* (
      input: FoldInput,
      cached?: CachedFold,
      alignment?: BaseAlignment,
      lane: Lane = 'now',
    ): Effect.fn.Return<Folded, WalkUnfinished> {
      let left = 1 << 23;
      const budget = { expired: (amount: number) => (left -= amount) < 0 };
      const work = foldWork(input, budget, cached, alignment);
      let next = work.next();
      while (!next.done) {
        const response = yield* ask({ kind: 'fold', job: next.value, limit: Math.max(0, left) }, lane);
        budget.expired(response.used);
        next = work.next(response.answer);
      }
      return next.value;
    }),
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
      const queued = [...lanes.now, ...lanes.later];
      lanes.now = [];
      lanes.later = [];
      for (const one of queued) one.answer({ id: one.ask.id, kind: 'failed', reason: 'the walk workers closed with the server' });
      for (const thread of [...running.keys()]) failed(thread, 'the walk workers closed with the server');
      for (const thread of idle.splice(0)) {
        alive.delete(thread);
        thread.terminate();
      }
    }),
  };
};
