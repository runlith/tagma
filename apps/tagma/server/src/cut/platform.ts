import { Data, type Effect, type FileSystem, type Layer } from 'effect';
import type { ChildProcessSpawner } from 'effect/process';
import type { Processes } from '@runlith/execution-host/ProcessReader';
import type { Channel } from '../installation/contract/wire/channel.js';
import type { FeedRelease } from '../installation/contract/wire/feed.js';
import type { Label } from './proof.js';
import type { ReleaseRecord } from './stage.js';
import type { Target } from './target.js';

type Machine = FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner;

export type PlatformTrouble = { readonly detail: string; readonly unblock: readonly string[] };

export type Signer = { readonly fingerprint: string; readonly name: string; readonly created: boolean };

export class NotarizationRefused extends Data.TaggedError('NotarizationRefused')<PlatformTrouble> {}

export type Notary = {
  readonly seal: (cut: string, into: string, record: ReleaseRecord) => Effect.Effect<ReleaseRecord, NotarizationRefused>;
};

export type Trial = {
  readonly channel: Channel;
  readonly archive: string;
  readonly offer: FeedRelease;
  readonly predecessor: string | null;
  readonly labels: readonly Label[];
  readonly scratch: string;
  readonly log: (line: string) => void;
  readonly processes: Layer.Layer<Processes>;
};

export type ReleasePlatform = {
  readonly refusal: (os: string) => string | null;
  readonly application: (channel: string) => { readonly bundle: string; readonly binary: string };
  readonly signer: Effect.Effect<Signer, PlatformTrouble, Machine>;
  readonly releaseSigner: (team: string | null) => Effect.Effect<Signer, PlatformTrouble, Machine>;
  readonly notice: (signer: Signer) => string;
  readonly seal: (root: string, identity: string, apart: readonly string[]) => Effect.Effect<void, string>;
  readonly targets: readonly Target[];
  readonly native: () => Target | null;
  readonly trouble: (target: Target, cwd: string) => Effect.Effect<PlatformTrouble | null, never, ChildProcessSpawner.ChildProcessSpawner>;
  readonly runtime: (target: Target) => string;
  readonly speech: readonly string[];
  readonly pack: (root: string, archive: string, entry: string) => Effect.Effect<void, string, ChildProcessSpawner.ChildProcessSpawner>;
  readonly image: {
    readonly name: (channel: Channel, release: string, target: Target) => string;
    readonly make: (
      application: string,
      image: string,
      assets: string,
      volume: string,
      signer: Signer,
    ) => Effect.Effect<void, string, Machine>;
  };
  readonly notary: (signer: Signer, assets: string, profile: string) => Effect.Effect<Notary, PlatformTrouble, Machine>;
  readonly trial: (trial: Trial) => Effect.Effect<string | null>;
};
