import { Effect } from 'effect';
import type { PermissionKind } from '@runlith/agent/permissions';
import { ASKS_IN_REVIEW } from '../../platform/contract/wire/conditions.js';
import type { HarnessTool } from '@runlith/tagma/adapter/harness';
import type { HarnessName } from '../../threads/contract/wire/harness/names.js';
import { judge, resolveMode, type ModeLookup } from '@runlith/agent/modes/ApprovalMode';
import { OPERATOR_PRINCIPAL } from '../../platform/contract/wire/actor.js';
import { harnessAdapter } from '../contract/service/table.js';
import type { HarnessJudging } from '../contract/service/permissions.js';
import type { SessionThreads } from '../contract/service/sessionThreads.js';

const OTHER_TOOL: HarnessTool = { kind: 'execute', approval: ASKS_IN_REVIEW };
const toolOf = (name: HarnessName, tool: string): HarnessTool => {
  const tools = harnessAdapter(name).tools.byName;
  const key = tool.toLowerCase();
  return Object.hasOwn(tools, key) ? tools[key]! : OTHER_TOOL;
};
const VERBS: Record<PermissionKind, string> = { execute: 'run', read: 'read', write: 'write', network: 'reach' };

export function harnessJudging(threads: SessionThreads, modes: ModeLookup): HarnessJudging {
  return {
    verdict: Effect.fnUntraced(function* (threadId, call, mutating) {
      const row = yield* threads.find(threadId, OPERATOR_PRINCIPAL);
      if (!row?.harness) return { _tag: 'Unspoken' } as const;
      const tool = toolOf(row.harness.name, call.tool);
      const outcome = judge(tool.approval, [], resolveMode(modes, row.authority.mode), modes, {
        toolName: call.tool,
        mutating: mutating ?? tool.approval.asksFrom !== 'never',
      });
      if (outcome.verdict === 'allow') return { _tag: 'Unspoken' } as const;
      if (outcome.verdict === 'deny') return { _tag: 'Denies', ruleId: outcome.code, reason: outcome.reason } as const;
      return {
        _tag: 'Asks',
        ruleId: outcome.reasons[0]?.id ?? `mode:${row.authority.mode}`,
        reason: outcome.reasons[0]?.text ?? null,
        asked: outcome.reasons.map((reason) => reason.id),
      } as const;
    }),
    prompt: (name, call) => {
      const text = `${harnessAdapter(name).label} asks to ${VERBS[toolOf(name, call.tool).kind]} \`${call.subject}\``;
      return text.length <= 1000 ? text : `${text.slice(0, 999)}…`;
    },
  };
}
