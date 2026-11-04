import { Clock, Effect } from 'effect';
import { agentRule, type AgentDirective, type AgentRule } from '@runlith/agent/AgentRuntimePolicy';
import { TOOL_OUTPUT_MAX_BYTES } from '@runlith/agent/ToolOutputSpool';
import { estimateThreadTokens, RAW_CHARS_PER_TOKEN } from '@runlith/agent/thread/compaction/measurement';
import type { RunBudget } from '@runlith/agent/thread/agents/AgentProfile';
import type { ThreadContext } from './context.js';
import type { NativeRuleSource } from '../contract/service/rules.js';

const RULE_ID = 'run-budget';
const ANSWER_TOOL = 'answer';
const GUIDE_AT = 0.7;
const RESULT_RESERVE = Math.ceil(TOOL_OUTPUT_MAX_BYTES / RAW_CHARS_PER_TOKEN);
const OUTPUT_ALLOWANCE = 4_000;

type Gate = {
  startedAt: number | null;
  prompt: number | null;
  premiumAbove: number | null;
  reserved: number;
  guided: boolean;
  told: boolean;
  denied: string | null;
  closeAsked: boolean;
};

type Limits = { readonly prompt: number | null; readonly steps: number | null; readonly seconds: number | null };

export const budgetSource: NativeRuleSource = { id: RULE_ID, create: () => budgetRule() };

const limitsOf = (budget: RunBudget, gate: Gate): Limits => ({
  prompt: budget.prompt ?? gate.premiumAbove,
  steps: budget.steps ?? null,
  seconds: budget.seconds ?? null,
});

const spentOf = (limits: Limits, gate: Gate, steps: number, now: number): string | null => {
  if (limits.steps !== null && steps + 1 >= limits.steps) return 'steps';
  if (limits.seconds !== null && gate.startedAt !== null && (now - gate.startedAt) / 1000 >= limits.seconds) return 'seconds';
  if (limits.prompt !== null && gate.prompt !== null && gate.prompt + OUTPUT_ALLOWANCE + gate.reserved + RESULT_RESERVE > limits.prompt) {
    return 'prompt';
  }
  return null;
};

const used = (limits: Limits, gate: Gate, steps: number, now: number): string => {
  const parts: string[] = [];
  if (limits.prompt !== null && gate.prompt !== null) parts.push(`prompt ${gate.prompt} of ${limits.prompt} tokens`);
  if (limits.steps !== null) parts.push(`step ${steps + 1} of ${limits.steps}`);
  if (limits.seconds !== null && gate.startedAt !== null)
    parts.push(`${Math.round((now - gate.startedAt) / 1000)} of ${limits.seconds} seconds`);
  return parts.join(', ');
};

const nearing = (limits: Limits, gate: Gate, steps: number, now: number): boolean =>
  (limits.prompt !== null && gate.prompt !== null && gate.prompt / limits.prompt >= GUIDE_AT) ||
  (limits.steps !== null && (steps + 1) / limits.steps >= GUIDE_AT) ||
  (limits.seconds !== null && gate.startedAt !== null && (now - gate.startedAt) / 1000 / limits.seconds >= GUIDE_AT);

function budgetRule(): AgentRule<ThreadContext> {
  return agentRule<ThreadContext>(
    RULE_ID,
    (ctx) =>
      Effect.gen(function* () {
        const budget = ctx.thread.profile?.overlay?.budget;
        if (budget === undefined) return null;
        const gate = ctx.run.ruleState<Gate>(RULE_ID, () => ({
          startedAt: null,
          prompt: null,
          premiumAbove: null,
          reserved: 0,
          guided: false,
          told: false,
          denied: null,
          closeAsked: false,
        }));
        const now = yield* Clock.currentTimeMillis;
        gate.startedAt ??= now;
        const steps = ctx.run.stepNumber;

        if (ctx.hook === 'beforeStep') {
          gate.reserved = 0;
          if (ctx.contextEstimate !== undefined) {
            gate.prompt = ctx.contextEstimate.tokens;
            gate.premiumAbove = ctx.contextEstimate.premiumAbove;
          }
          const limits = limitsOf(budget, gate);
          const spent = gate.denied ?? spentOf(limits, gate, steps, now);
          if (ctx.run.called(ANSWER_TOOL)) {
            return spent === null ? null : ({ type: 'restrict', tools: [] } satisfies AgentDirective);
          }
          if (spent !== null || gate.closeAsked) {
            const first = !gate.told;
            gate.told = true;
            const text = `The ${spent ?? 'closing'} budget is spent. Answer now with what you have, and say what you did not establish.`;
            return [
              { type: 'restrict', tools: [ANSWER_TOOL] },
              { type: 'require', tool: ANSWER_TOOL, ...(first ? { text } : {}) },
            ] satisfies AgentDirective[];
          }
          if (!gate.guided && nearing(limits, gate, steps, now)) {
            gate.guided = true;
            return {
              type: 'guide',
              text: `Budget used: ${used(limits, gate, steps, now)}. Answer with what you have unless one more read decides the question.`,
            } satisfies AgentDirective;
          }
          return null;
        }

        if (ctx.hook === 'beforeTool') {
          if (ctx.tool === undefined || ctx.tool.name === ANSWER_TOOL) return null;
          const own = estimateThreadTokens(ctx.tool.input);
          const limits = limitsOf(budget, gate);
          gate.reserved += own;
          const spent = gate.denied ?? spentOf(limits, gate, steps, now);
          if (spent === null) {
            gate.reserved += RESULT_RESERVE;
            return null;
          }
          gate.reserved -= own;
          gate.denied = spent;
          return {
            type: 'deny',
            reason: `The ${spent} budget is spent, so this call was not run. Answer with what you have.`,
          } satisfies AgentDirective;
        }

        if (ctx.hook === 'beforeClose') {
          if (ctx.catalog[ANSWER_TOOL] === undefined || ctx.run.called(ANSWER_TOOL) || gate.closeAsked) return null;
          gate.closeAsked = true;
          return { type: 'guide', text: `End by calling ${ANSWER_TOOL} with your answer.` } satisfies AgentDirective;
        }
        return null;
      }),
    { owner: 'native-harness', priority: 100, critical: false },
  );
}
