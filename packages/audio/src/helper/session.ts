import { type Clock, Data, Deferred, Effect, Exit, Result, Scope } from 'effect';
import type { Socket } from 'effect/socket/Socket';
import { receiving } from './channel.ts';
import type { Inventory, OutputKind } from '../port/devices.ts';
import type { MarkOutcome } from '../port/player.ts';
import { DeviceRefused, rebuildHost } from '../port/refusal.ts';
import type { Format } from '../sound/format.ts';
import { type Gap, gap } from '../sound/gap.ts';
import type { EndReason } from '../sound/track.ts';
import { encodeClient, type Frame, FrameReader, readHelper, readHelperAudio } from './frame.ts';
import type { ClientMessage, HelperMessage, HelperRefusal } from './messages.ts';

export interface Resource {
  readonly ready: (format: Format | undefined) => string | undefined;
  readonly refused: (refusal: DeviceRefused) => string | undefined;
  readonly gap: (gap: Gap) => string | undefined;
  readonly end: (reason: EndReason) => string | undefined;
  readonly played: (ms: number) => string | undefined;
  readonly marked: (mark: string, outcome: MarkOutcome) => string | undefined;
  readonly audio: (at: bigint, pcm: Int16Array) => string | undefined;
  readonly lost: (now: bigint, failure: DeviceRefused) => void;
}

const unblocks: Readonly<Record<HelperRefusal, ReadonlyArray<string>>> = {
  'permission-denied': ['allow the host application to record audio in the system privacy settings'],
  'device-missing': ['choose another input device'],
  unsupported: [],
  'helper-mismatch': [rebuildHost],
  'device-failed': [],
};

export class HelperViolation extends Data.TaggedError('HelperViolation')<{ readonly detail: string }> {}

export type Writer = (bytes: Uint8Array) => Effect.Effect<void, unknown>;

export const mismatch = (detail: string): DeviceRefused =>
  new DeviceRefused({ code: 'helper-mismatch', message: `the audio helper speaks another protocol: ${detail}`, unblock: [rebuildHost] });

export const helperGone = (): DeviceRefused => new DeviceRefused({ code: 'unavailable', message: 'the audio helper exited', unblock: [] });

export const makeSession = ({
  scope,
  write,
  clock,
  token,
  hello,
}: {
  readonly scope: Scope.Closeable;
  readonly write: Writer;
  readonly clock: Clock.Clock;
  readonly token: string;
  readonly hello: Deferred.Deferred<void, DeviceRefused>;
}) => {
  const resources = new Map<number, Resource>();
  const inventories: Array<Deferred.Deferred<Inventory, DeviceRefused>> = [];
  const outputs: Array<Deferred.Deferred<OutputKind, DeviceRefused>> = [];
  const reader = new FrameReader();
  let nextId = 1;
  let offset = 0n;
  let opened = false;
  let ended = false;
  let broken: DeviceRefused | undefined;
  let holders = 0;

  const live = (): boolean => !ended;

  const failure = (): DeviceRefused => broken ?? helperGone();

  const now = (): bigint => clock.monotonicTimeNanosUnsafe();

  const allocate = (resource: Resource): number => {
    const id = nextId++;
    resources.set(id, resource);
    return id;
  };

  const enter = (): void => {
    holders++;
  };

  const leave = (): number => --holders;

  const held = (): number => holders;

  const lose = (): void => {
    if (ended) return;
    ended = true;
    const gone = failure();
    Deferred.doneUnsafe(hello, Effect.fail(gone));
    for (const answer of inventories.splice(0)) Deferred.doneUnsafe(answer, Effect.fail(gone));
    for (const answer of outputs.splice(0)) Deferred.doneUnsafe(answer, Effect.fail(gone));
    const at = now();
    for (const resource of resources.values()) resource.lost(at, gone);
    resources.clear();
  };

  const cut = (error: unknown): Effect.Effect<never, DeviceRefused> =>
    Effect.suspend(() => {
      if (!ended) {
        broken = new DeviceRefused({
          code: 'unavailable',
          message: `the channel to the audio helper failed: ${String(error)}`,
          unblock: [],
        });
        lose();
      }
      return Effect.forkDetach(Scope.close(scope, Exit.void)).pipe(Effect.andThen(Effect.fail(failure())));
    });

  const sendBytes = (bytes: Uint8Array): Effect.Effect<void, DeviceRefused> => {
    if (ended) return Effect.fail(failure());
    return write(bytes).pipe(Effect.catch(cut));
  };

  const send = (message: ClientMessage): Effect.Effect<void, DeviceRefused> => sendBytes(encodeClient(message));

  const inventory = Effect.fnUntraced(function* () {
    const answer = yield* Deferred.make<Inventory, DeviceRefused>();
    inventories.push(answer);
    yield* send({ type: 'devices' });
    return yield* Deferred.await(answer);
  });

  const output = Effect.fnUntraced(function* () {
    const answer = yield* Deferred.make<OutputKind, DeviceRefused>();
    outputs.push(answer);
    yield* send({ type: 'output' });
    return yield* Deferred.await(answer);
  });

  const control = (message: HelperMessage): string | DeviceRefused | undefined => {
    if (message.type === 'hello') {
      if (opened) return 'a second hello';
      if (message.token !== token) {
        return new DeviceRefused({
          code: 'unavailable',
          message: 'a process with a foreign token answered on the helper channel',
          unblock: [],
        });
      }
      offset = now() - message.nowNs;
      opened = true;
      Deferred.doneUnsafe(hello, Effect.void);
      return undefined;
    }
    if (!opened) return `${message.type} before hello`;
    if (message.type === 'devices') {
      const answer = inventories.shift();
      if (answer === undefined) return 'devices nobody asked for';
      Deferred.doneUnsafe(answer, Effect.succeed({ inputs: message.list, permissions: message.permissions }));
      return undefined;
    }
    if (message.type === 'output') {
      const answer = outputs.shift();
      if (answer === undefined) return 'an output nobody asked for';
      Deferred.doneUnsafe(answer, Effect.succeed(message.kind));
      return undefined;
    }
    const id = message.id;
    if (id === undefined) return `the helper refused a message: ${message.type === 'refused' ? message.message : message.type}`;
    const resource = resources.get(id);
    if (resource === undefined) return `${message.type} for unknown resource ${id}`;
    switch (message.type) {
      case 'ready':
        return resource.ready(message.format);
      case 'refused':
        resources.delete(id);
        return resource.refused(new DeviceRefused({ code: message.code, message: message.message, unblock: unblocks[message.code] }));
      case 'gap':
        if (message.toNs !== undefined && message.toNs < message.fromNs) return `a gap of ${id} ends before it starts`;
        return resource.gap(gap(message.fromNs + offset, message.toNs === undefined ? undefined : message.toNs + offset, message.cause));
      case 'end':
        resources.delete(id);
        return resource.end(message.reason);
      case 'played':
        return resource.played(message.ms);
      case 'marked':
        return resource.marked(message.mark, message.outcome);
    }
  };

  const framed = (frame: Frame): string | DeviceRefused | undefined => {
    if (frame.kind === 'broken') return frame.detail;
    if (frame.kind === 'audio') {
      if (!opened) return 'audio before hello';
      const audio = readHelperAudio(frame.body);
      if (Result.isFailure(audio)) return audio.failure;
      const resource = resources.get(audio.success.id);
      if (resource === undefined) return `audio for unknown resource ${audio.success.id}`;
      return resource.audio(audio.success.at + offset, audio.success.pcm);
    }
    const message = readHelper(frame.text);
    if (Result.isFailure(message)) return message.failure;
    return control(message.success);
  };

  const receive = (bytes: Uint8Array): Effect.Effect<void, HelperViolation> | void => {
    if (ended) return;
    for (const frame of reader.push(bytes)) {
      const problem = framed(frame);
      if (problem !== undefined) {
        broken = typeof problem === 'string' ? mismatch(problem) : problem;
        lose();
        return Effect.fail(new HelperViolation({ detail: broken.message }));
      }
    }
  };

  const run = (socket: Socket): Effect.Effect<void> =>
    receiving(socket, receive).pipe(
      Effect.exit,
      Effect.flatMap(() => {
        lose();
        return Effect.forkDetach(Scope.close(scope, Exit.void));
      }),
      Effect.asVoid,
    );

  return { scope, live, allocate, enter, leave, held, send, sendBytes, inventory, output, run, lose };
};

export type Session = ReturnType<typeof makeSession>;
