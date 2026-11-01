import { Context, Effect, Queue, Stream } from 'effect';
import { lazyLayer, liveOf, manifest } from '../platform/contract/service/manifest.js';
import { projectsVerbs } from './cli.js';
import { ProjectChanges } from './contract/service/changes.js';
import type { ProjectsLive } from './contract/service/live.js';
import { Projects } from './contract/service/registry.js';
import type { RegistryRevision } from './contract/wire/feed.js';
import { projects as declaration } from './contract/wire/module.js';

const live: ProjectsLive = liveOf(declaration.feeds, (door) => {
  const projects = Context.get(door, Projects);
  const changes = Context.get(door, ProjectChanges);
  return {
    'projects.subscribe': () =>
      Stream.callback<RegistryRevision>(
        (queue) => {
          const current = Effect.flatMap(projects.registryVersion, (revision) => Queue.offer(queue, { revision }));
          return Effect.acquireRelease(
            Effect.sync(() => changes.changed.subscribe(current)),
            (unsubscribe) => Effect.sync(unsubscribe),
          ).pipe(Effect.andThen(current));
        },
        { bufferSize: 1, strategy: 'sliding' },
      ),
  };
});

export const projects = manifest({
  ...declaration,
  verbs: projectsVerbs,
  live,
  tables: async () => {
    const [{ project, groupMember }] = await Promise.all([import('./store/table.js')]);
    return { entities: [project, groupMember], history: [] };
  },
  lifetimes: {
    installation: lazyLayer(
      () => import('./registration.js'),
      ({ projectsLayer }) => projectsLayer,
    ),
  },
});
