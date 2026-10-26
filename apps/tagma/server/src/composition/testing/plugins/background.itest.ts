import { expect } from 'bun:test';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { Context, Data, Effect, FileSystem, Layer, Schedule, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import { PluginPlace, Plugins } from '../../../plugins/contract/service/supervision.js';
import { plugins as pluginModule } from '../../../plugins/plugins.js';
import { Notifications } from '../../../notify/contract/service/notifications.js';
import { Senders } from '../../../notify/contract/service/senders.js';
import { notify } from '../../../notify/notify.js';
import { Schedules } from '../../../schedule/contract/service/schedules.js';
import { schedule } from '../../../schedule/schedule.js';
import { Settings } from '../../../settings/contract/service/values.js';
import { Projects } from '../../../projects/contract/service/registry.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { demoGraphLayer, tempRootEffect, withDemo } from '../graphFixture.js';
import { ticks } from '../../ticks.js';
import { outcomes } from '../../outcomes.js';

const assembled = Layer.mergeAll(
  schedule.lifetimes.serving.pipe(Layer.provideMerge(ticks)),
  notify.lifetimes.serving.pipe(Layer.provideMerge(outcomes)),
).pipe(Layer.provideMerge(pluginModule.lifetimes.installation));

type Call = { readonly tool: string; readonly args: Record<string, unknown>; readonly meta: Readonly<Record<string, unknown>> };

class NoCallYet extends Data.TaggedError('NoCallYet')<{ readonly tool: string }> {}
class NoCallsAnswered extends Data.TaggedError('NoCallsAnswered')<{}> {}

layer(Layer.merge(demoGraphLayer(), BunFileSystem.layer), { excludeTestServices: true })('background plugin', (it) => {
  it.effect(
    'a machine-enabled plugin receives the scheduled tick as tagma, takes its notification answer once and withdraws both contributions when disabled',
    () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const files = yield* FileSystem.FileSystem;
          const home = yield* tempRootEffect(demo.fixture, 'background-home-');
          const root = join(demo.demoRoot, '.plugins', 'background');
          yield* files.makeDirectory(root, { recursive: true });
          yield* files.writeFileString(
            join(root, 'plugin.json'),
            JSON.stringify({
              id: 'background',
              title: 'Background',
              process: { command: process.execPath, args: [join(import.meta.dir, 'backgroundFixture.ts')] },
              contributes: {
                schedule: [{ name: 'poll', everyMs: 60_000, tool: 'poll' }],
                notify: { tool: 'outcome' },
              },
            }),
          );
          const built = yield* Layer.build(
            assembled.pipe(
              Layer.provide(
                Layer.succeedContext(
                  Context.make(Settings, demo.graph.settings).pipe(
                    Context.add(Projects, demo.graph.projects),
                    Context.add(PluginPlace, { home, server: null }),
                    Context.add(MachineStore, demo.graph.store),
                    Context.add(MachineUnits, demo.graph.units),
                  ),
                ),
              ),
              Layer.provideMerge(TestClock.layer()),
            ),
          );
          const plugins = Context.get(built, Plugins);
          const notifications = Context.get(built, Notifications);
          const schedules = Context.get(built, Schedules);
          const senders = Context.get(built, Senders);
          const within = <A, E>(work: Effect.Effect<A, E, any>) => Effect.provide(work, built) as Effect.Effect<A, E>;
          const advance = (ms: number) => within(TestClock.adjust(ms));

          const calls = Effect.gen(function* () {
            const answer = yield* within(plugins.call('background', 'read', {}, {}));
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
          const install = (enabled: boolean) => within(plugins.install({ projectId: demo.projectId, id: 'background', enabled }));
          const all = within(schedules.read({ after: null, limit: 10 }));

          expect(senders.accepts('plugin:background')).toBe(false);
          expect(yield* install(true)).toMatchObject({ state: 'running' });
          expect(senders.accepts('plugin:background')).toBe(true);
          expect((yield* all).rows).toMatchObject([{ owner: 'plugin:background', name: 'poll', nextAt: 60_000 }]);
          yield* advance(60_000);
          expect(yield* received('poll')).toMatchObject([
            {
              args: { name: 'poll', scheduledAt: 60_000, startedAt: 60_000, skipped: 0 },
              meta: { 'runlith/caller': { kind: 'tagma', projectId: null, reason: 'schedule' } },
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

          yield* install(false);
          expect(senders.accepts('plugin:background')).toBe(false);
          expect((yield* all).rows).toEqual([]);
          yield* advance(120_000);
          expect((yield* all).rows).toEqual([]);
          expect(yield* install(true)).toMatchObject({ state: 'running' });
          expect((yield* all).rows).toHaveLength(1);
          expect(senders.accepts('plugin:background')).toBe(true);
        }).pipe(Effect.scoped),
      ),
  );
});
