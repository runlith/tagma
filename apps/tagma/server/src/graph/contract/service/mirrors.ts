import { Context, type Effect, type FileSystem } from 'effect';
import type { Git } from '@runlith/git/Git';
import type { MachineStore } from '../../../platform/contract/service/store.js';
import type { Capacity } from '../../../platform/contract/service/capacity.js';
import type { Maintenance } from '../../../platform/contract/service/maintenance.js';
import type { Projects } from '../../../projects/contract/service/registry.js';
import type { ServedGraphs } from './serving.js';
import type { GraphMigrations } from './source.js';

export class Mirrors extends Context.Service<
  Mirrors,
  {
    readonly serve: Effect.Effect<
      void,
      never,
      MachineStore | FileSystem.FileSystem | Projects | ServedGraphs | Git | Capacity | Maintenance | GraphMigrations
    >;
    readonly departed: (projectId: number) => Effect.Effect<void>;
  }
>()('tagma/graph/Mirrors') {}
