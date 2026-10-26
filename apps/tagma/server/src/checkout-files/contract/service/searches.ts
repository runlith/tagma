import { Context, type Stream } from 'effect';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { ProjectRoot } from '../../../workspace/contract/wire/coverage.js';
import type { SearchFrame } from '../wire/search.js';

export type SearchRefusal = 'search-failed' | 'search-unavailable' | 'search-superseded';

export type SearchAsk = {
  readonly pattern: string;
  readonly regex: boolean;
  readonly caseSensitive: boolean;
  readonly wholeWord: boolean;
  readonly include: readonly string[];
  readonly exclude: readonly string[];
};

export class Searches extends Context.Service<
  Searches,
  {
    run(place: ProjectRoot, ask: SearchAsk): Stream.Stream<SearchFrame, GateRefusal<SearchRefusal>>;
  }
>()('tagma/checkout-files/Searches') {}
