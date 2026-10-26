import { AccountKey } from '@runlith/llm/models/authStatus';
import type { AgentStep } from '@runlith/agent/AgentStep';
import type { ThreadRunRow } from '@runlith/agent/thread/rows';
import { type Context, Effect } from 'effect';
import type { AccountQuota } from '../../providers/contract/service/quota.js';

export const observeStepQuota = (
  quota: AccountQuota['Service'],
  finished: {
    readonly run: Pick<ThreadRunRow, 'provider' | 'account'>;
    readonly step: Pick<AgentStep, 'quota' | 'account'>;
  },
): Effect.Effect<void> => {
  const { run, step } = finished;
  const account = step.account ?? run.account;
  if (step.quota === undefined || run.provider === null || account === null) return Effect.void;
  return quota.observe(run.provider, AccountKey.make(account), step.quota);
};
