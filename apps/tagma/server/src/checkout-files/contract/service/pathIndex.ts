import { Context, type Effect } from 'effect';
import type { GateRefusal, GitRefusal } from '../../../platform/contract/wire/refusal.js';
import type { RootRefusal } from '../../../workspace/contract/wire/refusals.js';
import type { ProjectRoot } from '../../../workspace/contract/wire/coverage.js';
import type { FoundFile } from '../wire/paths.js';

export type FindAsk = {
  readonly query: string;
  readonly limit: number;
  readonly recent: readonly string[];
};

export type Found = { readonly files: readonly FoundFile[]; readonly matched: number };

export class PathIndex extends Context.Service<
  PathIndex,
  {
    find(
      place: ProjectRoot,
      ask: FindAsk,
    ): Effect.Effect<Found, GateRefusal<GitRefusal | RootRefusal | 'worker-unavailable' | 'index-lost' | 'superseded'>>;
  }
>()('tagma/checkout-files/PathIndex') {}
