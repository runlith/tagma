import { Context, type Effect } from 'effect';
import type { BackgroundWork } from '../wire/background.js';

export type BackgroundDeclaration = {
  readonly title: string;
  readonly reason: string;
  readonly total: number | null;
};

export type BackgroundProgress = {
  readonly stage: (reason: string) => Effect.Effect<void>;
  readonly advance: (count?: number) => Effect.Effect<void>;
};

export class Background extends Context.Service<
  Background,
  {
    readonly run: <A, E, R>(
      declared: BackgroundDeclaration,
      work: (progress: BackgroundProgress) => Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E, R>;
    readonly standing: Effect.Effect<readonly BackgroundWork[]>;
  }
>()('tagma/platform/Background') {}
