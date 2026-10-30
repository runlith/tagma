import { activity, type ActivityPlacement } from '@runlith/activity/Activity';
import { activityKind } from '@runlith/activity/fact';
import type { ModelCallUsage } from '@runlith/activity/modelCall';
import type { AskKind } from '@runlith/llm/models/description';
import type { Usage } from '@runlith/llm/schema/events';
import { Cause, Option, type Effect } from 'effect';
import { AskRefused } from './contract/service/asks.js';
import type { AskPath } from './contract/wire/asks.js';

export type AskActivity = {
  readonly kind: AskKind;
  readonly path: AskPath | 'thread';
  readonly provider: string | undefined;
  readonly model: string | undefined;
  readonly rung: string | null;
};

type AskSpend = { readonly account?: string; readonly usage?: Usage };

const ASK = activityKind<AskActivity, { readonly account?: string; readonly usage?: ModelCallUsage }>('ask');

export const askActivity = <A extends AskSpend, E extends AskSpend, R>(
  attrs: AskActivity,
  work: Effect.Effect<A, E, R>,
  placement: ActivityPlacement = {},
) =>
  activity(ASK, attrs, work, {
    ...placement,
    ended: (exit) => {
      if (exit._tag === 'Success') return { result: { account: exit.value.account, usage: exit.value.usage } };
      const failure = Option.getOrUndefined(Cause.findErrorOption(exit.cause));
      if (!(failure instanceof AskRefused)) return { result: failure?.usage === undefined ? undefined : { usage: failure.usage } };
      const before =
        failure.refusal === 'ask-not-connected' ||
        failure.refusal === 'ask-unanswerable' ||
        failure.refusal === 'ask-input-too-large' ||
        failure.refusal === 'ask-quota';
      return {
        outcome: before ? 'refused' : 'failed',
        reason: failure.refusal,
        message: failure.message,
        result: failure.usage === undefined ? undefined : { usage: failure.usage },
      };
    },
  });
