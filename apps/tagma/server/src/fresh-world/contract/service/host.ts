import { Data, type Effect } from 'effect';
import type { InstallationPlatform } from '../../../installation/contract/wire/manifest.js';

export class HostFailed extends Data.TaggedError('HostFailed')<{ readonly message: string }> {}

export type FreshProcess = { readonly pid: number; readonly executable: string };

export type FreshPlace = { readonly home: string; readonly tmp: string };

export type FreshHost = {
  readonly platform: Effect.Effect<InstallationPlatform, HostFailed>;
  readonly image: (image: string, into: string) => Effect.Effect<string, HostFailed>;
  readonly place: (bundle: string, into: string) => Effect.Effect<string, HostFailed>;
  readonly version: (bundle: string) => Effect.Effect<string, HostFailed>;
  readonly keychain: (place: FreshPlace) => Effect.Effect<void, HostFailed>;
  readonly launch: (bundle: string, place: FreshPlace, running: boolean) => Effect.Effect<void, HostFailed>;
  readonly processes: (root: string) => Effect.Effect<readonly FreshProcess[], HostFailed>;
  readonly signal: (pids: readonly number[], signal: 'SIGTERM' | 'SIGKILL') => Effect.Effect<void>;
  readonly quit: (bundle: string, place: FreshPlace) => Effect.Effect<string | null>;
  readonly window: (bundle: string) => string;
  readonly forget: (bundle: string) => Effect.Effect<void, HostFailed>;
  readonly unregister: (root: string) => Effect.Effect<void, HostFailed>;
};
