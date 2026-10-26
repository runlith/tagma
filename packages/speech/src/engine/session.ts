import type { Chunk } from '@runlith/audio/sound/chunk';
import { type Format, framesOf, millisOf } from '@runlith/audio/sound/format';
import { type Gap as AudioGap, type GapCause, lostSound } from '@runlith/audio/sound/gap';
import { Resampler } from '@runlith/audio/sound/resampler';
import { type Cause, Clock, Deferred, Effect, Exit, Option, Queue, Result, Scope, type Semaphore, Stream } from 'effect';
import type { Connection } from '../protocol/adapter.ts';
import { forkWatched } from '../protocol/watch.ts';
import type { StreamRecognition, TurnMode } from '../wire/capabilities.ts';
import { SpeechEvent } from '../wire/events.ts';
import { SpeechFailure } from '../wire/failure.ts';
import type { Gap, Heard, Phase, Span } from '../wire/heard.ts';
import type { Hearing } from './hearing.ts';
import type { Cut } from './segmenter.ts';
import { backoffMs, type ListeningSettings } from './settings.ts';
import type { Probabilities } from './SpeechDetector.ts';
import { msOf, Timeline } from './timeline.ts';
import { Assembler, type Counter } from './turns.ts';

export type Plan = {
  readonly track: string;
  readonly origin: bigint;
  readonly mode: TurnMode;
  readonly capabilities: StreamRecognition;
  readonly settings: ListeningSettings;
};

type Segment = {
  readonly no: number;
  readonly scope: Scope.Closeable;
  readonly connection: Connection;
  readonly timeline: Timeline;
  readonly assembler: Assembler;
  readonly commits: Map<number, Span>;
  readonly finished: Deferred.Deferred<void, SpeechFailure>;
  readonly resampler: Resampler;
  readonly openedAt: number;
  committed: number;
  sent: number;
  live: boolean;
};

type Opening = { readonly from: number; readonly cause: GapCause; readonly message: string };

export const makeSession = ({
  plan,
  connect,
  hearing,
  source,
  scope,
  lock,
  out,
}: {
  readonly plan: Plan;
  readonly connect: Effect.Effect<Connection, SpeechFailure, Scope.Scope>;
  readonly hearing: Hearing | undefined;
  readonly source: Format;
  readonly scope: Scope.Scope;
  readonly lock: Semaphore.Semaphore;
  readonly out: Queue.Queue<Heard, SpeechFailure | Cause.Done>;
}) => {
  const counter: Counter = { value: 0 };
  let draining = 0;
  let idle: Deferred.Deferred<void> | undefined;
  let current: Segment | undefined;
  let following: Segment | undefined;
  let switching = false;
  let failures = 0;
  let resumeAt = 0;
  let prepareAt = 0;
  let prepareFailures = 0;
  let opening: Opening | undefined;
  let heardTo: number | undefined;
  let ended = false;
  let segments = 0;
  let commitIds = 0;
  let reportedPhase: Phase | undefined;
  let reportedAt = 0;

  const locked = lock.withPermits(1);

  const emit = (heard: ReadonlyArray<Heard>): Effect.Effect<void> =>
    heard.length === 0 ? Effect.void : Effect.asVoid(Queue.offerAll(out, heard));

  const gap = (from: number, to: number | undefined, cause: GapCause, message: string): Gap => ({
    _tag: 'Gap',
    track: plan.track,
    from,
    to,
    cause,
    message,
  });

  const openGap = (from: number, cause: GapCause, message: string): void => {
    if (opening === undefined) opening = { from, cause, message };
  };

  const closeGap = (to: number | undefined): Effect.Effect<void> => {
    const closing = opening;
    opening = undefined;
    if (closing === undefined) return Effect.void;
    const end = to === undefined ? undefined : Math.max(closing.from, to);
    return emit([gap(closing.from, end, closing.cause, closing.message)]);
  };

  const report = Effect.fnUntraced(function* (phase: Phase, segment: Segment | undefined, retryInMs?: number) {
    const at = heardTo ?? 0;
    if (phase === reportedPhase && (phase !== 'live' || at - reportedAt < 1_000)) return;
    reportedPhase = phase;
    reportedAt = at;
    const queued = segment === undefined ? 0 : segment.sent - (yield* segment.connection.delivered);
    const rate = segment?.connection.format.rate ?? source.rate;
    yield* emit([
      {
        _tag: 'State',
        track: plan.track,
        phase,
        segment: segment?.no,
        retryInMs,
        queuedMs: Math.max(0, (queued * 1000) / rate),
      },
    ]);
  });

  const unconfirmedFrom = (segment: Segment): number | undefined => {
    const pending = segment.assembler.unconfirmed;
    const confirmed = segment.assembler.confirmed ?? segment.timeline.start;
    if (confirmed === undefined) return pending;
    return pending === undefined ? confirmed : Math.min(pending, confirmed);
  };

  const stop = Effect.fnUntraced(function* (failure: SpeechFailure, from: number | undefined) {
    if (ended) return;
    ended = true;
    if (current !== undefined) yield* emit(current.assembler.closeAll());
    const start = opening?.from ?? from;
    opening = undefined;
    if (start !== undefined) yield* emit([gap(start, undefined, 'recognition-failed', failure.message)]);
    yield* Queue.fail(out, failure);
  });

  const abort = (failure: SpeechFailure): Effect.Effect<void> =>
    stop(failure, current === undefined ? heardTo : (unconfirmedFrom(current) ?? heardTo));

  const sever = Effect.fnUntraced(function* () {
    if (ended) return;
    const running = current;
    const from = opening?.from ?? (running === undefined ? heardTo : (unconfirmedFrom(running) ?? heardTo));
    ended = true;
    opening = undefined;
    if (running !== undefined) yield* emit(running.assembler.closeAll());
    const to = heardTo;
    if (from !== undefined && to !== undefined && to > from) {
      yield* emit([gap(from, to, 'unconfirmed-tail', 'recognition was cut before the provider confirmed this audio')]);
    }
    yield* Queue.end(out);
  });

  const refuse = Effect.fnUntraced(function* (failure: SpeechFailure, from: number | undefined, wait: boolean) {
    failures += 1;
    const retry = plan.settings.retry;
    if (!failure.retryable || failures > retry.attempts) return yield* stop(failure, from);
    if (from !== undefined) openGap(from, 'reconnect', failure.message);
    if (!wait) return;
    const delay = backoffMs(retry, failures, failure.retryAfterMs);
    resumeAt = (yield* Clock.currentTimeMillis) + delay;
    yield* report('waiting', undefined, delay);
  });

  const unprepared = Effect.fnUntraced(function* (failure: SpeechFailure) {
    if (!failure.retryable) return yield* abort(failure);
    prepareFailures += 1;
    const delay = backoffMs(plan.settings.retry, prepareFailures, failure.retryAfterMs);
    prepareAt = (yield* Clock.currentTimeMillis) + delay;
  });

  const lose = Effect.fnUntraced(function* (segment: Segment, failure: SpeechFailure) {
    if (ended || !segment.live) return;
    segment.live = false;
    if (segment === following) {
      following = undefined;
      yield* Scope.close(segment.scope, Exit.void);
      return yield* unprepared(failure);
    }
    if (segment !== current) return;
    const from = unconfirmedFrom(segment) ?? heardTo;
    yield* emit(segment.assembler.closeAll());
    yield* Scope.close(segment.scope, Exit.void);
    current = following;
    following = undefined;
    switching = false;
    yield* refuse(failure, from, current === undefined);
  });

  const commitRest = (segment: Segment): Effect.Effect<void> => {
    if (plan.mode !== 'client' || segment.sent <= segment.committed) return Effect.void;
    commitIds += 1;
    const id = commitIds;
    segment.commits.set(id, { from: segment.timeline.at(segment.committed), to: segment.timeline.at(segment.sent) });
    segment.committed = segment.sent;
    return Effect.asVoid(Effect.result(segment.connection.commit(id)));
  };

  const drain = Effect.fnUntraced(function* (segment: Segment): Effect.fn.Return<boolean> {
    segment.live = false;
    const finish = yield* locked(Effect.andThen(commitRest(segment), Effect.result(segment.connection.finish)));
    const waited = yield* Deferred.await(segment.finished).pipe(Effect.result, Effect.timeoutOption(plan.settings.finishMs));
    return yield* locked(
      Effect.gen(function* () {
        const confirmed = Result.isSuccess(finish) && Option.isSome(waited) && Result.isSuccess(waited.value);
        const from = unconfirmedFrom(segment);
        yield* emit(segment.assembler.closeAll());
        if (!confirmed && from !== undefined && segment.timeline.length > 0) {
          const message =
            Option.isSome(waited) && Result.isFailure(waited.value)
              ? waited.value.failure.message
              : 'the provider did not confirm the tail in time';
          yield* emit([gap(from, Math.max(from, segment.timeline.end), 'unconfirmed-tail', message)]);
        }
        yield* Scope.close(segment.scope, Exit.void);
        return confirmed || segment.timeline.length === 0;
      }),
    );
  });

  const background = (segment: Segment): Effect.Effect<void> => {
    draining += 1;
    const done = Effect.suspend(() => {
      draining -= 1;
      return draining === 0 && idle !== undefined ? Deferred.succeed(idle, undefined) : Effect.void;
    });
    return Effect.asVoid(forkWatched(Effect.ensuring(Effect.asVoid(drain(segment)), done), scope, out));
  };

  const tail = Effect.fnUntraced(function* (segment: Segment) {
    const flushed = segment.resampler.flush();
    if (flushed === undefined || !segment.live) return;
    const frames = framesOf(segment.connection.format, flushed.pcm);
    const from = segment.timeline.end;
    segment.timeline.record(flushed.at, frames);
    const sent = yield* Effect.result(segment.connection.send(flushed.pcm));
    if (Result.isSuccess(sent)) {
      segment.sent += frames;
      return;
    }
    if (sent.failure._tag === 'Overflow')
      yield* emit([gap(from, segment.timeline.end, 'budget', 'the provider fell behind the audio budget')]);
  });

  const switchOver = Effect.fnUntraced(function* () {
    const old = current;
    const next = following;
    switching = false;
    if (old === undefined || next === undefined) return;
    yield* tail(old);
    current = next;
    following = undefined;
    prepareFailures = 0;
    yield* background(old);
  });

  const read = Effect.fnUntraced(function* (segment: Segment) {
    const pump = Effect.gen(function* () {
      const consumed = yield* Effect.result(
        Stream.runForEach(segment.connection.events, (event) =>
          locked(
            Effect.gen(function* () {
              yield* emit(segment.assembler.apply(event));
              if (segment === current) failures = 0;
              if (event._tag === 'Finished') yield* Deferred.succeed(segment.finished, undefined);
              const boundary = event._tag === 'TurnEnd' && plan.mode !== 'client' && segment.assembler.idle;
              if (boundary && segment === current && switching) yield* switchOver();
            }),
          ),
        ),
      );
      if (Result.isSuccess(consumed) && (yield* Deferred.isDone(segment.finished))) return;
      const failure = Result.isFailure(consumed)
        ? consumed.failure
        : SpeechFailure.transport('the provider ended its events without Finished');
      yield* Deferred.fail(segment.finished, failure);
      yield* locked(lose(segment, failure));
    });
    yield* forkWatched(pump, segment.scope, out);
  });

  const open = Effect.fnUntraced(function* (): Effect.fn.Return<Result.Result<Segment, SpeechFailure>> {
    const child = yield* Scope.fork(scope);
    const connected = yield* Effect.result(Scope.provide(connect, child));
    if (Result.isFailure(connected)) {
      yield* Scope.close(child, Exit.void);
      return Result.fail(connected.failure);
    }
    segments += 1;
    const connection = connected.success;
    const timeline = new Timeline(connection.format.rate, plan.origin);
    const commits = new Map<number, Span>();
    const segment: Segment = {
      no: segments,
      scope: child,
      connection,
      timeline,
      assembler: new Assembler(plan.track, segments, plan.mode, counter, plan.settings.splitting, {
        time: (frame) => timeline.at(frame),
        commit: (commit) => commits.get(commit),
      }),
      commits,
      finished: yield* Deferred.make<void, SpeechFailure>(),
      resampler: new Resampler(source, connection.format),
      openedAt: yield* Clock.currentTimeMillis,
      committed: 0,
      sent: 0,
      live: true,
    };
    yield* read(segment);
    return Result.succeed(segment);
  });

  const rollover = Effect.fnUntraced(function* (segment: Segment) {
    const sessionMs = plan.capabilities.limits.sessionMs;
    if (sessionMs === undefined) return;
    const now = yield* Clock.currentTimeMillis;
    const age = now - segment.openedAt;
    const { leadMs, marginMs } = plan.settings.rollover;
    if (age < sessionMs - Math.min(leadMs, sessionMs / 4)) return;
    switching = true;
    if (following === undefined && now >= prepareAt) {
      const opened = yield* open();
      if (Result.isFailure(opened)) yield* unprepared(opened.failure);
      else following = opened.success;
    }
    if (age >= sessionMs - Math.min(marginMs, sessionMs / 20) && following !== undefined) yield* switchOver();
  });

  const chunk = Effect.fnUntraced(function* (sound: Chunk, fresh = false) {
    if (ended) return;
    const at = msOf(plan.origin, sound.at);
    heardTo = at + millisOf(source, framesOf(source, sound.pcm));
    if ((yield* Clock.currentTimeMillis) < resumeAt) return openGap(at, 'reconnect', 'waiting to reconnect');
    let segment = current;
    if (segment === undefined) {
      const opened = yield* open();
      if (Result.isFailure(opened)) return yield* refuse(opened.failure, at, true);
      segment = opened.success;
      current = segment;
    }
    yield* closeGap(at);
    const pushed = segment.resampler.push(sound);
    if (pushed !== undefined) {
      const frames = framesOf(segment.connection.format, pushed.pcm);
      segment.timeline.record(pushed.at, frames);
      const sent = yield* Effect.result(segment.connection.send(pushed.pcm));
      if (Result.isSuccess(sent)) segment.sent += frames;
      else if (sent.failure._tag === 'Overflow') return yield* overflow(segment, sound, fresh);
      else return yield* lose(segment, sent.failure);
    }
    const settings = plan.settings.splitting;
    yield* emit(segment.assembler.quiet(segment.timeline.end - settings.pauseMs - settings.lagMs));
    yield* report((yield* segment.connection.delivered) > 0 ? 'live' : 'connecting', segment);
    yield* rollover(segment);
  });

  const overflow = Effect.fnUntraced(function* (segment: Segment, sound: Chunk, fresh: boolean): Effect.fn.Return<void> {
    segment.live = false;
    const from = unconfirmedFrom(segment) ?? heardTo;
    yield* emit(segment.assembler.closeAll());
    yield* Scope.close(segment.scope, Exit.void);
    current = following;
    following = undefined;
    switching = false;
    const failure = SpeechFailure.transport('the provider fell behind the audio budget');
    if (fresh) return yield* refuse(failure, from, true);
    if (from !== undefined) openGap(from, 'budget', failure.message);
    yield* chunk(sound, true);
  });

  const heard = Effect.fnUntraced(function* (effect: Effect.Effect<void, SpeechFailure>) {
    const done = yield* Effect.result(effect);
    if (Result.isFailure(done)) yield* abort(done.failure);
  });

  const boundaries = Effect.fnUntraced(function* (cuts: ReadonlyArray<Cut>) {
    for (const _cut of cuts) {
      const segment = current;
      if (segment === undefined || !segment.live) return;
      if (plan.mode === 'client') yield* commitRest(segment);
      else if (plan.mode === 'none' && plan.capabilities.finalize) yield* Effect.asVoid(Effect.result(segment.connection.finalize));
      if (switching && following !== undefined) yield* switchOver();
    }
  });

  const detect = (sound: Chunk): Effect.Effect<void> => (hearing === undefined || ended ? Effect.void : heard(hearing.push(sound)));

  const hear = (probabilities: Probabilities): Effect.Effect<void> =>
    hearing === undefined || ended ? Effect.void : boundaries(hearing.hear(probabilities));

  const interrupt = Effect.fnUntraced(function* (sound: AudioGap) {
    if (ended) return;
    const from = msOf(plan.origin, sound.from);
    if (current !== undefined) yield* tail(current);
    if (hearing !== undefined) {
      yield* heard(hearing.tail());
      yield* boundaries(hearing.settle());
      yield* heard(hearing.reset());
    }
    yield* closeGap(from);
    const to = sound.to === undefined ? undefined : msOf(plan.origin, sound.to);
    yield* emit([gap(from, to, sound.cause, lostSound(sound.cause))]);
    const running = current;
    current = following;
    following = undefined;
    switching = false;
    if (running !== undefined) yield* background(running);
  });

  const end = Effect.fnUntraced(function* () {
    const last = yield* locked(
      Effect.gen(function* () {
        if (ended) return undefined;
        if (current !== undefined) yield* tail(current);
        if (hearing !== undefined) yield* boundaries(hearing.settle());
        const lost = opening !== undefined;
        yield* closeGap(heardTo);
        const segment = current;
        const next = following;
        current = undefined;
        following = undefined;
        if (next !== undefined) yield* Scope.close(next.scope, Exit.void);
        return { segment, lost };
      }),
    );
    if (last === undefined) return;
    const confirmed = last.segment === undefined ? !last.lost : yield* drain(last.segment);
    const settled = yield* Deferred.make<void>();
    idle = settled;
    if (draining === 0) yield* Deferred.succeed(settled, undefined);
    yield* Deferred.await(settled);
    yield* locked(
      Effect.gen(function* () {
        if (ended) return;
        ended = true;
        if (confirmed) yield* emit([SpeechEvent.finished]);
        yield* Queue.end(out);
      }),
    );
  });

  return { locked, abort, sever, chunk, detect, hear, interrupt, end };
};
