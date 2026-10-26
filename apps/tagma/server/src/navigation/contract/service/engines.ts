import { Context, type Effect } from 'effect';
import type { EngineReading } from '../wire/engines.js';

export const QueryProject = Context.Reference<number | null>('tagma/navigation/QueryProject', { defaultValue: () => null });

export class EngineStates extends Context.Service<
  EngineStates,
  {
    read(limit: number): Effect.Effect<EngineReading>;
  }
>()('tagma/navigation/EngineStates') {}
