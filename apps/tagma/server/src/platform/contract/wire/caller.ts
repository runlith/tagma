import type { Actor } from './actor.js';

export type FileReach = {
  readonly path: string;
  readonly resolve: (candidate: string) => string;
};

export type Caller = {
  readonly actor: Actor;
  readonly files: FileReach | null;
};
