import { expect } from 'bun:test';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { Context, Effect, FileSystem, Layer, Schedule } from 'effect';
import { BuildSteps } from '../../../checkout-builds/contract/service/steps.js';
import { TagmaAppPlace, TagmaApps } from '../../../tagma-apps/contract/service/supervision.js';
import { tagmaApps as appsModule } from '../../../tagma-apps/tagma-apps.js';
import { memorySecretsLayer } from '../../../secrets/testing/doubles.js';
import { Settings } from '../../../settings/contract/service/values.js';
import { Projects } from '../../../projects/contract/service/registry.js';
import { projectIdentificationLayer } from '../../../projects/identity.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { demoGraphLayer, tempRootEffect, withDemo } from '../graphFixture.js';
import { liveGitLayer } from '../liveGit.js';
import { buildSteps } from '../../buildSteps.js';

const assembled = buildSteps.pipe(
  Layer.provideMerge(appsModule.lifetimes.installation),
  Layer.provide(memorySecretsLayer()),
  Layer.provide(projectIdentificationLayer.pipe(Layer.provide(liveGitLayer))),
);

layer(Layer.merge(demoGraphLayer(), BunFileSystem.layer), { excludeTestServices: true })('build steps of apps', (it) => {
  it.effect(
    'an enabled app is asked its step as tagma and its answer is the verdict; failed, it refuses the steps; stopped, it has none',
    () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const files = yield* FileSystem.FileSystem;
          const home = yield* tempRootEffect(demo.fixture, 'build-steps-home-');
          const root = join(demo.demoRoot, '.tagma-apps', 'pin');
          yield* files.makeDirectory(root, { recursive: true });
          yield* files.writeFileString(
            join(root, 'tagma-app.json'),
            JSON.stringify({
              id: 'pin',
              title: 'Pin',
              process: { command: process.execPath, args: [join(import.meta.dir, 'buildStepsFixture.ts')] },
              contributes: { beforeBuild: [{ tool: 'pin', title: 'Core pin' }] },
            }),
          );
          const built = yield* Layer.build(
            assembled.pipe(
              Layer.provide(
                Layer.succeedContext(
                  Context.make(Settings, demo.graph.settings).pipe(
                    Context.add(Projects, demo.graph.projects),
                    Context.add(TagmaAppPlace, { home, server: null }),
                    Context.add(MachineStore, demo.graph.store),
                    Context.add(MachineUnits, demo.graph.units),
                  ),
                ),
              ),
              Layer.provideMerge(BunFileSystem.layer),
            ),
          );
          const within = <A, E>(work: Effect.Effect<A, E, any>) => Effect.provide(work, built) as Effect.Effect<A, E>;
          const apps = Context.get(built, TagmaApps);
          const steps = Context.get(built, BuildSteps);
          const install = (enabled: boolean) => within(apps.install({ projectId: demo.projectId, id: 'pin', enabled }));

          expect(yield* install(true)).toMatchObject({ state: 'running' });
          const [step, ...more] = yield* steps.of(demo.demoRoot);
          expect(more).toEqual([]);
          expect(step).toMatchObject({ app: 'pin', title: 'Core pin', projectId: demo.projectId });
          expect(yield* step!.ask({ offer: 'head', checkout: demo.demoRoot })).toEqual({
            verdict: 'stop',
            reason: 'the pin does not converge',
            thread: 'thread-1',
          });
          const read = yield* within(apps.call('pin', 'read', {}, {}));
          expect('content' in read && read.content[0]?.type === 'text' ? JSON.parse(read.content[0].text) : null).toMatchObject([
            {
              args: { offer: 'head', checkout: demo.demoRoot },
              meta: { 'runlith/caller': { kind: 'tagma', projectId: demo.projectId, reason: 'build' } },
            },
          ]);

          yield* files.writeFileString(join(root, 'crash'), '');
          yield* Effect.repeat(within(apps.list(demo.projectId)), {
            schedule: Schedule.spaced('20 millis'),
            until: (rows) => rows.some((row) => row.id === 'pin' && row.state === 'failed'),
          });
          expect((yield* Effect.flip(steps.of(demo.demoRoot))).message).toContain('pin is enabled here but its process failed');

          yield* install(false);
          expect(yield* steps.of(demo.demoRoot)).toEqual([]);
        }).pipe(Effect.scoped),
      ),
  );
});
