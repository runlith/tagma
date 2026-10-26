import { Context, type Effect } from 'effect';
import type { GraphChanges } from '../../../graph/contract/wire/branchChanges.js';

export type BranchGraphChanges = (
  projectId: number,
  at: { readonly checkout: string; readonly branch: string; readonly base: string },
) => Effect.Effect<GraphChanges>;

export class GraphChanging extends Context.Service<GraphChanging, BranchGraphChanges>()('tagma/landing/GraphChanging') {}
