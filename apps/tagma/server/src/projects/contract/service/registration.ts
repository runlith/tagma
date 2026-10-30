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

export type GroupRegistry<Group, Left> = {
  readonly make: (
    input: { readonly name: string; readonly projects: readonly string[] },
    lens: ProjectLens,
  ) => Effect.Effect<{ readonly group: Group; readonly returned: boolean }, unknown>;
  readonly rename: (group: string, name: string, lens: ProjectLens) => Effect.Effect<Group, unknown>;
  readonly join: (group: string, project: string, lens: ProjectLens) => Effect.Effect<Group, unknown>;
  readonly leave: (project: string, lens: ProjectLens) => Effect.Effect<Left, unknown>;
  readonly list: (lens: ProjectLens) => Effect.Effect<readonly Group[], unknown>;
  readonly read: (ref: string | undefined, lens: ProjectLens) => Effect.Effect<Group | null, unknown>;
};

export type ProjectRegistry<Row, Removed = Row> = {
  readonly add: (input: ProjectRegistration, lens: ProjectLens) => Effect.Effect<Row, unknown>;
  readonly move: (ref: string, rootPath: string, lens: ProjectLens) => Effect.Effect<Row, unknown>;
  readonly remove: (input: ProjectRemoval, lens: ProjectLens) => Effect.Effect<Removed, unknown>;
  readonly list: (lens: ProjectLens) => Effect.Effect<readonly Row[], unknown>;
  readonly read: (ref: string, lens: ProjectLens) => Effect.Effect<Row, unknown>;
};
