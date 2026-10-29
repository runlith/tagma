import { Context, Effect, Layer } from 'effect';
import { TagmaAppPoints, TagmaAppPointRefused } from '../tagma-apps/contract/service/points.js';
import { tagmaAppCaller } from '../tagma-apps/contract/wire/manifest.js';
import { NotificationContributions } from '../notify/contract/service/contributions.js';
import { OutcomeRefused, Outcomes } from '../notify/contract/service/outcomes.js';
import { Senders } from '../notify/contract/service/senders.js';
import { NotificationTool } from '../notify/contract/wire/contributions.js';
import { sendersLayer } from '../notify/receiving.js';

export const outcomes = Layer.effectContext(
  Effect.gen(function* () {
    const points = yield* TagmaAppPoints;
    const senders = yield* Senders;
    return Context.make(Outcomes, { deliver: senders.deliver }).pipe(
      Context.add(NotificationContributions, {
        declare: (register) =>
          points.declare({
            name: 'notify',
            owner: 'notify',
            schema: NotificationTool,
            register: Effect.fnUntraced(function* ({ app, value, tools, caller }) {
              if (tools === null || !tools.some((descriptor) => descriptor.name === value.tool)) {
                return yield* new TagmaAppPointRefused({ point: 'notify', reason: `the process serves no tool ${value.tool}` });
              }
              return register(tagmaAppCaller(app.id), {
                deliver: Effect.fnUntraced(function* (outcome) {
                  const answer = yield* caller
                    .call(
                      app.id,
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
                    return yield* new OutcomeRefused({ reason: `${app.id} answered notification ${outcome.id} with an error` });
                  }
                }),
              });
            }),
          }),
      }),
    );
  }),
).pipe(Layer.provideMerge(sendersLayer));
