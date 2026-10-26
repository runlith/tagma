import { Context, Effect, Layer } from 'effect';
import { PluginPoints, PluginPointRefused } from '../plugins/contract/service/points.js';
import { NotificationContributions } from '../notify/contract/service/contributions.js';
import { OutcomeRefused, Outcomes } from '../notify/contract/service/outcomes.js';
import { Senders } from '../notify/contract/service/senders.js';
import { NotificationTool } from '../notify/contract/wire/contributions.js';
import { sendersLayer } from '../notify/receiving.js';

export const outcomes = Layer.effectContext(
  Effect.gen(function* () {
    const points = yield* PluginPoints;
    const senders = yield* Senders;
    return Context.make(Outcomes, { deliver: senders.deliver }).pipe(
      Context.add(NotificationContributions, {
        declare: (register) =>
          points.declare({
            name: 'notify',
            owner: 'notify',
            schema: NotificationTool,
            register: Effect.fnUntraced(function* ({ plugin, value, tools, caller }) {
              if (tools === null || !tools.some((descriptor) => descriptor.name === value.tool)) {
                return yield* new PluginPointRefused({ point: 'notify', reason: `the process serves no tool ${value.tool}` });
              }
              return register(`plugin:${plugin.id}`, {
                deliver: Effect.fnUntraced(function* (outcome) {
                  const answer = yield* caller
                    .call(
                      plugin.id,
                      value.tool,
                      {
                        id: outcome.id,
                        title: outcome.title,
                        kind: outcome.kind,
                        answer: outcome.answer,
                        at: outcome.at,
                      },
                      { caller: { kind: 'tagma', projectId: null, reason: 'notification' } },
                    )
                    .pipe(Effect.mapError((cause) => new OutcomeRefused({ reason: cause.message })));
                  if ('isError' in answer && answer.isError === true) {
                    return yield* new OutcomeRefused({ reason: `${plugin.id} answered notification ${outcome.id} with an error` });
                  }
                }),
              });
            }),
          }),
      }),
    );
  }),
).pipe(Layer.provideMerge(sendersLayer));
