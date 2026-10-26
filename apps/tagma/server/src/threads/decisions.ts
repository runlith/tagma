import { activity, body, note, type ActivityPlacement } from '@runlith/activity/Activity';
import type { ActivityBody } from '@runlith/activity/fact';
import { activityKind } from '@runlith/activity/fact';
import { ActivityLog } from '@runlith/activity/log';
import type { ModelCallUsage } from '@runlith/activity/modelCall';
import { estimateThreadTokens } from '@runlith/agent/thread/compaction/measurement';
import { DecisionRefused, type DecisionRequest } from '@runlith/llm/decision';
import { ModelID, ProviderID } from '@runlith/llm/schema/ids';
import { ModelIdentity } from '@runlith/llm/schema/options';
import { decideByText, type TextDecisionAsk } from '@runlith/llm/textDecision';
import { ThreadNotFoundError } from '@runlith/agent/thread/storage/aggregate';
import { Cause, Effect, Option, Schema } from 'effect';
import { OPERATOR_PRINCIPAL } from '../platform/contract/wire/actor.js';
import { ModelAccess } from '../providers/contract/service/access.js';
import { DecisionModels } from '../providers/contract/service/decisions.js';
import { ThreadDecisions, type ThreadDecision } from './contract/service/decisions.js';
import { ThreadLookup } from './contract/service/reads.js';
import { DECISION_ROLE, type ModelRoad, type Roads } from './roads.js';

export const DECISION = activityKind<
  { readonly questions: readonly string[] },
  { readonly road?: string; readonly provider?: string; readonly model?: string; readonly usage?: ModelCallUsage }
>('decision');

const utf8 = new TextEncoder();

const document = (kind: string, value: object): ActivityBody => ({
  kind,
  contentType: 'application/json',
  encoded: utf8.encode(JSON.stringify(value)),
});

export const makeThreadDecisions = Effect.fnUntraced(function* ({ idleMs, roads }: { readonly idleMs: number; readonly roads: Roads }) {
  const threads = yield* ThreadLookup;
  const models = yield* ModelAccess;
  const vendors = yield* DecisionModels;
  const log = yield* ActivityLog;

  const answering = (road: ModelRoad) =>
    Effect.fnUntraced(function* (ask: TextDecisionAsk) {
      const { option } = road;
      const request = models.request({
        ownerId: OPERATOR_PRINCIPAL,
        provider: option.provider,
        model: option.id,
        reasoning: road.reasoning,
        account: road.account ?? undefined,
        instructions: ask.system,
        cache: 'none',
        reasoningOutput: false,
      });
      if (request.refusal)
        return yield* new DecisionRefused({ reason: 'no-model', message: request.refusal.message, failure: request.refusal });
      const capacity = yield* models.served(option.provider, option.id).pipe(
        Effect.map((served) => served.capacity),
        Effect.catchTag('ThreadModelNotServed', () => Effect.succeed(undefined)),
      );
      if (capacity === undefined)
        return yield* new DecisionRefused({ reason: 'no-model', message: `${option.key} is not served by its provider` });
      const needed = estimateThreadTokens({ providerOptions: request.providerOptions, ask });
      if (needed > capacity.context - request.plannedOutputTokens)
        return yield* new DecisionRefused({
          reason: 'input-too-large',
          message: `The question needs about ${needed} tokens; ${option.key} takes ${capacity.context - request.plannedOutputTokens} beside its answer`,
        });
      const answered = yield* request.object({ prompt: ask.prompt, schema: Schema.Unknown, jsonSchema: ask.jsonSchema, stallMs: idleMs });
      return {
        object: answered.object,
        response: answered.response,
        model: request.origin ?? new ModelIdentity({ provider: ProviderID.make(option.provider), model: ModelID.make(option.id) }),
      };
    });

  const asked = Effect.fnUntraced(function* (road: ModelRoad, request: DecisionRequest) {
    const { option } = road;
    const needed = estimateThreadTokens(request);
    if (option.capacity !== undefined && needed > option.capacity.context)
      return yield* new DecisionRefused({
        reason: 'input-too-large',
        message: `The question needs about ${needed} tokens; ${option.key} takes ${option.capacity.context}`,
      });
    return yield* vendors.decide(
      { provider: option.provider, model: option.id, account: road.account, ownerId: OPERATOR_PRINCIPAL },
      request,
    );
  });

  const decide = Effect.fn('ThreadDecisions.decide')(function* (
    threadId: string,
    request: DecisionRequest,
    placement: ActivityPlacement = {},
  ) {
    const thread = yield* threads.find(threadId, OPERATOR_PRINCIPAL);
    if (thread === undefined) return yield* new ThreadNotFoundError(threadId);
    const work = Effect.gen(function* () {
      const chosen = yield* roads.choose(DECISION_ROLE, thread, thread.projectId, []);
      const road = chosen.road;
      yield* note({
        type: 'model-chosen',
        road: chosen.name,
        rejected: chosen.rejected,
        provider: road._tag === 'Model' ? road.option.provider : undefined,
        model: road._tag === 'Model' ? road.option.id : undefined,
        rung: road._tag === 'Model' ? road.reasoning : undefined,
        account: road._tag === 'Model' ? road.account : undefined,
      });
      yield* body(document('input', request));
      if (road._tag !== 'Model')
        return yield* new DecisionRefused({
          reason: 'no-model',
          message:
            road._tag === 'Invalid'
              ? 'The configured decision model is not in the catalog or does not offer the configured reasoning rung'
              : 'No model can answer: no model built for decisions is connected, the thread provider declares no light model or is not connected, and the thread has no model of its own',
        });
      const answer = road.option.capabilities.includes('decision')
        ? yield* asked(road, request)
        : yield* decideByText(request, answering(road));
      yield* body(document('response', answer.answers));
      const decision: ThreadDecision = { ...answer, road: chosen.name };
      return decision;
    });
    return yield* Effect.provideService(
      activity(DECISION, { questions: Object.keys(request.questions) }, work, {
        thread: threadId,
        ...placement,
        ended: (exit) => {
          if (exit._tag === 'Success') {
            const { road, model, usage } = exit.value;
            return { result: { road, provider: model.provider, model: model.model, usage } };
          }
          const refused = Option.getOrUndefined(Cause.findErrorOption(exit.cause));
          if (!(refused instanceof DecisionRefused)) return {};
          const before = refused.reason === 'no-model' || refused.reason === 'input-too-large';
          return { outcome: before ? 'refused' : 'failed', reason: refused.reason, message: refused.message };
        },
      }),
      ActivityLog,
      log,
    );
  });

  return ThreadDecisions.of({ decide });
});
