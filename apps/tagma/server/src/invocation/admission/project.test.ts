import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Effect } from 'effect';
import { EffectDrizzleQueryError } from 'drizzle-orm/effect-core/errors';
import { ProjectIdentification, Projects } from '../../projects/contract/service/registry.js';
import { SessionResolution } from '../../external-harnesses/contract/service/sessionResolution.js';
import type { MachineContext } from '../../graph/serving/machine.js';
import type { ServedGraphs } from '../../graph/contract/service/serving.js';
import { testGrantSigner } from '../../platform/testing/grants.js';
import { admitProject } from './project.js';
import { carrying } from './services.js';
import { GraphCall, RefusedGraph } from '../../graph/contract/service/serving.js';
import { CurrentProject } from '../../projects/contract/service/caller.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { AdmittedCall } from '../contract/service/admission.js';
import type { ProjectRow } from '../../projects/contract/wire/project.js';

const failure = new EffectDrizzleQueryError({ query: 'select', params: [], cause: new Error('store closed') });
const resolution = SessionResolution.of({ resolve: () => Effect.succeed(null) });
const request = { project: undefined, cwd: undefined, branch: undefined, scope: 'wanted' };
const projects = (fail: 'list' | 'global') =>
  ({
    list: () => (fail === 'list' ? Effect.fail(failure) : Effect.succeed([])),
    global: () => (fail === 'global' ? Effect.fail(failure) : Effect.succeed(undefined)),
  }) as unknown as Projects['Service'];

for (const fail of ['list', 'global'] as const) {
  it.effect(`a failed ${fail} read refuses a scoped call`, () =>
    Effect.gen(function* () {
      const machine = Context.make(Projects, projects(fail)) as unknown as MachineContext;
      const admitted = admitProject(
        {
          machine,
          pool: {} as ServedGraphs['Service'],
          resolution,
          grants: testGrantSigner,
          stand: () => Effect.die('operator calls carry no thread standing'),
        },
        {},
        request,
        null,
      ).pipe(Effect.provideService(ProjectIdentification, ProjectIdentification.of({ identify: () => Effect.succeed({} as never) })));
      const result = yield* Effect.flip(admitted);
      expect(result.code).toBe('graph-pool');
    }),
  );
}

for (const code of ['graph-unmerged', 'graph-pool'] as const) {
  it.effect(`${code} preserves the project for chat operations and the exact refusal for graph consumers`, () =>
    Effect.gen(function* () {
      const row: ProjectRow = {
        id: 7,
        name: 'shop',
        repoKey: 'shop-repository',
        rootPath: '/project',
        createdAt: new Date(0),
        kind: 'folder',
      };
      const refused = new GateRefusal(code, 'the graph cannot open', ['resolve the graph conflict']);
      const identification = ProjectIdentification.of({ identify: () => Effect.succeed({} as never) });
      const machine = Context.make(Projects, {
        named: () => Effect.succeed(row),
        resolve: () => Effect.succeed(row),
      } as unknown as Projects['Service']).pipe(Context.add(ProjectIdentification, identification)) as MachineContext;
      const pool = { resolve: () => Effect.fail(refused) } as unknown as ServedGraphs['Service'];
      const opened = yield* admitProject(
        { machine, pool, resolution, grants: testGrantSigner, stand: () => Effect.die('operator calls carry no thread standing') },
        {},
        { project: 'shop', cwd: undefined, branch: 'release', scope: undefined },
        null,
      ).pipe(Effect.provideService(ProjectIdentification, identification));
      expect(opened.project).toEqual(row);
      expect(opened.served).toBeNull();
      expect(opened.refused).toBe(refused);
      const call: AdmittedCall = {
        startedAt: 0,
        requested: opened.caller,
        caller: { actor: { kind: 'operator' }, files: null },
        place: null,
        served: opened.served,
        refused: opened.refused,
        project: opened.project,
        world: 'checkout',
        standing: null,
        authority: null,
      };
      const read = yield* carrying(machine, pool)(
        call,
        { key: null },
        Effect.gen(function* () {
          return {
            project: yield* yield* CurrentProject,
            graph: yield* Effect.result(yield* GraphCall),
            refused: yield* RefusedGraph,
          };
        }),
      );
      expect(read.project).toEqual({ project: { id: row.id, name: row.name } });
      expect(read.graph).toMatchObject({ _tag: 'Failure', failure: refused });
      expect(read.refused).toBe(refused);
    }),
  );
}
