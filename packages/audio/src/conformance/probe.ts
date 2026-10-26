import { type Cause, Clock, Data, Effect, Queue, Result } from 'effect';
import type { Socket } from 'effect/socket/Socket';
import { receiving } from '../helper/channel.ts';
import { encodeClient, FrameReader, type HelperAudio, readHelper, readHelperAudio } from '../helper/frame.ts';
import type { ClientMessage, HelperMessage } from '../helper/messages.ts';
import { type Format, nanosOf } from '../sound/format.ts';

export class ConformanceFailed extends Data.TaggedError('ConformanceFailed')<{
  readonly step: string;
  readonly detail: string;
}> {}

export type Received =
  | { readonly kind: 'message'; readonly message: HelperMessage }
  | { readonly kind: 'audio'; readonly audio: HelperAudio }
  | { readonly kind: 'eof' }
  | { readonly kind: 'violation' };

const TOLERANCE = 2_000_000n;

export const openProbe = Effect.fnUntraced(function* (socket: Socket) {
  const inbox = yield* Queue.unbounded<Received, Cause.Done>();
  const reader = new FrameReader();
  const writer = yield* socket.writer;
  const clock = yield* Clock.Clock;
  const formats = new Map<number, Format>();
  const reach = new Map<number, bigint>();
  const ended = new Set<number>();
  let violation: string | undefined;
  let hello: { readonly nowNs: bigint; readonly at: bigint } | undefined;

  const fail = (detail: string): void => {
    if (violation !== undefined) return;
    violation = detail;
    Queue.offerUnsafe(inbox, { kind: 'violation' });
  };

  const observe = (message: HelperMessage): void => {
    if (message.type === 'hello') {
      hello ??= { nowNs: message.nowNs, at: clock.monotonicTimeNanosUnsafe() };
      return;
    }
    if (message.type === 'devices' || message.type === 'output' || message.id === undefined) return;
    if (ended.has(message.id)) return fail(`${message.type} for resource ${message.id} after its end`);
    if (message.type === 'ready' && message.format !== undefined) formats.set(message.id, message.format);
    if (message.type === 'end' || message.type === 'refused') ended.add(message.id);
    if (message.type === 'gap') {
      const reached = reach.get(message.id);
      if (reached !== undefined && message.fromNs + TOLERANCE < reached) fail(`gap of ${message.id} starts inside audio already sent`);
      if (message.toNs !== undefined && message.toNs < message.fromNs) fail(`gap of ${message.id} ends before it starts`);
      if (message.toNs !== undefined) reach.set(message.id, message.toNs);
    }
  };

  const observeAudio = (audio: HelperAudio): void => {
    const format = formats.get(audio.id);
    if (format === undefined) return fail(`audio for resource ${audio.id} that is not an open capture`);
    if (ended.has(audio.id)) return fail(`audio for resource ${audio.id} after its end`);
    if (audio.pcm.length === 0 || audio.pcm.length % format.channels !== 0) return fail(`audio of ${audio.id} holds partial frames`);
    const reached = reach.get(audio.id);
    if (reached !== undefined && audio.at + TOLERANCE < reached)
      return fail(`audio of ${audio.id} at ${audio.at} overlaps audio before ${reached}`);
    reach.set(audio.id, audio.at + nanosOf(format, audio.pcm.length / format.channels));
  };

  const accept = (
    frame: string | { readonly kind: 'control'; readonly text: string } | { readonly kind: 'audio'; readonly body: Uint8Array },
  ): void => {
    if (typeof frame === 'string') return fail(frame);
    if (frame.kind === 'audio') {
      const audio = readHelperAudio(frame.body);
      if (Result.isFailure(audio)) return fail(audio.failure);
      observeAudio(audio.success);
      Queue.offerUnsafe(inbox, { kind: 'audio', audio: audio.success });
      return;
    }
    const message = readHelper(frame.text);
    if (Result.isFailure(message)) return fail(`the helper sent ${frame.text}: ${message.failure}`);
    observe(message.success);
    Queue.offerUnsafe(inbox, { kind: 'message', message: message.success });
  };

  yield* Effect.forkScoped(
    receiving(socket, (bytes) => {
      for (const frame of reader.push(bytes)) accept(frame.kind === 'broken' ? frame.detail : frame);
    }).pipe(Effect.exit, Effect.andThen(Queue.offer(inbox, { kind: 'eof' }))),
  );

  const bytes = (step: string, data: Uint8Array): Effect.Effect<void, ConformanceFailed> =>
    writer.write(data).pipe(Effect.mapError((cause) => new ConformanceFailed({ step, detail: `write failed: ${String(cause)}` })));

  const send = (step: string, message: ClientMessage): Effect.Effect<void, ConformanceFailed> => bytes(step, encodeClient(message));

  const expect = Effect.fnUntraced(function* <A>(
    step: string,
    match: (received: Received) => A | undefined,
  ): Effect.fn.Return<A, ConformanceFailed> {
    for (;;) {
      const received = yield* Queue.take(inbox).pipe(Effect.mapError(() => new ConformanceFailed({ step, detail: 'the channel ended' })));
      if (violation !== undefined) return yield* new ConformanceFailed({ step, detail: violation });
      const found = match(received);
      if (found !== undefined) return found;
      if (received.kind === 'eof') return yield* new ConformanceFailed({ step, detail: 'the helper closed the channel' });
    }
  });

  const helperNow = (): bigint | undefined => {
    if (hello === undefined) return undefined;
    return hello.nowNs + (clock.monotonicTimeNanosUnsafe() - hello.at);
  };

  const helloNow = (): bigint | undefined => hello?.nowNs;

  const clean = (step: string): Effect.Effect<void, ConformanceFailed> =>
    Effect.suspend(() => (violation === undefined ? Effect.void : Effect.fail(new ConformanceFailed({ step, detail: violation }))));

  return { send, bytes, expect, helperNow, helloNow, clean };
});

export type Probe = Effect.Success<ReturnType<typeof openProbe>>;
