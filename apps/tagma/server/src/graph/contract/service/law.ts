import { Context, type Effect } from 'effect';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { ModuleCard } from '../wire/modules.js';

export type MapProblem = { readonly key: string; readonly problem: string };

export type LawReading = {
  readonly undeclared: (key: string) => string | null;
  readonly mapProblems: (keys: readonly string[], cards: readonly ModuleCard[]) => readonly MapProblem[];
};

export class ProjectLaw extends Context.Service<
  ProjectLaw,
  {
    read(at: { readonly projectId: number; readonly root: string }): Effect.Effect<LawReading, GateRefusal<'inspection-failed'>>;
  }
>()('tagma/graph/ProjectLaw') {}
