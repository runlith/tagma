import { Clock, Deferred, Duration, Effect, Exit, Fiber, Result, Scope } from 'effect';
import type { Socket } from 'effect/socket/Socket';
import { receiving } from '../helper/channel.ts';
import { controlFrame, encodeHelper, FrameReader, helperAudio, readClient, readClientAudio } from '../helper/frame.ts';
import type { ClientMessage, HelperMessage } from '../helper/messages.ts';
import type { Format } from '../sound/format.ts';

export type FakeHelperOptions = {
  readonly skew?: bigint;
  readonly chunkMs?: number;
  readonly pace?: Duration.Input;
  readonly drainPerMs?: number;
  readonly devicesReply?: unknown;
};

type Item = { ms: number } | { readonly mark: string };
type Out = { items: Array<Item>; queuedMs: number; frames: number; consumer: Fiber.Fiber<void> | undefined };
type Producer = { stopping: boolean; fiber: Fiber.Fiber<void> | undefined };

const format: Format = { rate: 16_000, channels: 1 };
const nanosPerMs = 1_000_000n;

const tone = (frames: number, offset: number): Int16Array => {
  const pcm = new Int16Array(frames);
  for (let i = 0; i < frames; i++) pcm[i] = Math.round(8000 * Math.sin((2 * Math.PI * 440 * (offset + i)) / format.rate));
  return pcm;
};

export const startFakeHelper = Effect.fnUntraced(function* (socket: Socket, token: string, options: FakeHelperOptions = {}) {
  const scope = yield* Scope.make();
  const clock = yield* Clock.Clock;
  const writer = yield* Scope.provide(socket.writer, scope);
  const devices = ['synthetic', 'synthetic-gap'];
  const holders = new Set<number>();
  const quit = Deferred.makeUnsafe<void>();
  const producers = new Map<number, Producer>();
  const outputs = new Map<number, Out>();
  const reader = new FrameReader();
  const chunkMs = options.chunkMs ?? 20;
  const pace = Duration.fromInputUnsafe(options.pace ?? Duration.millis(2));
  const drainPerMs = options.drainPerMs ?? 20;
  let maxQueuedMs = 0;

  const close = Effect.forkDetach(Scope.close(scope, Exit.void)).pipe(Effect.asVoid);

  const framesOf = (id: number): number => outputs.get(id)?.frames ?? 0;

  const now = (): bigint => clock.monotonicTimeNanosUnsafe() + (options.skew ?? 0n);

  const raw = (bytes: Uint8Array): Effect.Effect<void> => Effect.asVoid(Effect.exit(writer.write(bytes)));

  const send = (message: HelperMessage): Effect.Effect<void> => raw(encodeHelper(message));

  const unknown = (id: number, what: string): Effect.Effect<void> =>
    send({ type: 'refused', id, code: 'device-missing', message: `${what} for no open player ${id}` });

  const produce = Effect.fnUntraced(function* (id: number, producer: Producer, gapped: boolean) {
    const frames = (chunkMs * format.rate) / 1000;
    let at = now();
    for (let n = 0; ; n++) {
      yield* Effect.sleep(pace);
      const tail = producer.stopping;
      const pcm = tone(tail ? frames / 2 : frames, n * frames);
      yield* raw(helperAudio(id, at, pcm));
      at += (BigInt(pcm.length) * 1_000_000_000n) / BigInt(format.rate);
      if (tail) break;
      if (gapped && n === 0) {
        yield* send({ type: 'gap', id, fromNs: at, toNs: at + 40n * nanosPerMs, cause: 'overflow' });
        at += 40n * nanosPerMs;
      }
    }
    producers.delete(id);
    yield* send({ type: 'end', id, reason: 'drained' });
  });

  const capture = Effect.fnUntraced(function* (id: number, device: string | undefined) {
    if (device !== undefined && !devices.includes(device)) {
      return yield* send({ type: 'refused', id, code: 'device-missing', message: `no input ${device}` });
    }
    const producer: Producer = { stopping: false, fiber: undefined };
    producers.set(id, producer);
    yield* send({ type: 'ready', id, format });
    producer.fiber = yield* Effect.forkIn(produce(id, producer, device === 'synthetic-gap'), scope);
  });

  const consume = Effect.fnUntraced(function* (id: number, out: Out) {
    for (;;) {
      yield* Effect.sleep(Duration.millis(1));
      let budget = drainPerMs;
      let played = 0;
      const marks: Array<string> = [];
      while (out.items.length > 0) {
        const item = out.items[0]!;
        if ('mark' in item) {
          marks.push(item.mark);
          out.items.shift();
          continue;
        }
        if (item.ms > budget) {
          item.ms -= budget;
          played += budget;
          break;
        }
        budget -= item.ms;
        played += item.ms;
        out.items.shift();
      }
      out.queuedMs -= played;
      if (played > 0) yield* send({ type: 'played', id, ms: played });
      for (const mark of marks) yield* send({ type: 'marked', id, mark, outcome: 'played' });
    }
  });

  const play = Effect.fnUntraced(function* (id: number) {
    const out: Out = { items: [], queuedMs: 0, frames: 0, consumer: undefined };
    outputs.set(id, out);
    yield* send({ type: 'ready', id });
    out.consumer = yield* Effect.forkIn(consume(id, out), scope);
  });

  const queue = (id: number, frames: number): Effect.Effect<void> => {
    const out = outputs.get(id);
    if (out === undefined) return unknown(id, 'audio');
    const ms = (frames * 1000) / format.rate;
    out.items.push({ ms });
    out.queuedMs += ms;
    out.frames += frames;
    if (out.queuedMs > maxQueuedMs) maxQueuedMs = out.queuedMs;
    return Effect.void;
  };

  const clear = Effect.fnUntraced(function* (id: number) {
    const out = outputs.get(id);
    if (out === undefined) return yield* unknown(id, 'a clear');
    const items = out.items.splice(0);
    const dropped = out.queuedMs;
    out.queuedMs = 0;
    if (dropped > 0) yield* send({ type: 'played', id, ms: dropped });
    for (const item of items) if ('mark' in item) yield* send({ type: 'marked', id, mark: item.mark, outcome: 'cleared' });
  });

  const release = Effect.fnUntraced(function* (id: number) {
    const out = outputs.get(id);
    if (out === undefined) return;
    outputs.delete(id);
    if (out.consumer !== undefined) yield* Fiber.interrupt(out.consumer);
    yield* send({ type: 'end', id, reason: 'released' });
  });

  const abort = Effect.fnUntraced(function* (id: number) {
    const producer = producers.get(id);
    if (producer === undefined) return;
    producers.delete(id);
    if (producer.fiber !== undefined) yield* Fiber.interrupt(producer.fiber);
    yield* send({ type: 'end', id, reason: 'aborted' });
  });

  const control = (message: ClientMessage): Effect.Effect<void> => {
    switch (message.type) {
      case 'devices':
        if (options.devicesReply !== undefined) return raw(controlFrame(options.devicesReply));
        return send({
          type: 'devices',
          list: devices.map((id) => ({ id, label: `Synthetic ${id}` })),
          permissions: { mic: 'granted', system: 'unknown' },
        });
      case 'output':
        return send({ type: 'output', kind: 'unknown' });
      case 'capture':
        return capture(message.id, message.device);
      case 'stop':
        return Effect.sync(() => {
          const producer = producers.get(message.id);
          if (producer !== undefined) producer.stopping = true;
        });
      case 'abort':
        return abort(message.id);
      case 'play':
        return play(message.id);
      case 'mark': {
        const out = outputs.get(message.id);
        if (out === undefined) return unknown(message.id, 'a mark');
        out.items.push({ mark: message.mark });
        return Effect.void;
      }
      case 'clear':
        return clear(message.id);
      case 'release':
        return release(message.id);
      case 'mute':
        holders.add(message.id);
        return send({ type: 'ready', id: message.id });
      case 'unmute':
        if (!holders.delete(message.id)) return Effect.void;
        return send({ type: 'end', id: message.id, reason: 'released' });
      case 'quit':
        return Deferred.succeed(quit, undefined).pipe(Effect.andThen(close));
    }
  };

  const receive = (bytes: Uint8Array): Effect.Effect<void> =>
    Effect.forEach(
      reader.push(bytes),
      (frame) => {
        if (frame.kind === 'broken') return send({ type: 'refused', code: 'helper-mismatch', message: frame.detail });
        if (frame.kind === 'audio') {
          const audio = readClientAudio(frame.body);
          return Result.isSuccess(audio) ? queue(audio.success.id, audio.success.pcm.length) : Effect.void;
        }
        const message = readClient(frame.text);
        if (Result.isFailure(message)) return send({ type: 'refused', code: 'helper-mismatch', message: message.failure });
        return control(message.success);
      },
      { discard: true },
    );

  yield* Effect.forkIn(
    receiving(socket, receive).pipe(Effect.exit, Effect.andThen(Deferred.succeed(quit, undefined)), Effect.andThen(close)),
    scope,
  );
  yield* send({ type: 'hello', token, nowNs: now() });

  return {
    devices,
    holders,
    quit,
    close,
    framesOf,
    now,
    send,
    raw,
    get maxQueuedMs() {
      return maxQueuedMs;
    },
  };
});

export type FakeHelper = Effect.Success<ReturnType<typeof startFakeHelper>>;
