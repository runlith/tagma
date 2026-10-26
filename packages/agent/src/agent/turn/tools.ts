import { Effect, Semaphore } from 'effect';
import type { AgentPhase } from '../AgentPhase';
import { ToolResultValue, type ContentPart, type Message, type ToolResultRetention } from '@runlith/llm/schema/messages';
import type { ProviderMetadata } from '@runlith/llm/schema/ids';
import {
  agentToolRefusal,
  type AgentHostFailed,
  type AgentRunFailure,
  type AgentToolCallRegenerated,
  type AgentToolCallReused,
  type AgentToolFailed,
  type AgentToolFailure,
} from '../AgentFailure';
import { DEFERRED_HOW_TO, TOOL_SEARCH_TOOL, unrevealedDefinition } from '../AgentDeferredTools';
import type { AgentSink } from '../AgentRunner';
import type { AgentStepIntent } from '../AgentStep';
import type { CallAfter } from '../callProgress';
import type { ModelRequest } from '../modelPort';
import type { AgentToolDoor } from '../door/AgentToolDoor';
import { CallStoppedInQueue, queuedReason } from '../door/CallOrder';
import {
  doorToolOutcome,
  type AgentToolInvocation,
  type AgentToolOutcome as AgentDoorOutcome,
  type AgentToolPreflight,
} from '../door/types';
import { doorOutput } from '../door/outcomeText';
import { type Claim, Tool, ToolFailed, documentAsked, toolExecute } from '../tool';
import { ToolArgumentsInvalid, toolArguments } from '../ToolArguments';
import { doorToolModelOutput, initialToolDisplay, previewed, type AgentToolModelOutput } from '../ToolOutput';
import type { RunStop } from '../RunStop';

export type AgentToolOutcome = {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly input: unknown;
  readonly executed: boolean;
  readonly refused: boolean;
  readonly output: unknown;
  readonly error: unknown;
  readonly modelOutput: AgentToolModelOutput;
  readonly retained?: ToolResultRetention;
  readonly durationMs?: number;
  readonly providerMetadata: ProviderMetadata | undefined;
};

export type AgentStepTools = {
  readonly outcomes: readonly AgentToolOutcome[];
  readonly everyCallSettled: boolean;
};

export type AgentStepToolsDoor = {
  readonly unattended: boolean;
  claims: AgentToolDoor['claims'];
  order: AgentToolDoor['order'];
  attend: AgentToolDoor['attend'];
  keep: AgentToolDoor['keep'];
  receipt: AgentToolDoor['receipt'];
  settle: AgentToolDoor['settle'];
};

export type AgentStepToolsInput = {
  readonly message: Message;
  readonly sources: ReadonlyMap<string, Tool>;
  readonly door: AgentStepToolsDoor;
  readonly stop: RunStop;
  readonly feed: AgentSink;
  readonly phase: (phase: AgentPhase['phase']) => Effect.Effect<void>;
  readonly callMessages: readonly Message[];
  readonly arguments: Readonly<Record<string, string>>;
  readonly resultRetention?: ModelRequest['resultRetention'];
  readonly stepNumber: number;
  readonly commitEffects?: ((intent: AgentStepIntent) => Effect.Effect<void, AgentHostFailed>) | undefined;
};

type ClientToolCallPart = Extract<ContentPart, { type: 'tool-call' }>;

type AgentCallRefused = AgentToolFailed | AgentToolCallReused | AgentToolCallRegenerated;

const CALL_REFUSALS = ['AgentToolFailed', 'AgentToolCallReused', 'AgentToolCallRegenerated'] as const;

type AgentStepCall =
  | { readonly kind: 'replay'; readonly part: ClientToolCallPart; readonly replay: Effect.Effect<AgentDoorOutcome, AgentToolFailure> }
  | { readonly kind: 'failed'; readonly part: ClientToolCallPart; readonly failure: AgentCallRefused }
  | { readonly kind: 'unstarted'; readonly part: ClientToolCallPart }
  | { readonly kind: 'ready'; readonly part: ClientToolCallPart; readonly entry: Tool }
  | { readonly kind: 'queued'; readonly part: ClientToolCallPart; readonly entry: Tool; readonly after: readonly CallAfter[] }
  | {
      readonly kind: 'prepared';
      readonly part: ClientToolCallPart;
      readonly entry: Tool;
      readonly prepared: AgentToolPreflight;
      readonly waiting: boolean;
    }
  | { readonly kind: 'answered'; readonly part: ClientToolCallPart; readonly outcome: AgentDoorOutcome };

type AgentPreparedCall = Extract<AgentStepCall, { kind: 'prepared' }>;

type AgentAdmittedCall = Extract<AgentStepCall, { kind: 'prepared' | 'failed' | 'answered' }>;

export const runStepTools = Effect.fn('runStepTools')(function* (input: AgentStepToolsInput) {
  const content = input.message.content;
  const parts = clientToolCalls(content);
  if (parts.length > 0) {
    yield* input.phase('tools');
  }
  const unanswerable = (yield* Effect.all(parts.map((part) => unansweredCall(input, part)))).filter(
    (outcome): outcome is AgentToolOutcome => outcome !== null,
  );
  const scheduled = yield* scheduleCalls(input, parts);
  const first = yield* Effect.all(
    scheduled.map((call) => (call.kind === 'ready' ? prepareCall(input, call) : Effect.succeed(call))),
    { concurrency: 'unbounded' },
  );
  const commit = yield* intents(input);
  yield* commit(first.filter((call): call is AgentPreparedCall => call.kind === 'prepared' && !call.waiting));
  const outcomes = [...unanswerable, ...(yield* executeTools(input, first, commit))];
  const calls = content.filter((part): part is ClientToolCallPart => part.type === 'tool-call');
  const settledIds = new Set([
    ...outcomes.map((outcome) => outcome.toolCallId),
    ...content.flatMap((part) => (part.type === 'tool-result' ? [part.id] : [])),
  ]);
  return {
    outcomes,
    everyCallSettled: calls.length > 0 && calls.every((part) => settledIds.has(part.id)),
  } satisfies AgentStepTools;
});

export type AgentClosedStepInput = {
  readonly message: Message;
  readonly feed: AgentSink;
  readonly refusal: string;
};

export const closeStepTools = Effect.fn('closeStepTools')(function* (input: AgentClosedStepInput) {
  const outcomes = yield* Effect.forEach(clientToolCalls(input.message.content), (part) => unanswerableCall(input, part, input.refusal));
  return { outcomes, everyCallSettled: outcomes.length > 0 } satisfies AgentStepTools;
});

type Intents = (calls: readonly AgentPreparedCall[]) => Effect.Effect<void, AgentHostFailed>;

const intents = Effect.fnUntraced(function* (input: AgentStepToolsInput) {
  const { commitEffects } = input;
  const gate = yield* Semaphore.make(1);
  let carried = false;
  const commit: Intents = (calls) =>
    calls.length === 0 || commitEffects === undefined
      ? Effect.void
      : gate.withPermits(1)(
          Effect.suspend(() => {
            const messages = carried ? [] : [input.message];
            carried = true;
            return commitEffects({
              stepNumber: input.stepNumber,
              messages,
              calls: calls.map(({ part }) => ({ toolCallId: part.id, toolName: part.name, input: part.input })),
            });
          }),
        );
  return commit;
});

type AgentClaimedCall = {
  readonly kind: 'claimed';
  readonly part: ClientToolCallPart;
  readonly entry: Tool;
  readonly claims: readonly Claim[];
};

const scheduleCalls = Effect.fnUntraced(function* (input: AgentStepToolsInput, parts: readonly ClientToolCallPart[]) {
  const claimed = yield* Effect.all(
    parts.map((part): Effect.Effect<AgentStepCall | AgentClaimedCall | null> => {
      if (part.unparsed !== undefined) return Effect.succeed(null);
      const receipt = input.door.receipt(part.id, part.name, part.input);
      if (receipt !== null) return Effect.succeed({ kind: 'replay', part, replay: receipt });
      const entry = input.sources.get(part.name);
      if (!entry || !toolExecute(entry)) return Effect.succeed(null);
      return input.stop.cut(
        input.door.claims({ name: part.name, input: part.input, tool: entry, toolCallId: part.id }).pipe(
          Effect.map((claims): AgentStepCall | AgentClaimedCall => ({ kind: 'claimed', part, entry, claims })),
          Effect.catchTag('AgentToolFailed', (failure) => Effect.succeed<AgentStepCall>({ kind: 'failed', part, failure })),
        ),
        { kind: 'unstarted', part } as const,
      );
    }),
    { concurrency: 'unbounded' },
  );
  const placing = claimed.flatMap((call) => (call?.kind === 'claimed' ? [call] : []));
  input.door.order.place(placing.map(({ part, claims }) => ({ toolCallId: part.id, name: part.name, claims })));
  return claimed.flatMap((call): AgentStepCall[] => {
    if (call === null) return [];
    if (call.kind !== 'claimed') return [call];
    const after = input.door.order.blockers(call.part.id);
    return [
      after.length === 0
        ? { kind: 'ready', part: call.part, entry: call.entry }
        : { kind: 'queued', part: call.part, entry: call.entry, after },
    ];
  });
});

function invocationOf(input: AgentStepToolsInput, part: ClientToolCallPart, entry: Tool): AgentToolInvocation {
  return {
    name: part.name,
    tool: entry,
    input: part.input,
    arguments: input.arguments[part.id],
    resultRetention: input.resultRetention,
    onExecution: (admission) => input.feed.push({ type: 'tool-execution', toolCallId: part.id, admission }),
    options: { toolCallId: part.id, messages: [...input.callMessages] },
  };
}

function prepareCall(
  input: AgentStepToolsInput,
  { part, entry }: { readonly part: ClientToolCallPart; readonly entry: Tool },
): Effect.Effect<AgentAdmittedCall, AgentRunFailure> {
  return input.door.attend(invocationOf(input, part, entry)).pipe(
    Effect.tap((attended) => {
      const declared = attended.kind === 'prepared' ? attended.prepared.display : undefined;
      if (!declared) return Effect.void;
      return Effect.flatMap(
        previewed(() => initialToolDisplay({ declared, mutates: entry.mutates === true, keep: entry.keepsTail ? 'tail' : 'head' })),
        (display) => (display === undefined ? Effect.void : input.feed.push({ type: 'tool-display', toolCallId: part.id, display })),
      );
    }),
    Effect.map((attended): AgentAdmittedCall =>
      attended.kind === 'answered'
        ? { kind: 'answered', part, outcome: attended.outcome }
        : {
            kind: 'prepared',
            part,
            entry,
            prepared: attended.prepared,
            waiting: attended.prepared.permission.verdict === 'ask' && !input.door.unattended,
          },
    ),
    Effect.catchTag(CALL_REFUSALS, (failure) => Effect.succeed<AgentAdmittedCall>({ kind: 'failed', part, failure })),
  );
}

function executeTools(
  input: AgentStepToolsInput,
  calls: readonly AgentStepCall[],
  commit: Intents,
): Effect.Effect<readonly AgentToolOutcome[], AgentRunFailure> {
  const finished = Effect.fnUntraced(function* (part: ClientToolCallPart, decoded: unknown, settled: AgentDoorOutcome) {
    yield* input.feed.push({ type: 'tool-display', toolCallId: part.id, display: settled.display });
    yield* input.feed.push({ type: 'tool-outcome', toolCallId: part.id, toolName: part.name, outcome: doorToolOutcome(settled) });
    return {
      toolCallId: part.id,
      toolName: part.name,
      input: decoded,
      executed: settled.executed,
      refused: !settled.executed,
      output: settled.executed ? settled.output : undefined,
      error: settled.executed ? null : settled.output,
      modelOutput: settled.modelOutput,
      durationMs: settled.durationMs,
      retained: settled.retained,
      providerMetadata: part.providerMetadata,
    } satisfies AgentToolOutcome;
  });

  const execute = ({ part, entry, prepared }: AgentPreparedCall) =>
    input.door.settle(invocationOf(input, part, entry), prepared).pipe(
      Effect.flatMap((settled) => finished(part, prepared.input, settled)),
      Effect.catchTag(CALL_REFUSALS, (caught) => failedTool(input, part, caught)),
    );

  const waiting: AgentPreparedCall[] = [];

  const admitted = (call: AgentAdmittedCall): Effect.Effect<AgentToolOutcome | null, AgentRunFailure> =>
    call.kind === 'failed'
      ? failedTool(input, call.part, call.failure)
      : call.kind === 'answered'
        ? finished(call.part, call.part.input, call.outcome)
        : call.waiting
          ? Effect.sync(() => {
              waiting.push(call);
              return null;
            })
          : execute(call);

  const kept = ({ part, entry, prepared }: AgentPreparedCall): Effect.Effect<AgentToolOutcome | null, AgentRunFailure> =>
    input.door.keep(invocationOf(input, part, entry)).pipe(
      Effect.flatMap((receipt) => (receipt === null ? Effect.succeed(null) : finished(part, prepared.input, receipt))),
      Effect.catchTag(CALL_REFUSALS, (caught) => failedTool(input, part, caught)),
    );

  const run = Effect.fnUntraced(function* (call: AgentStepCall): Effect.fn.Return<AgentToolOutcome | null, AgentRunFailure> {
    switch (call.kind) {
      case 'unstarted':
        return yield* unstartedCall(input, call.part, input.stop.message);
      case 'replay':
        return yield* call.replay.pipe(
          Effect.flatMap((settled) => finished(call.part, call.part.input, settled)),
          Effect.catchTag(CALL_REFUSALS, (caught) => failedTool(input, call.part, caught)),
        );
      case 'ready':
        return yield* admitted(yield* prepareCall(input, call));
      case 'queued': {
        yield* input.feed.push({
          type: 'tool-execution',
          toolCallId: call.part.id,
          admission: { state: 'queued', reason: queuedReason(call.after), after: call.after },
        });
        const prepared = yield* prepareCall(input, call);
        if (prepared.kind === 'prepared' && !prepared.waiting) yield* commit([prepared]);
        return yield* admitted(prepared);
      }
      default:
        return yield* admitted(call);
    }
  });

  return Effect.all(calls.map(run), { concurrency: 'unbounded' }).pipe(
    Effect.flatMap((outcomes) => Effect.map(Effect.forEach(waiting, kept), (late) => [...outcomes, ...late])),
    Effect.map((outcomes) => outcomes.filter((outcome): outcome is AgentToolOutcome => outcome !== null)),
  );
}

function failedTool(input: AgentStepToolsInput, part: ClientToolCallPart, failure: AgentCallRefused): Effect.Effect<AgentToolOutcome> {
  if (failure._tag === 'AgentToolFailed' && failure.cause instanceof ToolArgumentsInvalid) return invalidCall(input, part, failure.cause);
  return Effect.gen(function* () {
    const error = readableToolFailure(failure);
    const refusal = agentToolRefusal(failure);
    const document = failure._tag === 'AgentToolFailed' && failure.cause instanceof ToolFailed ? failure.cause.output : null;
    const unstarted = failure._tag === 'AgentToolFailed' && failure.cause instanceof CallStoppedInQueue ? failure.cause : null;
    yield* input.feed.push({
      type: 'tool-outcome',
      toolCallId: part.id,
      toolName: part.name,
      outcome:
        unstarted !== null
          ? { kind: 'cancelled', output: { status: 'cancelled', reason: unstarted.reason } }
          : refusal === null
            ? { kind: 'failed', error }
            : { kind: 'refused', refusal },
    });
    return {
      toolCallId: part.id,
      toolName: part.name,
      input: part.input,
      executed: false,
      refused: true,
      output: undefined,
      error: failure,
      modelOutput:
        document !== null && documentAsked(input.sources.get(part.name), part.input)
          ? doorToolModelOutput(document)
          : ToolResultValue.from(failure.message, 'error'),
      durationMs: failure._tag === 'AgentToolFailed' && failure.durationMs !== undefined ? failure.durationMs : undefined,
      providerMetadata: part.providerMetadata,
    } satisfies AgentToolOutcome;
  });
}

const UNPARSED_SHOWN = 200;

function unparsedInput(name: string, raw: string): string {
  const shown = raw.length > UNPARSED_SHOWN ? `, the first ${UNPARSED_SHOWN} shown` : '';
  return `The input of ${name} was not valid JSON, so the call did not run (${raw.length} characters received${shown}): ${raw.slice(0, UNPARSED_SHOWN)}\nA response cut off by the output limit leaves its last call unfinished; send the call again with complete JSON, splitting large input into smaller calls.`;
}

function unansweredCall(input: AgentStepToolsInput, part: ClientToolCallPart): Effect.Effect<AgentToolOutcome | null> {
  if (part.unparsed !== undefined) return unanswerableCall(input, part, unparsedInput(part.name, part.unparsed));
  if (input.door.receipt(part.id, part.name, part.input) !== null) return Effect.succeed(null);
  const entry = input.sources.get(part.name);
  if (entry === undefined) return unanswerableCall(input, part, unknownToolName(input.sources, part.name));
  if (toolExecute(entry) !== null) return Effect.succeed(null);
  return toolArguments(entry, part.name, part.input, input.sources).pipe(
    Effect.matchEffect({
      onFailure: (invalid) => invalidCall(input, part, invalid),
      onSuccess: () =>
        input.door.unattended
          ? unanswerableCall(input, part, `${part.name} is answered by a reader, and this run has nobody to ask.`)
          : Effect.succeed(null),
    }),
  );
}

const invalidCall = Effect.fnUntraced(function* (input: AgentStepToolsInput, part: ClientToolCallPart, refused: ToolArgumentsInvalid) {
  const tool = input.sources.get(part.name);
  const unrevealed = tool === undefined ? null : unrevealedDefinition(part.name, tool, input.callMessages);
  const failure = unrevealed === null ? refused : refused.revealing(unrevealed);
  const refusal = failure.refusal;
  const output = failure.output;
  yield* input.feed.push({
    type: 'tool-outcome',
    toolCallId: part.id,
    toolName: part.name,
    outcome: { kind: 'refused', refusal, output },
  });
  return {
    toolCallId: part.id,
    toolName: part.name,
    input: part.input,
    executed: false,
    refused: true,
    output: undefined,
    error: failure,
    modelOutput: doorOutput(tool, part.input, output, () => failure.text),
    providerMetadata: part.providerMetadata,
  } satisfies AgentToolOutcome;
});

export function unknownToolName(sources: ReadonlyMap<string, Tool>, called: string): string {
  const spelled = catalogSpelling(sources, called);
  if (spelled !== undefined) {
    return `No tool named "${called}" exists in this run; the catalog spells it "${spelled}". Call "${spelled}".`;
  }
  const absent = `No tool named "${called}" exists in this run.`;
  return sources.has(TOOL_SEARCH_TOOL) ? `${absent} ${DEFERRED_HOW_TO}` : absent;
}

const NAMESPACE = /^[\w-]+(?:__|\.|\/)$/;

function catalogSpelling(sources: ReadonlyMap<string, Tool>, called: string): string | undefined {
  let found: string | undefined;
  for (const name of sources.keys()) {
    if (called.length <= name.length || !called.endsWith(name)) continue;
    if (!NAMESPACE.test(called.slice(0, called.length - name.length))) continue;
    if (found === undefined || name.length > found.length) found = name;
  }
  if (found !== undefined) return found;
  const namespaced = [...sources.keys()].filter(
    (name) => name.length > called.length && name.endsWith(called) && NAMESPACE.test(name.slice(0, name.length - called.length)),
  );
  return namespaced.length === 1 ? namespaced[0] : undefined;
}

const unstartedCall = Effect.fnUntraced(function* (input: AgentStepToolsInput, part: ClientToolCallPart, reason: string) {
  yield* input.feed.push({
    type: 'tool-outcome',
    toolCallId: part.id,
    toolName: part.name,
    outcome: { kind: 'cancelled', output: { status: 'cancelled', reason } },
  });
  return {
    toolCallId: part.id,
    toolName: part.name,
    input: part.input,
    executed: false,
    refused: true,
    output: undefined,
    error: reason,
    modelOutput: ToolResultValue.from(`${reason} The call had not started.`, 'error'),
    providerMetadata: part.providerMetadata,
  } satisfies AgentToolOutcome;
});

const unanswerableCall = Effect.fnUntraced(function* (
  input: { readonly feed: AgentStepToolsInput['feed'] },
  part: ClientToolCallPart,
  message: string,
) {
  const failure = new ToolFailed({ reason: message });
  yield* input.feed.push({
    type: 'tool-outcome',
    toolCallId: part.id,
    toolName: part.name,
    outcome: { kind: 'failed', error: message },
  });
  return {
    toolCallId: part.id,
    toolName: part.name,
    input: part.input,
    executed: false,
    refused: true,
    output: undefined,
    error: failure,
    modelOutput: ToolResultValue.from(message, 'error'),
    providerMetadata: part.providerMetadata,
  } satisfies AgentToolOutcome;
});

export function readableToolFailure(failure: AgentCallRefused): string {
  const cause = failure._tag === 'AgentToolFailed' ? failure.cause : null;
  return cause instanceof ToolFailed || cause instanceof ToolArgumentsInvalid || cause instanceof CallStoppedInQueue
    ? cause.message
    : 'An error occurred.';
}

export function clientToolCalls(content: readonly ContentPart[]): readonly ClientToolCallPart[] {
  return content.filter((part): part is ClientToolCallPart => part.type === 'tool-call' && part.providerExecuted !== true);
}
