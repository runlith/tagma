import { Context, type Effect } from 'effect';
import type { FrozenState } from '../wire/builds.js';

export class FrozenBuilds extends Context.Service<
  FrozenBuilds,
  {
    readonly state: Effect.Effect<FrozenState>;
  }
>()('tagma/installation/FrozenBuilds') {}
