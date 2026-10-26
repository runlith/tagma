import { join } from 'node:path';
import { Cause, Data, Deferred, Duration, Effect, Exit, Latch, Scope, type Semaphore } from 'effect';
import type { Spawner, Worker, WorkerPlatform } from 'effect/workers/Worker';
import { WorkerUnavailable, workerGone } from '@runlith/utils/worker';
import type { ActivityBodied } from '../fact';
import type { BodyForm, BodySlot, BodyStored, Lost, Writer } from './writer';

export type BodyRequest =
  | {
      readonly _tag: 'Write';
      readonly key: string;
      readonly path: string;
      readonly bucket: string;
      readonly chain: string | null;
      readonly ceiling: number;
      readonly encoded: Uint8Array;
      readonly contentType: string;
    }
  | {
      readonly _tag: 'Read';
      readonly key: string;
      readonly files: readonly string[];
      readonly chained: boolean;
      readonly bytes: number;
      readonly from: number;
    }
  | { readonly _tag: 'Remove'; readonly key: string; readonly bucket: string; readonly path: string }
  | { readonly _tag: 'Discard'; readonly key: string; readonly links: readonly BodyLink[]; readonly root: string }
  | { readonly _tag: 'Inventory'; readonly key: string; readonly root: string; readonly oldest: string };

export type BodyReply =
  | {
      readonly _tag: 'Written';
      readonly key: string;
      readonly bytes: number;
      readonly size: number;
      readonly form: BodyForm;
      readonly base: string | null;
    }
  | { readonly _tag: 'Declined'; readonly key: string; readonly bytes: number }
  | { readonly _tag: 'Failed'; readonly key: string; readonly reason: string }
  | { readonly _tag: 'Read'; readonly key: string; readonly text: string; readonly from: number; readonly bytes: number }
  | { readonly _tag: 'Removed'; readonly key: string }
  | { readonly _tag: 'Inventory'; readonly key: string; readonly buckets: readonly BodyBucket[] };

export type BodyLink = { readonly id: string; readonly bucket: string };
export type BodyBucket = { readonly bucket: string; readonly bytes: number; readonly bodies: number };

export class BodyUnreadable extends Data.TaggedError('BodyUnreadable')<{ readonly reason: string }> {}

const SLOTS = 256;
const RESPAWN = Duration.seconds(1);

type Offered = { readonly fact: ActivityBodied; readonly slot: BodySlot };

export class Bodies {
  private readonly queue: Offered[] = [];
  private queuedBytes = 0;
  private readonly replies = new Map<string, Deferred.Deferred<BodyReply, WorkerUnavailable>>();
  private failure: WorkerUnavailable | undefined;
  private trip: Deferred.Deferred<void> | undefined;
  private worker: Worker<BodyReply, BodyRequest> | null = null;
  private asked = 0;
  private flying: Offered | null = null;
  private closed = false;
  private readonly starting = Latch.makeUnsafe(false);
  readonly ready = this.starting.await;

  constructor(
    private readonly root: string,
    private readonly writer: Writer,
    private readonly arriving: Latch.Latch,
    private readonly idle: Latch.Latch,
    private readonly ceiling: () => number,
    private readonly queueBytes: number,
    private readonly lane: Semaphore.Semaphore,
  ) {}

  offer(fact: ActivityBodied): void {
    const size = fact.body.encoded.byteLength;
    if (this.closed || this.queue.length >= SLOTS || (size <= this.ceiling() && this.queuedBytes + size > this.queueBytes)) {
      this.writer.push({
        _tag: 'Lost',
        cause: this.closed ? 'unwritten' : 'body-queue-full',
        at: fact.at,
        facts: 0,
        bodies: 1,
        bytes: size,
      });
      return;
    }
    const slot = this.writer.reserveBody();
    if (slot === null) {
      this.writer.push({ _tag: 'Lost', cause: 'body-metadata-full', at: fact.at, facts: 0, bodies: 1, bytes: size });
      return;
    }
    if (size > this.ceiling()) {
      slot.commit(storedOf(fact, 'declined', size));
      return;
    }
    this.queue.push({ fact, slot });
    this.queuedBytes += size;
    this.idle.closeUnsafe();
    this.arriving.openUnsafe();
  }

  readonly settled: Effect.Effect<void> = Effect.suspend(() => this.idle.await);

  close(): void {
    this.closed = true;
  }

  stop(): Lost {
    const lost = this.abandoned();
    this.worker = null;
    const gone = new WorkerUnavailable('activity body worker', 'the body store closed at its deadline');
    for (const waiting of this.replies.values()) Deferred.doneUnsafe(waiting, Exit.fail(gone));
    this.replies.clear();
    this.idle.openUnsafe();
    return lost;
  }

  abandoned(): Lost {
    this.closed = true;
    const left = this.flying === null ? this.queue.splice(0) : [this.flying, ...this.queue.splice(0)];
    this.flying = null;
    for (const offered of left) offered.slot.cancel();
    const bytes = left.reduce((sum, offered) => sum + offered.fact.body.encoded.byteLength, 0);
    this.queuedBytes = 0;
    return { _tag: 'Lost', cause: 'unwritten', at: left[0]?.fact.at ?? 0, facts: 0, bodies: left.length, bytes };
  }

  serve(platform: WorkerPlatform['Service'], prepared?: Worker<BodyReply, BodyRequest>): Effect.Effect<never, never, Spawner> {
    let spare = prepared;
    return Effect.forever(
      Effect.exit(
        Effect.scoped(
          Effect.suspend(() => {
            const first = spare;
            spare = undefined;
            return this.run(platform, first);
          }),
        ),
      ).pipe(
        Effect.flatMap((exit) =>
          Effect.sync(() => this.lost(Exit.isFailure(exit) ? Cause.pretty(exit.cause) : 'The body worker stopped.')),
        ),
        Effect.andThen(Effect.sleep(RESPAWN)),
      ),
    );
  }

  private readonly run = Effect.fnUntraced(function* (
    this: Bodies,
    platform: WorkerPlatform['Service'],
    prepared: Worker<BodyReply, BodyRequest> | undefined,
  ) {
    this.failure = undefined;
    const trip = (this.trip = Deferred.makeUnsafe<void>());
    const worker = prepared ?? (yield* platform.spawn<BodyReply, BodyRequest>(0));
    this.worker = worker;
    this.starting.openUnsafe();
    return yield* worker.run((reply) => Effect.sync(() => this.receive(reply))).pipe(Effect.raceFirst(Deferred.await(trip)));
  });

  loop(): Effect.Effect<never> {
    return Effect.forever(this.drained());
  }

  private readonly drained = Effect.fnUntraced(function* (this: Bodies) {
    yield* this.arriving.await;
    this.arriving.closeUnsafe();
    for (let offered = this.queue.shift(); offered !== undefined; offered = this.queue.shift()) {
      const held = offered;
      this.queuedBytes -= held.fact.body.encoded.byteLength;
      this.flying = held;
      yield* this.lane.withPermit(this.commit(held));
    }
    this.idle.openUnsafe();
  });

  private readonly commit = Effect.fnUntraced(function* (this: Bodies, held: Offered) {
    const stored = yield* this.write(held.fact);
    if (this.flying !== held) return;
    held.slot.commit(stored);
    this.flying = null;
  });

  read(
    links: readonly BodyLink[],
    chained: boolean,
    bytes: number,
    from: number,
  ): Effect.Effect<{ readonly text: string; readonly from: number; readonly bytes: number }, BodyUnreadable | WorkerUnavailable> {
    return Effect.flatMap(
      this.ask({ _tag: 'Read', key: this.key(), files: links.map((link) => this.pathOf(link)), chained, bytes, from }),
      (reply) =>
        reply._tag === 'Read'
          ? Effect.succeed({ text: reply.text, from: reply.from, bytes: reply.bytes })
          : Effect.fail(new BodyUnreadable({ reason: reply._tag === 'Failed' ? reply.reason : `The body answered ${reply._tag}.` })),
    );
  }

  remove(bucket: string): Effect.Effect<void, BodyUnreadable | WorkerUnavailable> {
    return Effect.flatMap(this.ask({ _tag: 'Remove', key: this.key(), bucket, path: join(this.root, bucket) }), (reply) =>
      reply._tag === 'Removed'
        ? Effect.void
        : Effect.fail(new BodyUnreadable({ reason: reply._tag === 'Failed' ? reply.reason : `Removal answered ${reply._tag}.` })),
    );
  }

  inventory(oldest: string): Effect.Effect<readonly BodyBucket[], BodyUnreadable | WorkerUnavailable> {
    return Effect.flatMap(this.ask({ _tag: 'Inventory', key: this.key(), root: this.root, oldest }), (reply) =>
      reply._tag === 'Inventory'
        ? Effect.succeed(reply.buckets)
        : Effect.fail(new BodyUnreadable({ reason: reply._tag === 'Failed' ? reply.reason : `Inventory answered ${reply._tag}.` })),
    );
  }

  discard(links: readonly BodyLink[]): Effect.Effect<void, BodyUnreadable | WorkerUnavailable> {
    if (links.length === 0) return Effect.void;
    return Effect.flatMap(this.ask({ _tag: 'Discard', key: this.key(), root: this.root, links }), (reply) =>
      reply._tag === 'Removed'
        ? Effect.void
        : Effect.fail(new BodyUnreadable({ reason: reply._tag === 'Failed' ? reply.reason : `Discard answered ${reply._tag}.` })),
    );
  }

  private write(fact: ActivityBodied): Effect.Effect<BodyStored> {
    const id = `${fact.activity}.${fact.n}`;
    const bucket = bucketOf(fact.at);
    const ceiling = this.ceiling();
    const stored = (
      state: BodyStored['state'],
      bytes = 0,
      form: BodyForm = 'value',
      base: string | null = null,
      size = fact.body.encoded.byteLength,
    ) => storedOf(fact, state, bytes, form, base, size);
    const chain = fact.body.series === true && fact.thread !== null ? `${fact.thread}\u0000${fact.body.kind}` : null;
    return this.ask({
      _tag: 'Write',
      key: id,
      path: this.pathOf({ id, bucket }),
      bucket,
      chain,
      ceiling,
      encoded: fact.body.encoded,
      contentType: fact.body.contentType,
    }).pipe(
      Effect.map((reply) =>
        reply._tag === 'Written'
          ? stored('written', reply.bytes, reply.form, reply.base, reply.size)
          : reply._tag === 'Declined'
            ? stored('declined', reply.bytes)
            : stored('unwritten'),
      ),
      Effect.catchTag('WorkerUnavailable', (failure) =>
        Effect.logWarning('The activity body could not be written', failure.message).pipe(Effect.as(stored('unwritten'))),
      ),
    );
  }

  private pathOf(link: BodyLink): string {
    return join(this.root, link.bucket, `${link.id}.json`);
  }

  private key(): string {
    return `ask.${(this.asked += 1)}`;
  }

  private receive(reply: BodyReply): void {
    const waiting = this.replies.get(reply.key);
    if (waiting === undefined) return;
    this.replies.delete(reply.key);
    Deferred.doneUnsafe(waiting, Exit.succeed(reply));
  }

  private lost(reason: string): WorkerUnavailable {
    if (this.failure !== undefined) return this.failure;
    this.worker = null;
    this.starting.closeUnsafe();
    const gone = (this.failure = workerGone('activity body worker', reason));
    if (this.trip !== undefined) Deferred.doneUnsafe(this.trip, Effect.void);
    for (const waiting of this.replies.values()) Deferred.doneUnsafe(waiting, Exit.fail(gone));
    this.replies.clear();
    return gone;
  }

  private ask(request: BodyRequest): Effect.Effect<BodyReply, WorkerUnavailable> {
    return Effect.suspend(() => {
      const worker = this.worker;
      if (worker === null)
        return Effect.fail(this.failure ?? new WorkerUnavailable('activity body worker', 'the worker is starting again'));
      const waiting = Deferred.makeUnsafe<BodyReply, WorkerUnavailable>();
      this.replies.set(request.key, waiting);
      return Effect.andThen(
        worker.send(request).pipe(Effect.mapError((failure) => this.lost(failure.message))),
        Deferred.await(waiting),
      ).pipe(Effect.onInterrupt(() => Effect.sync(() => this.replies.delete(request.key))));
    });
  }
}

function storedOf(
  fact: ActivityBodied,
  state: BodyStored['state'],
  bytes = 0,
  form: BodyForm = 'value',
  base: string | null = null,
  size = fact.body.encoded.byteLength,
): BodyStored {
  return {
    _tag: 'BodyStored',
    activity: fact.activity,
    n: fact.n,
    kind: fact.body.kind,
    at: fact.at,
    bucket: bucketOf(fact.at),
    bytes,
    size,
    contentType: fact.body.contentType,
    state,
    form,
    base,
  };
}

export function bucketOf(at: number): string {
  return new Date(at).toISOString().slice(0, 13);
}
