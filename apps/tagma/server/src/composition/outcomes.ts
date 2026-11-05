import type { NotificationInput } from '@runlith/tagma/plugin/protocol';
import { Context, Effect, Layer } from 'effect';
import { unservedTools } from '../plugin-host/contract/service/tools.js';
import { PluginPoints, PluginPointRefused } from '../plugins/contract/service/points.js';
import { pluginCaller } from '../plugins/contract/wire/names.js';
import { NotificationContributions, NOTIFIER } from '../notify/contract/service/contributions.js';
import { OutcomeRefused, Outcomes } from '../notify/contract/service/outcomes.js';
import { Senders } from '../notify/contract/service/senders.js';
import { sendersLayer } from '../notify/receiving.js';

export const outcomes = Layer.effectContext(
  Effect.gen(function* () {
    const points = yield* PluginPoints;
    const senders = yield* Senders;
    return Context.make(Outcomes, { deliver: senders.deliver }).pipe(
      Context.add(NotificationContributions, {
        declare: (register) =>
          points.declare(
            NOTIFIER,
            Effect.fnUntraced(function* ({ plugin, value, sibling, caller }) {
              const unserved = unservedTools(sibling, [value.tool]);
              if (unserved !== null) return yield* new PluginPointRefused({ point: NOTIFIER.plugin.name, reason: unserved });
              return register(pluginCaller(plugin.id), {
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
                      } satisfies NotificationInput,
                      { caller: { kind: 'tagma', projectId: null, reason: 'notification' } },
                    )
                    .pipe(Effect.mapError((cause) => new OutcomeRefused({ reason: cause.message })));
                  if ('isError' in answer && answer.isError === true) {
                    return yield* new OutcomeRefused({ reason: `${plugin.id} answered notification ${outcome.id} with an error` });
                  }
                }),
              });
            }),
          ),
      }),
    );
  }),
).pipe(Layer.provideMerge(sendersLayer));
