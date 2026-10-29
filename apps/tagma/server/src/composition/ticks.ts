import { Context, Effect, Layer } from 'effect';
import { TagmaAppPoints, TagmaAppPointRefused } from '../tagma-apps/contract/service/points.js';
import { tagmaAppCaller } from '../tagma-apps/contract/wire/manifest.js';
import { ScheduleContributions } from '../schedule/contract/service/contributions.js';
import { TickReceivers } from '../schedule/contract/service/receivers.js';
import { TickRefused, Ticks } from '../schedule/contract/service/ticks.js';
import { ScheduledTools } from '../schedule/contract/wire/contributions.js';
import { tickReceiversLayer } from '../schedule/receiving.js';

export const ticks = Layer.effectContext(
  Effect.gen(function* () {
    const points = yield* TagmaAppPoints;
    const receivers = yield* TickReceivers;
    return Context.make(Ticks, { deliver: receivers.deliver }).pipe(
      Context.add(ScheduleContributions, {
        declare: (register) =>
          points.declare({
            name: 'schedule',
            owner: 'schedule',
            schema: ScheduledTools,
            register: Effect.fnUntraced(function* ({ app, value, tools, caller }) {
              const byName = new Map(value.map((entry) => [entry.name, entry.tool]));
              const available = new Set(tools?.map((descriptor) => descriptor.name));
              for (const tool of byName.values()) {
                if (!available.has(tool)) {
                  return yield* new TagmaAppPointRefused({ point: 'schedule', reason: `the process serves no tool ${tool}` });
                }
              }
              return yield* register(tagmaAppCaller(app.id), value, {
                deliver: Effect.fnUntraced(function* (tick) {
                  const tool = byName.get(tick.name);
                  if (tool === undefined) return yield* new TickRefused({ reason: `the schedule ${tick.name} has no tool` });
                  const answer = yield* caller
                    .call(
                      app.id,
                      tool,
                      {
                        name: tick.name,
                        scheduledAt: tick.scheduledAt,
                        startedAt: tick.startedAt,
                        skipped: tick.skipped,
                      },
                      { caller: { kind: 'tagma', projectId: null, reason: 'schedule' } },
                    )
                    .pipe(Effect.mapError((cause) => new TickRefused({ reason: cause.message })));
                  if ('isError' in answer && answer.isError === true) {
                    return yield* new TickRefused({ reason: `${app.id} answered the schedule ${tick.name} with an error` });
                  }
                }),
              }).pipe(Effect.mapError((cause) => new TagmaAppPointRefused({ point: 'schedule', reason: cause.message })));
            }),
          }),
      }),
    );
  }),
).pipe(Layer.provideMerge(tickReceiversLayer));
