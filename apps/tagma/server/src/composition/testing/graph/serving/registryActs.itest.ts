import { expect } from 'bun:test';
import { dirname, join } from 'node:path';
import { layer } from '@runlith/effect-test';
import { Context, Effect } from 'effect';
import { Blocks } from '../../../../graph/contract/service/blocks.js';
import { RegisteredRoots } from '../../../../graph/contract/service/registeredRoots.js';
import type { ServedGraph } from '../../../../graph/contract/service/serving.js';
import { REGISTRY_PAIRS } from '../../../../graph/operations/registry.js';
import { machineGraphOf } from '../../../../graph/serving/machine.js';
import { routedContext } from '../../../../graph/serving/routing.js';
import { stealthTreeName } from '../../../../graph/storage/layout.js';
import { signedBy } from '../../../../invocation/testing/call.js';
import { gitEffect, tempRepoEffect } from '../../graphFixture.js';
import { type Serving, servingLayer, withServing } from './fixture.js';

const operator = { actor: { kind: 'operator' as const }, files: null };
const signed = signedBy({ harness: 'test', key: 'registry-acts' });
const roots = RegisteredRoots.of({ joined: () => Effect.void, left: () => Effect.void });

const machineDoor = ({ demo, pool }: Serving) => {
  const context = Context.add(routedContext(machineGraphOf(demo.context), pool), RegisteredRoots, roots);
  return <A, E>(work: Effect.Effect<A, E, unknown>) => Effect.provide(signed(work), context) as Effect.Effect<A, E>;
};

const rootOf = (served: ServedGraph, projectId: number) =>
  Effect.provide(
    Effect.flatMap(Blocks, (blocks) => blocks.rootBlockOf(projectId)),
    served.context,
  );

layer(servingLayer, { excludeTestServices: true })('registry acts on a project served from files', (it) => {
  it.effect('one update of a project whose blocks are served from files renames it, switches a policy and answers the project', () =>
    withServing((serving) =>
      Effect.gen(function* () {
        const door = machineDoor(serving);
        const answer = yield* door(
          REGISTRY_PAIRS.update_project.body.execute(
            { ref: String(serving.projectId), name: 'renamed-served', private: true },
            undefined,
            operator,
          ),
        );
        expect(answer.project).toMatchObject({ id: serving.projectId, name: 'renamed-served', private: true, servesFrom: 'files' });
      }),
    ),
  );

  it.effect('a stealth project re-pointed at another checkout opens its graph there and keeps no copy of the place it left', () =>
    withServing((serving) =>
      Effect.gen(function* () {
        const { demo, pool, projectId, served } = serving;
        const door = machineDoor(serving);
        const before = yield* rootOf(served, projectId);
        const moved = yield* tempRepoEffect(demo.fixture, 'repointed-');
        yield* gitEffect(moved, ['branch', '-M', 'main']);
        yield* door(REGISTRY_PAIRS.set_project_root.body.execute({ ref: String(projectId), rootPath: moved }, undefined, operator));
        const reopened = yield* pool.resolve({ projectId });
        expect(reopened.layout.treeRoot).toBe(join(dirname(served.layout.treeRoot), stealthTreeName(moved)));
        expect((yield* rootOf(reopened, projectId)).uuid).toBe(before.uuid);
        expect(pool.held().flatMap((copy) => (copy.projectId === projectId ? [copy.treeRoot] : []))).toEqual([reopened.layout.treeRoot]);
      }),
    ),
  );
});
