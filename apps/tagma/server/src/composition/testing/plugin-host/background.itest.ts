import { expect } from 'bun:test';
import { join } from 'node:path';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { layer } from '@runlith/effect-test';
import { Context, Data, Effect, Layer, Schedule, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import { Notifications } from '../../../notify/contract/service/notifications.js';
import { Senders } from '../../../notify/contract/service/senders.js';
import { notify } from '../../../notify/notify.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { tagmaFormat } from '../../../plugin-formats/tagma/format.js';
import { writePlugin } from '../../../plugin-formats/tagma/testing/folder.js';
import { HostPlace, PluginHost } from '../../../plugin-host/contract/service/supervision.js';
import { pluginHost } from '../../../plugin-host/plugin-host.js';
import { PluginFormats } from '../../../plugins/contract/service/format.js';
import { PluginPlaces, Plugins } from '../../../plugins/contract/service/plugins.js';
import type { PluginProcessState } from '../../../plugins/contract/wire/rows.js';
import { plugins as pluginsModule } from '../../../plugins/plugins.js';
import { Projects } from '../../../projects/contract/service/registry.js';
import { Schedules } from '../../../schedule/contract/service/schedules.js';
import { schedule } from '../../../schedule/schedule.js';
import { memorySecretsLayer } from '../../../secrets/testing/doubles.js';
import { Settings } from '../../../settings/contract/service/values.js';
import { outcomes } from '../../outcomes.js';
import { ticks } from '../../ticks.js';
import { demoGraphLayer, tempRootEffect, withDemo } from '../graphFixture.js';

const files = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);
const QUIET = 30_000;

const assembled = (home: string) =>
  Layer.mergeAll(
    schedule.lifetimes.serving.pipe(Layer.provideMerge(ticks)),
    notify.lifetimes.serving.pipe(Layer.provideMerge(outcomes)),
  ).pipe(
    Layer.provideMerge(
      pluginHost.lifetimes.installation.pipe(
        Layer.provide(Layer.succeed(HostPlace, { server: null, quiet: QUIET })),
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
  );

type Call = { readonly tool: string; readonly args: Record<string, unknown>; readonly meta: Readonly<Record<string, unknown>> };

class NoCallYet extends Data.TaggedError('NoCallYet')<{ readonly tool: string }> {}
class NoCallsAnswered extends Data.TaggedError('NoCallsAnswered')<{}> {}

layer(Layer.merge(demoGraphLayer(), BunFileSystem.layer), { excludeTestServices: true })('background plugin', (it) => {
  it.effect(
    'a plugin enabled in a project stands with no process, its tick starts it as tagma, it takes its notification answer once, goes idle and starts again on the next tick, and withdraws both contributions when disabled',
    () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const home = yield* tempRootEffect(demo.fixture, 'background-home-');
          const root = yield* tempRootEffect(demo.fixture, 'background-plugin-');
          yield* Effect.promise(() =>
            writePlugin(root, {
              id: 'background',
              title: 'Background',
              program: join(import.meta.dir, 'backgroundFixture.ts'),
              contributes: {
                tools: ['poll', 'outcome', 'read'].map((name) => ({
                  name,
                  audience: 'tagma',
                  description: name,
                  inputSchema: { type: 'object', properties: {} },
                })),
                schedule: [{ name: 'poll', everyMs: 60_000, tool: 'poll' }],
                notify: { tool: 'outcome' },
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
              Layer.provideMerge(TestClock.layer()),
            ),
          );
          const host = Context.get(built, PluginHost);
          const plugins = Context.get(built, Plugins);
          const notifications = Context.get(built, Notifications);
          const schedules = Context.get(built, Schedules);
          const senders = Context.get(built, Senders);
          const within = <A, E>(work: Effect.Effect<A, E, any>) => Effect.provide(work, built) as Effect.Effect<A, E>;
          const advance = (ms: number) => within(TestClock.adjust(ms));
          yield* within(host.start());

          const calls = Effect.gen(function* () {
            const answer = yield* within(host.call('background', 'read', {}, {}));
            if (!('content' in answer) || answer.content[0]?.type !== 'text') return yield* new NoCallsAnswered();
            return JSON.parse(answer.content[0].text) as readonly Call[];
          });
          const received = (tool: string) =>
            Effect.retry(
              Effect.flatMap(calls, (all) => {
                const rows = all.filter((call) => call.tool === tool);
                return rows.length > 0 ? Effect.succeed(rows) : Effect.fail(new NoCallYet({ tool }));
              }),
              { schedule: Schedule.spaced('5 millis') },
            );
          const settled = (...states: readonly PluginProcessState[]) =>
            Effect.repeat(
              Effect.sync(() => host.reading('background')),
              {
                schedule: Schedule.spaced('5 millis'),
                until: (row) => row !== undefined && states.includes(row.state),
              },
            );
          const stopped = Effect.repeat(
            Effect.sync(() => host.reading('background')),
            {
              schedule: Schedule.spaced('5 millis'),
              until: (row) => row === undefined || row.state === 'stopped',
            },
          );
          const install = Effect.gen(function* () {
            const prepared = yield* within(plugins.prepare({ projectId: demo.projectId, source: root }));
            yield* within(plugins.install({ projectId: demo.projectId, prepared, enabled: true, scope: 'project' }));
            return yield* settled('idle');
          });
          const disable = () => within(plugins.enable({ projectId: demo.projectId, id: 'background', enabled: false, scope: 'project' }));
          const enable = () => within(plugins.enable({ projectId: demo.projectId, id: 'background', enabled: true, scope: 'project' }));
          const all = within(schedules.read({ after: null, limit: 10 }));

          expect(senders.accepts('plugin:background')).toBe(false);
          expect(yield* install).toMatchObject({ state: 'idle' });
          expect(senders.accepts('plugin:background')).toBe(true);
          expect((yield* all).rows).toMatchObject([{ owner: 'plugin:background', name: 'poll', nextAt: 60_000 }]);
          yield* advance(60_000);
          expect(yield* received('poll')).toMatchObject([
            {
              args: { name: 'poll', scheduledAt: 60_000, startedAt: 60_000, skipped: 0 },
              meta: {
                'runlith/caller': { kind: 'tagma', projectId: null, reason: 'schedule' },
                'runlith/projects': [demo.projectId],
              },
            },
          ]);

          const sent = yield* within(
            notifications.send('plugin:background', {
              title: 'Order',
              body: '',
              question: { text: 'Proceed?', options: ['Yes', 'No'] },
            }),
          );
          const attention = yield* within(Stream.runHead(notifications.changes));
          expect(attention).toMatchObject({ value: { _tag: 'all', rows: [{ id: sent.id, sender: 'plugin:background' }] } });
          const answered = yield* within(notifications.answer(sent.id, 'Yes'));
          expect(yield* received('outcome')).toMatchObject([
            {
              args: { id: sent.id, kind: 'answered', answer: 'Yes' },
              meta: { 'runlith/caller': { kind: 'tagma', projectId: null, reason: 'notification' } },
            },
          ]);
          expect(yield* within(notifications.answer(sent.id, 'No'))).toMatchObject({ repeated: true, outcome: answered.outcome });
          expect(yield* within(notifications.dismiss(sent.id))).toMatchObject({ repeated: true, outcome: answered.outcome });
          expect((yield* calls).filter((call) => call.tool === 'outcome')).toHaveLength(1);

          yield* advance(QUIET);
          yield* settled('idle');
          yield* advance(60_000 - QUIET);
          expect(yield* received('poll')).toMatchObject([{ args: { name: 'poll', scheduledAt: 120_000 } }]);

          yield* disable();
          yield* stopped;
          expect(senders.accepts('plugin:background')).toBe(false);
          expect((yield* all).rows).toEqual([]);
          yield* advance(120_000);
          expect((yield* all).rows).toEqual([]);
          yield* enable();
          yield* settled('idle', 'running');
          expect((yield* all).rows).toHaveLength(1);
          expect(senders.accepts('plugin:background')).toBe(true);
        }).pipe(Effect.scoped),
      ),
  );
});
