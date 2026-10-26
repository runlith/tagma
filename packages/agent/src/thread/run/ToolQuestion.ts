import { sha256 } from '@runlith/utils/sha256';
import type { ThreadQuestionEntry } from '../../transcript/entries';
import { questionEntryId } from '../../transcript/entryNames';
import { toolConfirmationData } from '../../transcript/live';
import { THREAD_TOOL_CANCEL_VALUE, THREAD_TOOL_CONFIRM_KIND, THREAD_TOOL_CONFIRM_VALUE } from '../../transcript/parts';
import type { AgentToolDoor } from '../../agent/door/AgentToolDoor';
import { doorToolOutcome, type AgentToolPreflight } from '../../agent/door/types';
import type { AgentToolOutputProjection, AgentToolModelOutput } from '../../agent/ToolOutput';
import { ToolFailed, type Tool, type ToolCallArrival, type ToolOutcome } from '../../agent/tool';
import type { ToolDisplay } from '../../tool/display';
import type { ToolCatalog } from '../../agent/ToolCatalog';
import { agentFailureCause } from '../../agent/AgentFailure';
import { Clock, Effect } from 'effect';
import type { RunStop } from '../../agent/RunStop';
import { outcomeRefusal } from '../../modes/ApprovalMode';
import { ThreadCallBroke } from '../ThreadBorder';
import { EFFECT_STOPPED_BEFORE_SETTLING, READ_UNANSWERED } from './ThreadEffectSettlement';

const MAX_TOOL_QUESTION_KEY_LENGTH = 512;

export type AskedToolCall = {
  runId: string;
  toolCallId: string;
  toolName: string;
  input: unknown;
};

export type ToolQuestionCall = {
  toolCallId: string;
  toolName: string;
};

export type ToolQuestionResult = ToolQuestionCall & {
  readonly outcome: ToolOutcome;
  readonly modelOutput: AgentToolModelOutput;
  readonly display?: ToolDisplay;
  readonly retained?: AgentToolOutputProjection['retained'];
  readonly durationMs?: number;
};

export function unansweredOutput(question: ThreadQuestionEntry, timeoutMs: number, action: string) {
  const outcome = { kind: 'unanswered', questionId: question.questionId, askedOf: question.approver ?? 'operator', timeoutMs } as const;
  return { ...outcomeRefusal(outcome, action), questionId: outcome.questionId, askedOf: outcome.askedOf, timeoutMs };
}

export function declinedOutput(question: ThreadQuestionEntry, action: string) {
  const outcome = { kind: 'declined', by: question.decision?.by ?? 'operator', note: question.decision?.note } as const;
  return { ...outcomeRefusal(outcome, action), by: outcome.by, ...(outcome.note === undefined ? {} : { note: outcome.note }) };
}

export function unansweredResult(call: ToolQuestionCall, question: ThreadQuestionEntry, timeoutMs: number): ToolQuestionResult {
  const output = unansweredOutput(question, timeoutMs, call.toolName);
  return { ...call, outcome: { kind: 'denied', output }, modelOutput: { type: 'json', value: output } };
}

export function declinedBy(question: Pick<ThreadQuestionEntry, 'decision'>): { readonly by?: string; readonly note?: string } {
  const decision = question.decision;
  return {
    by: decision?.by,
    note: decision?.note,
  };
}

export function unansweredDeadline(withinMs: number): string {
  const minutes = withinMs / 60_000;
  return `no answer in ${Number.isInteger(minutes) ? `${minutes} minutes` : `${Math.round(withinMs / 1000)} seconds`}`;
}

type ToolAnswer = NonNullable<ThreadQuestionEntry['answers']>[number];
type ToolPrompt = ThreadQuestionEntry['questions'][number];

export function toolQuestionFromCall(
  door: AgentToolDoor,
  catalog: ToolCatalog,
  call: AskedToolCall,
  askedAt: string,
): ThreadQuestionEntry | null {
  const entry = catalogEntry(catalog, call.toolName);
  if (!entry) return null;
  const prepared = door.preflighted({
    name: call.toolName,
    tool: entry,
    input: call.input,
    toolCallId: call.toolCallId,
  });
  if (!prepared) return null;
  return toolQuestionOf(call, prepared, askedAt);
}

export function toolQuestionOf(call: AskedToolCall, prepared: AgentToolPreflight, askedAt: string): ThreadQuestionEntry | null {
  const prompt = toolPromptFromCall(prepared.tool, call, prepared);
  return prompt ? questionEntry([{ call, prompt }], [call], askedAt) : null;
}

export const toolQuestionFromCalls = Effect.fn('toolQuestionFromCalls')(
  function* (door: AgentToolDoor, catalog: ToolCatalog, calls: readonly AskedToolCall[], askedAt: string) {
    const prompts = (yield* Effect.all(
      calls.map((call) => {
        const entry = catalogEntry(catalog, call.toolName);
        if (!entry) return Effect.succeed(null);
        return Effect.map(
          door.preflight({
            name: call.toolName,
            tool: entry,
            input: call.input,
            toolCallId: call.toolCallId,
          }),
          (prepared) => {
            const prompt = toolPromptFromCall(entry, call, prepared);
            return prompt ? { call, prompt } : null;
          },
        );
      }),
    )).filter((entry): entry is { call: AskedToolCall; prompt: ToolPrompt } => entry !== null);
    return questionEntry(prompts, calls, askedAt);
  },
  Effect.mapError((failure) => new ThreadCallBroke({ cause: agentFailureCause(failure) })),
);

function questionEntry(
  prompts: readonly { call: AskedToolCall; prompt: ToolPrompt }[],
  calls: readonly AskedToolCall[],
  askedAt: string,
): ThreadQuestionEntry | null {
  const first = prompts[0]?.call;
  if (!first) return null;
  if (prompts.length !== calls.length) {
    throw new Error('Cannot group tool confirmations with calls the rules never asked about.');
  }
  const toolCallIds = prompts.map((entry) => entry.call.toolCallId);
  return {
    type: 'question',
    id: questionEntryId(first.runId, toolCallIds),
    runId: first.runId,
    questionId: toolQuestionKey(first.runId, toolCallIds),
    questions: prompts.map((entry) => entry.prompt),
    toolCalls: prompts.map(({ call }) => ({ toolCallId: call.toolCallId, toolName: call.toolName })),
    status: 'open',
    occurredAt: askedAt,
  };
}

export function isToolConfirmationQuestion(question: ThreadQuestionEntry): boolean {
  return toolCallsFromQuestion(question).length > 0;
}

export function bypassAnswers(question: ThreadQuestionEntry): readonly ToolAnswer[] {
  return toolCallsFromQuestion(question).map((call) => ({ questionId: call.toolCallId, values: [THREAD_TOOL_CONFIRM_VALUE] }));
}

export function bypassedAnswers(question: ThreadQuestionEntry): readonly ToolAnswer[] | null {
  if (isToolConfirmationQuestion(question)) return bypassAnswers(question);
  const prompts = question.questions;
  if (prompts.length === 0 || prompts.some((prompt) => prompt.approves === undefined)) return null;
  return prompts.map((prompt) => ({ questionId: prompt.id, values: [prompt.approves!] }));
}

export function toolCallsFromQuestion(question: ThreadQuestionEntry): readonly ToolQuestionCall[] {
  const confirmationIds = new Set(
    question.questions.filter((prompt) => prompt.kind === THREAD_TOOL_CONFIRM_KIND).map((prompt) => prompt.toolCallId),
  );
  return question.toolCalls.filter((call) => confirmationIds.has(call.toolCallId));
}

const CALL_SCOPE_TAGS = ['AgentToolFailed', 'AgentToolCallReused', 'AgentToolCallRegenerated'] as const;

export const readApprovedCalls = Effect.fn('readApprovedCalls')(function* (
  door: AgentToolDoor,
  catalog: ToolCatalog,
  question: ThreadQuestionEntry,
  answers: readonly ToolAnswer[],
  inputs: ReadonlyMap<string, unknown>,
) {
  for (const call of toolCallsFromQuestion(question)) {
    const entry = catalogEntry(catalog, call.toolName);
    if (!entry || !confirmedByReader(answers, call.toolCallId)) continue;
    yield* door
      .approved({
        name: call.toolName,
        tool: entry,
        input: inputs.get(call.toolCallId),
        toolCallId: call.toolCallId,
      })
      .pipe(Effect.catchTag(CALL_SCOPE_TAGS, () => Effect.void));
  }
});

export function confirmedByReader(answers: readonly ToolAnswer[], toolCallId: string): boolean {
  const answer = answers.find((candidate) => candidate.questionId === toolCallId);
  return answer?.values.includes(THREAD_TOOL_CONFIRM_VALUE) === true;
}

export const toolResultsFromQuestion = Effect.fn('toolResultsFromQuestion')(function* (
  door: AgentToolDoor,
  catalog: ToolCatalog,
  question: ThreadQuestionEntry,
  answers: readonly ToolAnswer[],
  inputs: ReadonlyMap<string, unknown>,
  options: ToolCallArrival,
  halt?: RunStop,
) {
  const calls = toolCallsFromQuestion(question);
  const results: ToolQuestionResult[] = [];
  for (const call of calls) {
    const entry = catalogEntry(catalog, call.toolName);
    if (!entry) return yield* Effect.die(new Error(`Confirmed assistant tool is not in the catalog: ${call.toolName}.`));
    const input = inputs.get(call.toolCallId);
    const held = yield* door
      .approved({ name: call.toolName, tool: entry, input, toolCallId: call.toolCallId })
      .pipe(Effect.catchTag(CALL_SCOPE_TAGS, () => Effect.succeed(null)));
    if (!inputs.has(call.toolCallId)) return yield* Effect.die(new Error(`Confirmed assistant tool has no input: ${call.toolCallId}.`));
    const withinMs = question.timeoutMs === undefined ? held?.reader?.withinMs : (question.timeoutMs ?? undefined);
    if (withinMs !== undefined) {
      const askedAt = question.occurredAt === undefined ? Number.NaN : Date.parse(question.occurredAt);
      const now = yield* Clock.currentTimeMillis;
      if (Number.isFinite(askedAt) && now - askedAt > withinMs) {
        const result = unansweredResult(call, question, withinMs);
        door.decline(call.toolCallId, unansweredDeadline(withinMs), 'stopped');
        results.push(result);
        continue;
      }
    }
    if (!confirmedByReader(answers, call.toolCallId) || halt?.stopped === true) {
      const stopped = halt?.stopped === true;
      const output = stopped
        ? { status: 'cancelled', reason: 'The run stopped before this call began.' }
        : declinedOutput(question, call.toolName);
      door.decline(call.toolCallId, output.reason, 'stopped');
      results.push({
        ...call,
        outcome: stopped ? { kind: 'cancelled', output } : { kind: 'denied', output },
        modelOutput: { type: 'json', value: output },
      });
      continue;
    }
    if (!inputs.has(call.toolCallId)) return yield* Effect.die(new Error(`Confirmed assistant tool has no input: ${call.toolCallId}.`));
    const settling = door.settle(
      {
        name: call.toolName,
        tool: entry,
        input,
        confirmed: true,
        options: { ...options, toolCallId: call.toolCallId },
      },
      held ?? undefined,
    );
    const settled = yield* (halt === undefined ? settling : halt.cut(settling, stoppedUnsettled(entry))).pipe(
      Effect.catchTag(CALL_SCOPE_TAGS, (failure) =>
        Effect.succeed(
          halt?.stopped === true
            ? stoppedUnsettled(entry)
            : toolExecutionFailure(agentFailureCause(failure), failure._tag === 'AgentToolFailed' ? failure.durationMs : undefined),
        ),
      ),
    );
    if ('outcome' in settled) {
      results.push({
        ...call,
        outcome: settled.outcome,
        modelOutput: { type: 'error', value: settled.reason },
        durationMs: settled.durationMs,
      });
      continue;
    }
    results.push({
      ...call,
      outcome: doorToolOutcome(settled),
      modelOutput: settled.modelOutput,
      retained: settled.retained,
      display: settled.display,
      durationMs: settled.durationMs,
    });
  }
  return results as readonly ToolQuestionResult[];
});

function toolPromptFromCall(entry: Tool, call: AskedToolCall, prepared: AgentToolPreflight): ToolPrompt | null {
  const verdict = prepared.permission;
  if (verdict.verdict !== 'ask') return null;
  const confirmation = prepared.confirmation;
  const consequence = confirmation?.consequence;
  return {
    id: call.toolCallId,
    toolCallId: call.toolCallId,
    kind: THREAD_TOOL_CONFIRM_KIND,
    prompt: confirmation?.summary ?? `Allow ${call.toolName}?`,
    options: [
      { value: THREAD_TOOL_CONFIRM_VALUE, label: entry.confirmation?.confirmLabel ?? 'Allow' },
      { value: THREAD_TOOL_CANCEL_VALUE, label: 'Cancel' },
    ],
    data: toolConfirmationData({
      toolName: call.toolName,
      asked: verdict.reasons.map((reason) => reason.id),
      facts: confirmation?.facts?.length ? confirmation.facts : undefined,
      consequence: consequence || undefined,
      intent: entry.confirmation?.intent ? entry.confirmation.intent : undefined,
    }),
  };
}

function catalogEntry(catalog: ToolCatalog, toolName: string): Tool | null {
  const value = catalog[toolName];
  return value ?? null;
}

type Unsettled = { readonly outcome: ToolOutcome; readonly reason: string; readonly durationMs?: number };

export function toolExecutionFailure(error: unknown, durationMs?: number): Unsettled {
  const reason = error instanceof Error ? error.message : String(error);
  const refusal = error instanceof ToolFailed ? error.refusal : null;
  if (refusal !== null) return { outcome: { kind: 'refused', refusal, output: { status: 'refused', reason } }, reason, durationMs };
  return { outcome: { kind: 'failed', error: reason, output: { status: 'failed', reason } }, reason, durationMs };
}

function stoppedUnsettled(entry: Tool): Unsettled {
  return entry.mutates === true
    ? { outcome: { kind: 'unknown', output: EFFECT_STOPPED_BEFORE_SETTLING }, reason: EFFECT_STOPPED_BEFORE_SETTLING }
    : { outcome: { kind: 'cancelled', output: READ_UNANSWERED }, reason: READ_UNANSWERED };
}

function toolQuestionKey(runId: string, toolCallIds: readonly string[]): string {
  const key =
    toolCallIds.length === 1
      ? (encodeSegment(toolCallIds[0]) ?? runId)
      : `tool-confirm:${[runId, ...toolCallIds].map(encodeSegment).join(':')}`;
  if (key.length <= MAX_TOOL_QUESTION_KEY_LENGTH) return key;
  return `tool-confirm:${hashKey([runId, ...toolCallIds])}`;
}

function encodeSegment(segment: string | undefined): string | undefined {
  return segment === undefined ? undefined : encodeURIComponent(segment);
}

function hashKey(parts: readonly string[]): string {
  return sha256().update(parts.join('\0')).digest('base64url').slice(0, 24);
}
