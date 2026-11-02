import { Effect, Layer } from 'effect';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { placeAt } from '../../projects/identity.js';
import { ProjectIdentification, Projects } from '../../projects/contract/service/registry.js';
import type { ProjectPlace } from '../../projects/contract/wire/project.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { GraphSource, SourceProject, type SourcePlace } from '../contract/service/source.js';
import { RoutedGraphs } from '../contract/service/serving.js';
import { CHECKOUT_DIRECTORY } from '../contract/wire/storage.js';
import { farKey } from '../contract/wire/far.js';
import { LIFECYCLE } from '../contract/wire/tags/lifecycle.js';
import { graphRootIn } from '../tree/layout.js';
import { refused } from './refusal.js';

type Identity = { readonly revision: number; readonly place: ProjectPlace };

type Carried = { readonly repository: string; readonly root: string };

const repositoryOf = (path: string): string | undefined => {
  for (let at = path; ; at = dirname(at)) {
    if (existsSync(join(at, '.git'))) return realpathSync(at);
    if (dirname(at) === at) return undefined;
  }
};

export const sourceProjectLayer: Layer.Layer<SourceProject, never, GraphSource | Projects | ProjectIdentification> = Layer.effect(
  SourceProject,
  Effect.gen(function* () {
    const { sourcePath, originPath, codePath } = yield* GraphSource;
    const projects = yield* Projects;
    const identification = yield* ProjectIdentification;
    const places: readonly string[] = originPath === undefined ? [sourcePath] : [sourcePath, originPath];
    const identified = new Map<string, Identity>();
    let carried: Carried | undefined;
    let holder: { readonly revision: number; readonly place: SourcePlace | undefined } | undefined;

    const identity = Effect.fn('SourceProject.identity')(function* (at: string) {
      const revision = yield* projects.registryVersion;
      const known = identified.get(at);
      if (known?.revision === revision) return known.place;
      const here = yield* placeAt(at).pipe(Effect.provideService(ProjectIdentification, identification));
      if (here !== undefined) identified.set(at, { revision, place: here });
      return here;
    });

    const byPath = Effect.fn('SourceProject.byPath')(function* (at: string) {
      const project = yield* projects.resolve(undefined, yield* identity(at));
      return project === undefined ? undefined : ({ project, place: at } satisfies SourcePlace);
    });

    const carriedGraph = Effect.fn('SourceProject.carriedGraph')(function* (code: string) {
      if (carried !== undefined) return carried;
      const repository = repositoryOf(code);
      if (repository === undefined) return undefined;
      const root = yield* refused(graphRootIn(join(repository, CHECKOUT_DIRECTORY)));
      if (root !== undefined) carried = { repository, root };
      return carried;
    });

    const byGraph = Effect.fn('SourceProject.byGraph')(function* (code: string) {
      const graph = yield* carriedGraph(code);
      if (graph === undefined) return undefined;
      const revision = yield* projects.registryVersion;
      if (holder?.revision === revision) return holder.place;
      const pool = yield* RoutedGraphs;
      if (pool === null) return undefined;
      const target = { graph: graph.root, uuid: graph.root, label: '' };
      const state = (yield* pool.farStates([target], LIFECYCLE)).get(farKey(target));
      if (state?.kind === 'absent') {
        if (state.reason === 'project') holder = { revision, place: undefined };
        return undefined;
      }
      if (state === undefined) return undefined;
      const serving = state.kind === 'here' ? [state.project] : state.projects;
      const rows = yield* Effect.forEach(serving, (one) => projects.byId(one.id));
      const project = rows.length === 1 ? rows[0] : rows.find((row) => row.rootPath === graph.repository);
      if (project === undefined) {
        const names = rows.map((row) => `\`${row.name}\``).join(', ');
        return yield* new GateRefusal(
          'ambiguous-project',
          `the repository holding Tagma's code (${graph.repository}) carries a graph that projects ${names} all serve, so Tagma's own graph is not one place`,
          [`remove every one of ${names} but the project Tagma's graph is kept in`],
        );
      }
      const place = { project, place: join(project.rootPath, relative(graph.repository, code)) } satisfies SourcePlace;
      holder = { revision, place };
      return place;
    });

    const place = Effect.fn('SourceProject.place')(function* () {
      const byCode = codePath === undefined ? undefined : yield* byGraph(codePath);
      if (byCode !== undefined) return byCode;
      for (const at of places) {
        const found = yield* byPath(at);
        if (found !== undefined) return found;
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
