import { Deferred, type Duration, Effect, Exit, Option } from 'effect';
import type { Channel } from './channel.ts';
import { EngineCrashed, type EngineFailure, EngineRefused, ModelBusy, QueueFull } from './failures.ts';
import type { Host } from './host.ts';
import type { Message, Segment } from './wire.ts';

export type Model = {
  readonly id: string;
  readonly path: string;
};

export type Transcript = {
  readonly language: string | null;
  readonly segments: ReadonlyArray<Segment>;
};

type Entry = {
  readonly model: Model;
  readonly pcm: Int16Array;
  readonly language: string | undefined;
  readonly ms: number;
  readonly done: Deferred.Deferred<Transcript, EngineFailure>;
  state: 'queued' | 'active' | 'dropped' | 'settled';
  running: { readonly channel: Channel; readonly id: string } | undefined;
  abandoned: boolean;
};

const abandoned = new EngineRefused({ code: 'cancelled', reason: 'the clip was cancelled' });

const unexpected = (wanted: string, message: Message): EngineRefused =>
  new EngineRefused({ code: 'protocol', reason: `the engine answered ${message.type} where ${wanted} was due` });

export const makeClips = ({
  host,
  rate,
  budgetMs,
  idle,
}: {
  readonly host: Host;
  readonly rate: number;
  readonly budgetMs: number;
  readonly idle: Duration.Input;
}) => {
  let queuedMs = 0;
  let working = 0;
  let loadedModel: string | undefined;
  const waiting: Entry[] = [];
  let wake: Deferred.Deferred<void> | undefined;

  const release = (entry: Entry, state: 'dropped' | 'settled'): void => {
    if (entry.state === 'dropped' || entry.state === 'settled') return;
    entry.state = state;
    working -= 1;
    queuedMs -= entry.ms;
    if (working === 0) loadedModel = undefined;
  };

  const drop = (entry: Entry): Effect.Effect<void> =>
    Effect.suspend(() => {
      if (entry.state === 'queued') {
        waiting.splice(waiting.indexOf(entry), 1);
        release(entry, 'dropped');
        return Effect.void;
      }
      if (entry.state !== 'active') return Effect.void;
      entry.abandoned = true;
      if (entry.running === undefined) return Effect.void;
      const { channel, id } = entry.running;
      return Effect.asVoid(Effect.exit(channel.send({ type: 'cancel', id })));
    });

  const transcribe = (
    model: Model,
    pcm: Int16Array,
    language: string | undefined,
  ): Effect.Effect<Transcript, EngineFailure | QueueFull | ModelBusy> =>
    Effect.suspend((): Effect.Effect<Transcript, EngineFailure | QueueFull | ModelBusy> => {
      if (working > 0 && loadedModel !== undefined && loadedModel !== model.id) {
        return Effect.fail(new ModelBusy({ working: loadedModel, requested: model.id }));
      }
      const ms = (pcm.length * 1000) / rate;
      if (queuedMs + ms > budgetMs) {
        return Effect.fail(new QueueFull({ queuedMs, budgetMs }));
      }
      const entry: Entry = { model, pcm, language, ms, done: Deferred.makeUnsafe(), state: 'queued', running: undefined, abandoned: false };
      working += 1;
      queuedMs += ms;
      loadedModel = model.id;
      waiting.push(entry);
      const woken = wake;
      wake = undefined;
      return (woken === undefined ? Effect.void : Deferred.succeed(woken, undefined)).pipe(
        Effect.andThen(Deferred.await(entry.done)),
        Effect.onInterrupt(() => drop(entry)),
      );
    });

  const run = Effect.fnUntraced(function* (entry: Entry): Effect.fn.Return<Transcript, EngineFailure> {
    const channel = yield* host.channel;
    if (channel.loaded !== entry.model.id) {
      const loaded = yield* channel.ask({ type: 'load', id: channel.id(), path: entry.model.path });
      if (loaded.type !== 'loaded') return yield* unexpected('loaded', loaded);
      channel.loaded = entry.model.id;
    }
    if (entry.abandoned) return yield* abandoned;
    const id = channel.id();
    const command =
      entry.language === undefined ? { type: 'transcribe' as const, id } : { type: 'transcribe' as const, id, language: entry.language };
    const admitted = Effect.suspend(() => {
      entry.running = { channel, id };
      return entry.abandoned ? channel.send({ type: 'cancel', id }) : Effect.void;
    });
    const answer = yield* channel.ask(command, entry.pcm, admitted);
    if (answer.type === 'cancelled') return yield* abandoned;
    if (answer.type !== 'result') return yield* unexpected('result', answer);
    return { language: answer.language, segments: answer.segments };
  });

  const failQueued = (crashed: EngineCrashed): Effect.Effect<void> =>
    Effect.suspend(() => {
      const queued = waiting.splice(0);
      for (const entry of queued) release(entry, 'settled');
      return Effect.forEach(queued, (entry) => Deferred.fail(entry.done, crashed), { discard: true });
    });

  const serve = (entry: Entry): Effect.Effect<void> =>
    Effect.suspend(() => {
      if (entry.state !== 'queued') return Effect.void;
      entry.state = 'active';
      return Effect.flatMap(Effect.exit(run(entry)), (exit) => {
        release(entry, 'settled');
        const failed = Exit.isFailure(exit) ? Exit.findErrorOption(exit) : Option.none();
        const crashed = Option.isSome(failed) && failed.value instanceof EngineCrashed ? failed.value : undefined;
        return Effect.andThen(Deferred.done(entry.done, exit), crashed === undefined ? Effect.void : failQueued(crashed));
      });
    });

  const unload = Effect.suspend(() => {
    const channel = host.running;
    if (working > 0 || channel?.loaded === undefined) return Effect.void;
    channel.loaded = undefined;
    return Effect.asVoid(Effect.exit(channel.ask({ type: 'unload', id: channel.id() })));
  });

  const work = Effect.forever(
    Effect.suspend(() => {
      const next = waiting.shift();
      if (next !== undefined) return serve(next);
      const sleeping = Deferred.makeUnsafe<void>();
      wake = sleeping;
      return Effect.flatMap(Effect.timeoutOption(Deferred.await(sleeping), idle), (woken) => (Option.isSome(woken) ? Effect.void : unload));
    }),
  );

  return { transcribe, work };
};
