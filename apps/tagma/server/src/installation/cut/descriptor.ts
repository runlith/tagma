import type { BunPlugin } from 'bun';
import type { Effect, FileSystem } from 'effect';
import type { ChildProcessSpawner } from 'effect/process';
import type { Git } from '@runlith/git/Git';
import type { OwnStore } from '../../platform/contract/service/ownStore.js';
import type { Applications } from '../contract/service/applications.js';
import type { Channel } from '../contract/wire/channel.js';
import type { Feed } from '../contract/wire/feed.js';
import type { ReleaseRecord } from './stage.js';

export type CutMachine = FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner | Git;

type SourceRoots = {
  readonly checkout: string;
  readonly server: string;
  readonly packages: string;
  readonly desktop: string;
};

type Client = { readonly root: string; readonly config: string | null };

export type PublishTrouble = { readonly detail: string; readonly unblock: readonly string[] };

type Publication = {
  readonly record: ReleaseRecord;
  readonly home: string;
  readonly files: readonly string[];
  readonly feed: Feed;
  readonly notes: string;
};

export type Publisher = {
  readonly place: string;
  readonly latest: Effect.Effect<Feed | null, PublishTrouble, CutMachine>;
  readonly address: (release: string, file: string) => string;
  readonly publish: (publication: Publication) => Effect.Effect<{ readonly page: string | null }, PublishTrouble, CutMachine>;
};

export type Distribution = {
  readonly conditions: readonly string[];
  readonly applications: Applications;
  readonly roots: SourceRoots;
  readonly entries: { readonly cli: string; readonly server: string };
  readonly client: Client;
  readonly brand: { readonly assets: string };
  readonly signing: { readonly notary: string };
  readonly plugins: readonly BunPlugin[];
  readonly feed: string | null;
  readonly publisher: Publisher | null;
  readonly workshop: Channel;
};

type Steps = {
  readonly graph: readonly string[];
  readonly journal: readonly string[];
};

export type Composition = Distribution & {
  readonly channel: Channel;
  readonly steps: Steps;
  readonly stores: readonly OwnStore[];
};
