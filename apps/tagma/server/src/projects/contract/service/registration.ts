import type { Effect } from 'effect';
import type { StorageMode } from '../wire/project.js';

export type ProjectLens = { readonly cwd?: string; readonly project?: string };

export type ProjectRegistration = {
  readonly name: string;
  readonly rootPath: string;
  readonly strictProvenance: boolean;
  readonly private: boolean;
  readonly storage?: StorageMode;
  readonly graphRemote?: string;
};

export type ProjectRemoval = { readonly ref: string; readonly unlink: boolean };

export type ProjectRegistry<Row, Removed = Row> = {
  readonly add: (input: ProjectRegistration, lens: ProjectLens) => Effect.Effect<Row, unknown>;
  readonly move: (ref: string, rootPath: string, lens: ProjectLens) => Effect.Effect<Row, unknown>;
  readonly remove: (input: ProjectRemoval, lens: ProjectLens) => Effect.Effect<Removed, unknown>;
  readonly list: (lens: ProjectLens) => Effect.Effect<readonly Row[], unknown>;
  readonly read: (ref: string, lens: ProjectLens) => Effect.Effect<Row, unknown>;
};
