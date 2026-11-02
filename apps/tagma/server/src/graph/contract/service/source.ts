import { Context, type Effect } from 'effect';
import type { MigrationChain, StoreFailure } from '../../../platform/contract/service/store.js';
import type { ProcessProvenance } from '../../../platform/contract/wire/provenance.js';
import type { GateRefusal, GitRefusal } from '../../../platform/contract/wire/refusal.js';
import type { ProjectRow } from '../../../projects/contract/wire/project.js';

export class GraphSource extends Context.Service<
  GraphSource,
  {
    readonly sourcePath: string;
    readonly originPath?: string;
    readonly codePath?: string;
    readonly source?: ProcessProvenance;
  }
>()('tagma/graph/GraphSource') {}

export type SourcePlace = { readonly project: ProjectRow; readonly place: string };

export type SourceRefusal = 'unknown-project' | 'ambiguous-project' | 'not-found' | 'graph-pool' | 'graph-unmerged' | GitRefusal;

export class SourceProject extends Context.Service<
  SourceProject,
  {
    project(): Effect.Effect<ProjectRow | undefined, StoreFailure | GateRefusal<SourceRefusal>>;
    place(): Effect.Effect<SourcePlace | undefined, StoreFailure | GateRefusal<SourceRefusal>>;
  }
>()('tagma/graph/SourceProject') {}

export class GraphMigrations extends Context.Service<GraphMigrations, MigrationChain<'graph'>>()('tagma/graph/GraphMigrations') {}
