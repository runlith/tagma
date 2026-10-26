import { Context, Effect, Layer, Schema, type Scope } from 'effect';
import type { Format } from '../sound/format.ts';
import type { Track } from '../sound/track.ts';
import type { Player } from './player.ts';
import { DeviceRefused } from './refusal.ts';

export const Source = Schema.Literals(['mic', 'system']);
export type Source = Schema.Schema.Type<typeof Source>;

export const Capabilities = Schema.Struct({
  mic: Schema.Boolean,
  system: Schema.Boolean,
  excludeSelf: Schema.Boolean,
  echoCancel: Schema.Boolean,
  muteOutput: Schema.Boolean,
  permissionPrompt: Schema.Boolean,
});
export type Capabilities = Schema.Schema.Type<typeof Capabilities>;

export const Availability = Schema.Union([
  Schema.TaggedStruct('present', {}),
  Schema.TaggedStruct('absent', { reason: Schema.String, unblock: Schema.Array(Schema.String) }),
]);
export type Availability = Schema.Schema.Type<typeof Availability>;

export const Permission = Schema.Literals(['granted', 'denied', 'not-asked', 'unknown']);
export type Permission = Schema.Schema.Type<typeof Permission>;

export const Permissions = Schema.Struct({ mic: Permission, system: Permission });
export type Permissions = Schema.Schema.Type<typeof Permissions>;

export const Device = Schema.Struct({ id: Schema.String, label: Schema.String });
export type Device = Schema.Schema.Type<typeof Device>;

export const Inventory = Schema.Struct({ inputs: Schema.Array(Device), permissions: Permissions });
export type Inventory = Schema.Schema.Type<typeof Inventory>;

export const OutputKind = Schema.Literals(['speakers', 'headphones', 'unknown']);
export type OutputKind = Schema.Schema.Type<typeof OutputKind>;

export const CaptureRequest = Schema.Struct({
  source: Source,
  device: Schema.optional(Schema.String),
  echoCancel: Schema.Boolean,
});
export type CaptureRequest = Schema.Schema.Type<typeof CaptureRequest>;

export const noCapabilities: Capabilities = {
  mic: false,
  system: false,
  excludeSelf: false,
  echoCancel: false,
  muteOutput: false,
  permissionPrompt: false,
};

export class AudioDevices extends Context.Service<
  AudioDevices,
  {
    readonly capabilities: Capabilities;
    readonly availability: Effect.Effect<Availability>;
    readonly devices: Effect.Effect<Inventory, DeviceRefused>;
    readonly output: Effect.Effect<OutputKind, DeviceRefused>;
    readonly capture: (request: CaptureRequest) => Effect.Effect<Track, DeviceRefused, Scope.Scope>;
    readonly play: (format: Format) => Effect.Effect<Player, DeviceRefused, Scope.Scope>;
    readonly mute: Effect.Effect<void, DeviceRefused, Scope.Scope>;
  }
>()('audio/AudioDevices') {
  static none(reason: string, unblock: ReadonlyArray<string> = []): Layer.Layer<AudioDevices> {
    const refused = Effect.fail(new DeviceRefused({ code: 'unavailable', message: reason, unblock }));
    const absent: Availability = { _tag: 'absent', reason, unblock };
    return Layer.succeed(AudioDevices, {
      capabilities: noCapabilities,
      availability: Effect.succeed(absent),
      devices: refused,
      output: refused,
      capture: () => refused,
      play: () => refused,
      mute: refused,
    });
  }
}
