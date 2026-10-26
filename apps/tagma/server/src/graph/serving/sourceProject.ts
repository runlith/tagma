import { Effect, Layer } from 'effect';
import { placeAt } from '../../projects/identity.js';
import { ProjectIdentification, Projects } from '../../projects/contract/service/registry.js';
import type { ProjectPlace } from '../../projects/contract/wire/project.js';
import { GraphSource, SourceProject } from '../contract/service/source.js';

type Identity = { readonly revision: number; readonly place: ProjectPlace };

export const sourceProjectLayer: Layer.Layer<SourceProject, never, GraphSource | Projects | ProjectIdentification> = Layer.effect(
  SourceProject,
  Effect.gen(function* () {
    const { sourcePath, originPath } = yield* GraphSource;
    const projects = yield* Projects;
    const identification = yield* ProjectIdentification;
    const places: readonly string[] = originPath === undefined ? [sourcePath] : [sourcePath, originPath];
    const identified = new Map<string, Identity>();

    const identity = Effect.fn('SourceProject.identity')(function* (at: string) {
      const revision = yield* projects.registryVersion;
      const known = identified.get(at);
      if (known?.revision === revision) return known.place;
      const here = yield* placeAt(at).pipe(Effect.provideService(ProjectIdentification, identification));
      if (here !== undefined) identified.set(at, { revision, place: here });
      return here;
    });

    const place = Effect.fn('SourceProject.place')(function* () {
      for (const at of places) {
        const here = yield* identity(at);
        const project = yield* projects.resolve(undefined, here);
        if (project !== undefined) return { project, place: at };
      }
      return undefined;
    });

    return SourceProject.of({
      place,
      project: Effect.fn('SourceProject.project')(function* () {
        return (yield* place())?.project;
      }),
    });
  }),
);
