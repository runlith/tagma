import type { TickInput } from '@runlith/tagma/plugin/protocol';
import { Context, Effect, Layer } from 'effect';
import { PluginPoints, PluginPointRefused } from '../plugins/contract/service/points.js';
import { pluginCaller } from '../plugins/contract/wire/names.js';
import { SCHEDULED, ScheduleContributions } from '../schedule/contract/service/contributions.js';
import { TickReceivers } from '../schedule/contract/service/receivers.js';
import { TickRefused, Ticks } from '../schedule/contract/service/ticks.js';
import { tickReceiversLayer } from '../schedule/receiving.js';

export const ticks = Layer.effectContext(
  Effect.gen(function* () {
    const points = yield* PluginPoints;
    const receivers = yield* TickReceivers;
    const refused = (reason: string) => new PluginPointRefused({ point: SCHEDULED.plugin.name, reason });
    return Context.make(Ticks, { deliver: receivers.deliver }).pipe(
      Context.add(ScheduleContributions, {
        declare: (register) =>
          points.declare(
            SCHEDULED,
            Effect.fnUntraced(function* ({ plugin, value, caller }) {
              const byName = new Map(value.map((entry) => [entry.name, entry.tool]));
              return yield* register(pluginCaller(plugin.id), value, {
                deliver: Effect.fnUntraced(function* (tick) {
                  const tool = byName.get(tick.name);
                  if (tool === undefined) return yield* new TickRefused({ reason: `the schedule ${tick.name} has no tool` });
                  const answer = yield* caller
                    .call(
                      plugin.id,
                      tool,
                      {
                        name: tick.name,
                        scheduledAt: tick.scheduledAt,
                        startedAt: tick.startedAt,
                        skipped: tick.skipped,
                      } satisfies TickInput,
                      { caller: { kind: 'tagma', projectId: null, reason: 'schedule' } },
                    )
                    .pipe(Effect.mapError((cause) => new TickRefused({ reason: cause.message })));
                  if ('isError' in answer && answer.isError === true) {
                    return yield* new TickRefused({ reason: `${plugin.id} answered the schedule ${tick.name} with an error` });
                  }
                }),
              }).pipe(Effect.mapError((cause) => refused(cause.message)));
            }),
          ),
      }),
    );
  }),
).pipe(Layer.provideMerge(tickReceiversLayer));
