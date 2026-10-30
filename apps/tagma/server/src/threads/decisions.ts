import { activity, body, note, type ActivityPlacement } from '@runlith/activity/Activity';
import type { ActivityBody } from '@runlith/activity/fact';
import { activityKind } from '@runlith/activity/fact';
import { ActivityLog } from '@runlith/activity/log';
import type { ModelCallUsage } from '@runlith/activity/modelCall';
import type { DecisionRequest } from '@runlith/llm/decision';
import { ThreadNotFoundError } from '@runlith/agent/thread/storage/aggregate';
import { Cause, Effect, Option } from 'effect';
import { OPERATOR_PRINCIPAL } from '../platform/contract/wire/actor.js';
import { AskRefused, ModelAsks } from '../providers/contract/service/asks.js';
import { Settings } from '../settings/contract/service/values.js';
import { ThreadDecisions, type ThreadDecision } from './contract/service/decisions.js';
import { ThreadLookup } from './contract/service/reads.js';
import { decisionModel } from './contract/wire/settings.js';

export const DECISION = activityKind<
  { readonly questions: readonly string[] },
  { readonly path?: string; readonly provider?: string; readonly model?: string; readonly usage?: ModelCallUsage }
>('decision');

const utf8 = new TextEncoder();

const document = (kind: string, value: object): ActivityBody => ({
  kind,
  contentType: 'application/json',
  encoded: utf8.encode(JSON.stringify(value)),
});

export const makeThreadDecisions = Effect.gen(function* () {
  const threads = yield* ThreadLookup;
  const asks = yield* ModelAsks;
  const settings = yield* Settings;
  const log = yield* ActivityLog;

  const decide = Effect.fn('ThreadDecisions.decide')(function* (
    threadId: string,
    request: DecisionRequest,
    placement: ActivityPlacement = {},
  ) {
    const thread = yield* threads.find(threadId, OPERATOR_PRINCIPAL);
    if (thread === undefined) return yield* new ThreadNotFoundError(threadId);
    const work = Effect.gen(function* () {
      const selection = yield* asks.choose('decision', yield* settings.value(decisionModel, thread.projectId), {
        provider: thread.provider,
        model: thread.model,
        account: thread.account,
      });
      yield* note({ type: 'model-chosen', road: 'decision', ...selection, rung: selection.reasoning });
      yield* body(document('input', request));
      const answered = yield* asks.decide(selection, request);
      yield* body(document('response', answered.value.answers));
      return { ...answered.value, path: answered.path } satisfies ThreadDecision;
    });
    return yield* Effect.provideService(
      activity(DECISION, { questions: Object.keys(request.questions) }, work, {
        thread: threadId,
        ...placement,
        ended: (exit) => {
          if (exit._tag === 'Success') {
            const { path, model, usage } = exit.value;
            return { result: { path, provider: model.provider, model: model.model, usage } };
          }
          const refused = Option.getOrUndefined(Cause.findErrorOption(exit.cause));
          if (!(refused instanceof AskRefused)) return {};
          const before = refused.refusal === 'ask-unanswerable' || refused.refusal === 'ask-input-too-large';
          return { outcome: before ? 'refused' : 'failed', reason: refused.refusal, message: refused.message };
        },
      }),
      ActivityLog,
      log,
    );
  });

  return ThreadDecisions.of({ decide });
});
