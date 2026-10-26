import { LONGEST_ACT_MS } from '@runlith/agent/callProgress';
import { CommandUnreadable, type CommandLimit, type CommandTimes } from '@runlith/agent-tools/CommandWork';
import { type Context, Effect } from 'effect';
import type { MachineStore } from '../../platform/contract/service/store.js';
import type { Governing } from '../../workspace/governing.js';
import type { CommandRule, RuleMeasure } from '../contract/wire/commandRules.js';
import { currentRules } from '../store/standingRules.js';
import { copyHead, resolveCommandTime, ruleCopy } from './ruleResolution.js';

const limitOf = (
  rules: readonly CommandRule[],
  thread: string | null,
  measure: RuleMeasure,
  requested: number | undefined,
): CommandLimit => {
  const time = resolveCommandTime({ rules, thread, tool: 'bash', measure, requested });
  return { ms: time.limitMs, origin: time.origin, rule: time.rule === null ? null : copyHead(ruleCopy(time.rule), measure) };
};

export const commandTimes = (machine: Context.Service.Shape<typeof MachineStore>, home: number, governing: Governing): CommandTimes => ({
  resolve: Effect.fnUntraced(
    function* (asked, caller, workdir) {
      const thread = caller.thread?.threadId ?? null;
      const place = yield* governing(workdir);
      const rules = (yield* currentRules(machine, place, thread, home)).map((one) => one.rule);
      return { wait: limitOf(rules, thread, 'wait', asked.waitMs), life: limitOf(rules, thread, 'life', asked.lifeMs) };
    },
    Effect.mapError((failure) => new CommandUnreadable({ reason: failure._tag === 'PlaceUnread' ? failure.reason : failure.message })),
  ),
});

export const toolTimes = (times: CommandTimes) => ({ commandTimes: times, searchMs: LONGEST_ACT_MS });
