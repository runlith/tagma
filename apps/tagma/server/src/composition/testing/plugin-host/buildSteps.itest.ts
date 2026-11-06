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
    'an enabled plugin is asked its step as tagma and its answer is the verdict; one that did not start is asked again past its gate; one whose tools differ refuses the steps; disabled, none',
    () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          const home = yield* tempRootEffect(demo.fixture, 'build-steps-home-');
          const placed = Effect.fnUntraced(function* (id: string, tools: readonly string[]) {
            const root = yield* tempRootEffect(demo.fixture, `build-steps-${id}-`);
            yield* Effect.promise(() =>
              writePlugin(root, {
                id,
                title: id,
                program: join(import.meta.dir, 'buildStepsFixture.ts'),
                contributes: {
                  tools: tools.map((name) => ({
                    name,
                    audience: 'tagma',
                    description: name,
                    inputSchema: { type: 'object', properties: {} },
                  })),
                  beforeBuild: [{ tool: 'pin', title: 'Core pin' }],
                },
              }),
            );
            return root;
          });
          const root = yield* placed('pin', ['pin', 'read']);
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
          const standing = (state: 'idle' | 'failed', id = 'pin') =>
            Effect.repeat(
              Effect.sync(() => host.reading(id)),
              {
                schedule: Schedule.spaced('20 millis'),
                until: (row) => row?.state === state,
              },
            );
          const installed = Effect.fnUntraced(function* (source: string) {
            const prepared = yield* within(plugins.prepare({ projectId: demo.projectId, source }));
            yield* within(plugins.install({ projectId: demo.projectId, prepared, enabled: true, scope: 'project' }));
          });

          yield* installed(root);
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
          expect(host.reading('pin')).toMatchObject({ state: 'idle', restarts: 1 });
          const [again] = yield* steps.of(demo.demoRoot);
          yield* fileSystem.remove(join(root, 'crash'));
          expect(yield* again!.ask({ offer: 'head', checkout: demo.demoRoot })).toMatchObject({ verdict: 'stop' });

          yield* installed(yield* placed('gap', ['pin', 'read', 'gone']));
          yield* standing('idle', 'gap');
          const gap = (yield* steps.of(demo.demoRoot)).find((one) => one.plugin === 'gap');
          expect((yield* Effect.flip(gap!.ask({ offer: 'head', checkout: demo.demoRoot }))).message).toContain('gap could not be asked');
          yield* standing('failed', 'gap');
          expect((yield* Effect.flip(steps.of(demo.demoRoot))).message).toContain('gap is enabled here but its process failed');

          for (const id of ['pin', 'gap']) {
            yield* within(plugins.enable({ projectId: demo.projectId, id, enabled: false, scope: 'project' }));
          }
          expect(yield* steps.of(demo.demoRoot)).toEqual([]);
        }).pipe(Effect.scoped),
      ),
  );
});
