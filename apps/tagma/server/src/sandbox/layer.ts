import { Context, Effect, Layer } from 'effect';
import { join } from 'node:path';
import { MachineStore, storeDirectory } from '../platform/contract/service/store.js';
import type { MachineUnits } from '../platform/contract/service/units.js';
import { Projects } from '../projects/contract/service/registry.js';
import { SandboxEnvironment } from './contract/service/environment.js';
import { SandboxHolds } from './contract/service/holds.js';
import { GuestPreparation } from './contract/service/preparation.js';
import { GuestWorlds } from './contract/service/guests.js';
import { GuestInstallation, InstallationLabel } from './contract/service/installation.js';
import { PreparedTrees } from './contract/service/preparedTrees.js';
import { SandboxFiles } from './contract/service/files.js';
import { Sandboxes } from './contract/service/sandboxes.js';
import { makeDockerGuests } from './engine/docker/backend.js';
import { makeDockerPreparation } from './engine/docker/preparation.js';
import { makeGuestEnvironment } from './guests/environment.js';
import { guestPreparation, makeSandboxes } from './guests/lease.js';
import { liveGuests } from './guests/live.js';
import { LiveGuests } from '../executions/contract/service/guests.js';
import { makePreparedTreeStore } from './store/preparedTrees.js';
import { makeSandboxStore } from './store/sandboxes.js';
import { makePreparedTrees } from './trees/preparedTrees.js';

export type SandboxServices =
  | Sandboxes
  | GuestWorlds
  | SandboxFiles
  | PreparedTrees
  | GuestPreparation
  | InstallationLabel
  | SandboxEnvironment
  | LiveGuests;

export const sandboxLayer: Layer.Layer<SandboxServices, never, MachineStore | MachineUnits | Projects | SandboxHolds | GuestInstallation> =
  Layer.effectContext(
    Effect.gen(function* () {
      const { installation } = yield* GuestInstallation;
      const { path } = yield* MachineStore;
      const projects = yield* Projects;
      const checkoutOf = (projectId: number) => projects.byId(projectId).pipe(Effect.map((project) => project.rootPath));
      const preparedTrees = makePreparedTrees({
        store: yield* makePreparedTreeStore,
        preparation: makeDockerPreparation({ installation: path, closure: installation }),
        checkoutOf,
        storageRoot: join(storeDirectory(path), 'preparedTrees'),
      });
      const store = yield* makeSandboxStore;
      const runtime = makeDockerGuests({ installation: path, closure: installation });
      const services = yield* makeSandboxes({ store, runtime, checkoutOf, exportsRoot: join(storeDirectory(path), 'sandboxes') }).pipe(
        Effect.provideService(PreparedTrees, preparedTrees),
      );
      const backend = yield* makeGuestEnvironment({ store, guests: runtime }).pipe(
        Effect.provideService(Sandboxes, Context.get(services, Sandboxes)),
      );
      return Context.merge(
        services,
        Context.make(PreparedTrees, preparedTrees).pipe(
          Context.add(GuestPreparation, guestPreparation(checkoutOf)),
          Context.add(InstallationLabel, { id: path }),
          Context.add(SandboxEnvironment, { backend }),
          Context.add(LiveGuests, liveGuests(store)),
        ),
      );
    }),
  );
