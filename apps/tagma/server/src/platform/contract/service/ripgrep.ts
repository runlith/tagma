import { Context, type Effect } from 'effect';
import type { GateRefusal } from '../wire/refusal.js';

export class RipgrepBinary extends Context.Service<
  RipgrepBinary,
  {
    path(): Effect.Effect<string, GateRefusal<'search-unavailable'>>;
  }
>()('tagma/platform/RipgrepBinary') {}
