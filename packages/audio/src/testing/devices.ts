import { Deferred, Effect, Layer, type Scope, Stream } from 'effect';
import {
  AudioDevices,
  type Availability,
  type Capabilities,
  type CaptureRequest,
  type Inventory,
  type OutputKind,
} from '../port/devices.ts';
import type { MarkOutcome, Player } from '../port/player.ts';
import type { DeviceRefused } from '../port/refusal.ts';
import type { Chunk } from '../sound/chunk.ts';
import { captureFormat, type Format } from '../sound/format.ts';
import type { Gap } from '../sound/gap.ts';
import { type EndReason, ended, type Sound, type Track } from '../sound/track.ts';

export type ScriptedTrack = {
  readonly format?: Format;
  readonly sounds: ReadonlyArray<Chunk | Gap> | Stream.Stream<Chunk | Gap>;
  readonly tail?: ReadonlyArray<Chunk>;
  readonly ending?: EndReason;
};

export type DeviceScript = {
  readonly capabilities?: Capabilities;
  readonly availability?: Availability;
  readonly inventory?: Inventory;
  readonly output?: OutputKind | DeviceRefused;
  readonly capture?: (request: CaptureRequest, index: number) => ScriptedTrack | DeviceRefused;
  readonly play?: (format: Format) => DeviceRefused | undefined;
  readonly mute?: () => DeviceRefused | undefined;
};

export type CaptureRecord = { readonly request: CaptureRequest; outcome: 'open' | 'drained' | 'aborted' | EndReason };
export type PlayerRecord = {
  readonly format: Format;
  readonly written: Array<Int16Array>;
  readonly marks: Array<string>;
  clears: number;
  released: boolean;
};

const everything: Capabilities = {
  mic: true,
  system: true,
  excludeSelf: true,
  echoCancel: true,
  muteOutput: true,
  permissionPrompt: false,
};

export const makeFakeDevices = (script: DeviceScript = {}) => {
  const captures: Array<CaptureRecord> = [];
  const players: Array<PlayerRecord> = [];
  let muted = 0;

  const capture = Effect.fnUntraced(function* (request: CaptureRequest): Effect.fn.Return<Track, DeviceRefused, Scope.Scope> {
    const scripted = script.capture?.(request, captures.length) ?? { sounds: [] };
    if ('_tag' in scripted) return yield* Effect.fail(scripted);
    const record: CaptureRecord = { request, outcome: 'open' };
    captures.push(record);
    const closing = Deferred.makeUnsafe<'drained' | 'aborted'>();
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        if (record.outcome === 'open') record.outcome = 'aborted';
        yield* Deferred.succeed(closing, 'aborted');
      }),
    );
    const given = scripted.sounds;
    const sounds: Stream.Stream<Sound> =
      'pipe' in given ? given.pipe(Stream.interruptWhen(Deferred.await(closing))) : Stream.fromIterable(given);
    const ending: Stream.Stream<Sound> =
      scripted.ending !== undefined
        ? Stream.sync(() => {
            record.outcome = scripted.ending!;
            return ended(scripted.ending!);
          })
        : Stream.unwrap(
            Effect.map(Deferred.await(closing), (how): Stream.Stream<Sound> => {
              record.outcome = how;
              const tail = how === 'drained' ? (scripted.tail ?? []) : [];
              return Stream.concat(Stream.fromIterable<Sound>(tail), Stream.make(ended(how)));
            }),
          );
    return {
      format: scripted.format ?? captureFormat,
      chunks: Stream.concat(sounds, ending),
      end: Effect.asVoid(Deferred.succeed(closing, 'drained')),
    };
  });

  const play = Effect.fnUntraced(function* (format: Format): Effect.fn.Return<Player, DeviceRefused, Scope.Scope> {
    const refused = script.play?.(format);
    if (refused !== undefined) return yield* Effect.fail(refused);
    const record: PlayerRecord = { format, written: [], marks: [], clears: 0, released: false };
    players.push(record);
    yield* Effect.addFinalizer(() => Effect.sync(() => (record.released = true)));
    return {
      format,
      write: (pcm) => Effect.sync(() => void record.written.push(pcm)),
      mark: (mark) =>
        Effect.sync(() => {
          record.marks.push(mark);
          return Effect.succeed<MarkOutcome>('played');
        }),
      clear: Effect.sync(() => void record.clears++),
    };
  });

  const service = AudioDevices.of({
    capabilities: script.capabilities ?? everything,
    availability: Effect.succeed(script.availability ?? { _tag: 'present' }),
    devices: Effect.succeed(
      script.inventory ?? { inputs: [{ id: 'fake', label: 'Fake input' }], permissions: { mic: 'granted', system: 'granted' } },
    ),
    output: Effect.suspend(() => {
      const output = script.output ?? 'unknown';
      return typeof output === 'string' ? Effect.succeed(output) : Effect.fail(output);
    }),
    capture,
    play,
    mute: Effect.suspend(() => {
      const refused = script.mute?.();
      if (refused !== undefined) return Effect.fail(refused);
      muted++;
      return Effect.addFinalizer(() => Effect.sync(() => muted--));
    }),
  });

  return {
    captures,
    players,
    layer: Layer.succeed(AudioDevices, service),
    get muted() {
      return muted;
    },
  };
};

export type FakeDevices = ReturnType<typeof makeFakeDevices>;
