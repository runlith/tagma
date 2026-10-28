import { Context, type Effect } from 'effect';
import type { GraphStore, MachineStore, StoreFailure } from '../../../platform/contract/service/store.js';
import type { WriterRegister } from '../../../platform/contract/service/writers.js';
import type { FloorRefusal, GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { ProjectRow } from '../../../projects/contract/wire/project.js';
import type { BlockRows } from '../../acts/rows.js';
import type { Act, BlockNames, BlockProjection, BlockReferences, SearchUncounted } from './acts.js';
import type { Tags } from './vocabulary.js';
import type { Git } from '@runlith/git/Git';
import type { FileSystem } from 'effect';

export type StepServices = GraphStore | Act | BlockNames | BlockProjection | BlockReferences | BlockRows | Tags | WriterRegister;

export type GraphStep = {
  readonly id: string;
  readonly mirror?: boolean;
  readonly run: (
    project: ProjectRow,
  ) => Effect.Effect<void, StoreFailure | SearchUncounted | GateRefusal<FloorRefusal | 'no-root' | 'not-found' | 'deleted'>, StepServices>;
};

export type GraphBase = { readonly step: string; readonly release: string };

export type StepStanding = 'current' | 'behind' | 'newer' | 'older';

export class GraphSteps extends Context.Service<
  GraphSteps,
  {
    readonly prepareStorage: Effect.Effect<void, GateRefusal<'graph-pool'>, MachineStore | Git | FileSystem.FileSystem>;
    readonly last: string;
    readonly base: GraphBase | null;
    readonly standing: (reached: string | null) => StepStanding;
    readonly mirror: readonly string[];
    readonly after: (reached: string | null, mirrored?: readonly string[]) => readonly GraphStep[];
    readonly lower: (one: string | null, other: string | null) => string | null | undefined;
  }
>()('graph/GraphSteps') {}
