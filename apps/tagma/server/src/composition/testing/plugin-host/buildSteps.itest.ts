import { expect } from 'bun:test';
import { join } from 'node:path';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { layer } from '@runlith/effect-test';
import { Context, Effect, FileSystem, Layer, Schedule } from 'effect';
import { BuildSteps } from '../../../checkout-builds/contract/service/steps.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { tagmaFormat } from '../../../plugin-formats/tagma/format.js';
import { writePlugin } from '../../../plugin-formats/tagma/testing/folder.js';
import { HostPlace, PluginHost } from '../../../plugin-host/contract/service/supervision.js';
import { pluginHost } from '../../../plugin-host/plugin-host.js';
import { PluginFormats } from '../../../plugins/contract/service/format.js';
import { PluginPlaces, Plugins } from '../../../plugins/contract/service/plugins.js';
import { plugins as pluginsModule } from '../../../plugins/plugins.js';
import { Projects } from '../../../projects/contract/service/registry.js';
import { projectIdentificationLayer } from '../../../projects/identity.js';
import { memorySecretsLayer } from '../../../secrets/testing/doubles.js';
import { Settings } from '../../../settings/contract/service/values.js';
import { buildSteps } from '../../buildSteps.js';
import { demoGraphLayer, tempRootEffect, withDemo } from '../graphFixture.js';
import { liveGitLayer } from '../liveGit.js';

const files = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);

const assembled = (home: string) =>
  buildSteps.pipe(
    Layer.provideMerge(
      pluginHost.lifetimes.installation.pipe(
        Layer.provide(Layer.succeed(HostPlace, { server: null, quiet: '200 millis' })),
        Layer.provideMerge(
          pluginsModule.lifetimes.installation.pipe(
            Layer.provide(Layer.succeed(PluginPlaces, { home })),
            Layer.provide(Layer.succeed(PluginFormats, [tagmaFormat])),
            Layer.provide(BunChildProcessSpawner.layer.pipe(Layer.provide(files))),
            Layer.provide(BunFileSystem.layer),
          ),
        ),
      ),
    ),
    Layer.provide(memorySecretsLayer()),
    Layer.provide(projectIdentificationLayer.pipe(Layer.provide(liveGitLayer))),
  );

layer(Layer.merge(demoGraphLayer(), BunFileSystem.layer), { excludeTestServices: true })('build steps of plugins', (it) => {
  it.effect(
    'an enabled plugin is asked its step as tagma and its answer is the verdict; failed, it refuses the steps; stopped, it has none',
    () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          const home = yield* tempRootEffect(demo.fixture, 'build-steps-home-');
          const root = yield* tempRootEffect(demo.fixture, 'build-steps-plugin-');
          yield* Effect.promise(() =>
            writePlugin(root, {
              id: 'pin',
              title: 'Pin',
              program: join(import.meta.dir, 'buildStepsFixture.ts'),
              contributes: {
                tools: ['pin', 'read'].map((name) => ({
                  name,
                  audience: 'tagma',
                  description: name,
                  inputSchema: { type: 'object', properties: {} },
                })),
                beforeBuild: [{ tool: 'pin', title: 'Core pin' }],
              },
            }),
          );
          const built = yield* Layer.build(
            assembled(home).pipe(
              Layer.provide(
                Layer.succeedContext(
                  Context.make(Settings, demo.graph.settings).pipe(
                    Context.add(Projects, demo.graph.projects),
                    Context.add(MachineStore, demo.graph.store),
                    Context.add(MachineUnits, demo.graph.units),
                  ),
                ),
              ),
              Layer.provideMerge(BunFileSystem.layer),
            ),
          );
          const within = <A, E>(work: Effect.Effect<A, E, any>) => Effect.provide(work, built) as Effect.Effect<A, E>;
          const host = Context.get(built, PluginHost);
          const plugins = Context.get(built, Plugins);
          const steps = Context.get(built, BuildSteps);
          yield* within(host.start());
          const standing = (state: 'idle' | 'failed') =>
            Effect.repeat(
              Effect.sync(() => host.reading('pin')),
              {
                schedule: Schedule.spaced('20 millis'),
                until: (row) => row?.state === state,
              },
            );

          const prepared = yield* within(plugins.prepare({ projectId: demo.projectId, source: root }));
          yield* within(plugins.install({ projectId: demo.projectId, prepared, enabled: true, scope: 'project' }));
          expect(yield* standing('idle')).toMatchObject({ state: 'idle' });
          const [step, ...more] = yield* steps.of(demo.demoRoot);
          expect(more).toEqual([]);
          expect(step).toMatchObject({ plugin: 'pin', title: 'Core pin', projectId: demo.projectId });
          expect(yield* step!.ask({ offer: 'head', checkout: demo.demoRoot })).toEqual({
            verdict: 'stop',
            reason: 'the pin does not converge',
            thread: 'thread-1',
          });
          const read = yield* within(host.call('pin', 'read', {}, {}));
          expect('content' in read && read.content[0]?.type === 'text' ? JSON.parse(read.content[0].text) : null).toMatchObject([
            {
              args: { offer: 'head', checkout: demo.demoRoot },
              meta: { 'runlith/caller': { kind: 'tagma', projectId: demo.projectId, reason: 'build' } },
            },
          ]);

          yield* standing('idle');
          yield* fileSystem.writeFileString(join(root, 'crash'), '');
          expect((yield* Effect.flip(step!.ask({ offer: 'head', checkout: demo.demoRoot }))).message).toContain('pin could not be asked');
          yield* standing('failed');
          expect((yield* Effect.flip(steps.of(demo.demoRoot))).message).toContain('pin is enabled here but its process failed');

          yield* within(plugins.enable({ projectId: demo.projectId, id: 'pin', enabled: false, scope: 'project' }));
          expect(yield* steps.of(demo.demoRoot)).toEqual([]);
        }).pipe(Effect.scoped),
      ),
  );
});
