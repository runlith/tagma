import { unthreadedCaller } from '../../../agent/testing/caller';
import { builtinMode } from '../../../agent/testing/modes';
import { Deferred, Effect, Schema, Stream } from 'effect';
import { Tool } from '../../../agent/tool';
import type { AgentEvent } from '../../../agent/AgentEvent';
import { openToolDoor } from '../../../agent/door/openToolDoor';
import { ToolJudge } from '../../../agent/door/openToolDoor';
import { Message, ToolCallPart } from '@runlith/llm/schema/messages';
import { Usage } from '@runlith/llm/schema/events';
import { type ToolCatalog } from '../../../agent/ToolCatalog';
import type { AgentStep } from '../../../agent/AgentStep';
import type { AgentRunOutput } from '../../../agent/AgentRunner';
import { AgentRunBroke } from '../../../agent/AgentFailure';
import { USER_QUESTION_TOOL_NAME } from '../../../transcript/parts';
import { threadUserQuestionTools } from '../../../tools/UserQuestion';
import type { ThreadTransitionStorage } from '../../transition/port';
import { type ScriptedCrossing, type ScriptedTurn, type ScriptedWorld } from './world';
import { replyTurn, stopLatch, scriptedStep, zeroUsage } from './scripts';
import { gate as readGate } from './support';
import { ASKS_IN_REVIEW } from '../../../permissions/vocabulary';

export function dyingToolTurn(toolName = 'write_file', toolInput: unknown = { path: 'a.txt' }): ScriptedTurn {
  return (input) => {
    const halt = stopLatch();
    const never = Effect.flatMap(halt.said, (cause) => Effect.fail(new AgentRunBroke({ cause })));
    const events = Stream.concat(
      Stream.fromIterable<AgentEvent>([
        { type: 'tool-input-start', id: 'call-1', name: toolName },
        { type: 'tool-call', id: 'call-1', name: toolName, input: toolInput },
      ]),
      Stream.drain(
        Stream.fromEffect(
          Effect.gen(function* () {
            if (input.commitEffects)
              yield* input.commitEffects({
                stepNumber: input.stepsTaken ?? 0,
                messages: [{ role: 'assistant', content: [{ type: 'tool-call', id: 'call-1', name: toolName, input: toolInput }] }],
                calls: [{ toolCallId: 'call-1', toolName, input: toolInput }],
              });
            yield* halt.said;
          }).pipe(Effect.mapError((cause) => new AgentRunBroke({ cause }))),
        ),
      ),
    );
    const output: AgentRunOutput = { text: never, finishReason: never, usage: never, response: never, steps: never };
    return {
      instructions: '',
      output,
      events,
      catalog: {},
      door: openToolDoor(input.run.id, unthreadedCaller, {}, new ToolJudge(builtinMode('trust'))),
      completedSteps: () => [],
      stop: halt.stop,
    };
  };
}

export function askingTurn(): ScriptedTurn {
  const call = {
    toolCallId: 'call-1',
    toolName: USER_QUESTION_TOOL_NAME,
    input: { questions: [{ prompt: 'Which branch should I take?', allowFreeform: true }] },
  };
  return (input) => {
    const finished = Deferred.makeUnsafe<void>();
    const step = scriptedStep({
      text: '',
      messages: [Message.assistant([ToolCallPart.from({ id: call.toolCallId, name: call.toolName, input: call.input })])],
      toolCalls: [call],
    });
    const completed: AgentStep[] = [];
    const settled = Deferred.await(finished);
    const events = Stream.concat(
      Stream.fromIterable<AgentEvent>([
        { type: 'tool-input-start', id: call.toolCallId, name: call.toolName },
        { type: 'tool-call', id: call.toolCallId, name: call.toolName, input: call.input },
      ]),
      Stream.drain(
        Stream.fromEffect(
          Effect.gen(function* () {
            if (input.commitEffects) yield* input.commitEffects({ stepNumber: 0, messages: step.response?.messages ?? [], calls: [call] });
            completed.push(step);
            yield* Deferred.succeed(finished, undefined);
            yield* Effect.yieldNow;
          }).pipe(Effect.mapError((cause) => new AgentRunBroke({ cause }))),
        ),
      ),
    );
    const output: AgentRunOutput = {
      text: settled.pipe(Effect.as('')),
      finishReason: settled.pipe(Effect.as('tool-calls' as const)),
      usage: settled.pipe(Effect.as(zeroUsage())),
      response: settled.pipe(Effect.as({ messages: step.response?.messages ?? [] })),
      steps: settled.pipe(Effect.as([step])),
    };
    return {
      instructions: '',
      output,
      events,
      catalog: threadUserQuestionTools,
      door: openToolDoor(input.run.id, unthreadedCaller, {}, new ToolJudge(builtinMode('trust'))),
      completedSteps: () => completed,
    };
  };
}

export function selectingCatalog(selector: {
  names: readonly string[];
  read: readonly string[];
  wording?: (() => Effect.Effect<void>) | null;
  running?: (() => Effect.Effect<void>) | null;
}): ToolCatalog {
  return {
    read_selection: Tool.make({
      display: () => ({ form: 'none' }),
      approval: ASKS_IN_REVIEW,
      description: 'Read what a selector names.',
      parameters: Schema.Struct({ of: Schema.String }),
      prepare: () =>
        Effect.succeed({
          subjects: selector.names.map((name) => ({ kind: 'read' as const, value: `thread://owner/${name}`, binding: name })),
          prepared: selector.names,
        }),
      execute: Effect.fnUntraced(function* (_input, options) {
        selector.read = options.prepared;
        if (selector.running) yield* selector.running();
        return { read: options.prepared };
      }),
      mutates: true,
      confirmation: {
        prompt: () => ({ summary: 'Read the lineage?' }),
        prepare: Effect.fnUntraced(function* () {
          if (selector.wording) yield* selector.wording();
          return { summary: 'Read the lineage?' };
        }),
        confirmLabel: 'Read',
      },
    }),
  };
}

export function confirmingTurn(catalog: ToolCatalog): ScriptedTurn {
  const call = { toolCallId: 'call-1', toolName: 'read_selection', input: { of: 'root-1' } };
  return (input) => {
    const door = openToolDoor(input.run.id, unthreadedCaller, {}, new ToolJudge(input.modeOf));
    const finished = Deferred.makeUnsafe<void>();
    const step = scriptedStep({
      text: '',
      messages: [Message.assistant([ToolCallPart.from({ id: call.toolCallId, name: call.toolName, input: call.input })])],
      toolCalls: [call],
    });
    const completed: AgentStep[] = [];
    const settled = Deferred.await(finished);
    const events = Stream.concat(
      Stream.fromIterable<AgentEvent>([
        { type: 'tool-input-start', id: call.toolCallId, name: call.toolName },
        { type: 'tool-call', id: call.toolCallId, name: call.toolName, input: call.input },
      ]),
      Stream.drain(
        Stream.fromEffect(
          Effect.gen(function* () {
            const tool = catalog[call.toolName];
            if (tool) yield* door.preflight({ name: call.toolName, tool, input: call.input, toolCallId: call.toolCallId });
            completed.push(step);
            yield* Deferred.succeed(finished, undefined);
            yield* Effect.yieldNow;
          }).pipe(Effect.mapError((cause) => new AgentRunBroke({ cause }))),
        ),
      ),
    );
    const output: AgentRunOutput = {
      text: settled.pipe(Effect.as('')),
      finishReason: settled.pipe(Effect.as('tool-calls' as const)),
      usage: settled.pipe(Effect.as(zeroUsage())),
      response: settled.pipe(Effect.as({ messages: step.response?.messages ?? [] })),
      steps: settled.pipe(Effect.as([step])),
    };
    return { instructions: '', output, events, catalog, door, completedSteps: () => completed };
  };
}

export function crossingTurn(turn: {
  world: ScriptedWorld;
  said: readonly [string, string];
  reached(): void;
  released: Effect.Effect<void>;
  onCrossed(crossing: ScriptedCrossing): void;
  opening?: { generation: number };
  between?: { generation: number } | null;
  refusal?: unknown;
  onDrained?: (texts: readonly string[]) => Effect.Effect<void, import('../../ThreadBorder').ThreadBorderFailed>;
  usage?: Usage;
  stays?: boolean;
}): ScriptedTurn {
  return (input) => {
    const halt = stopLatch();
    const completed: AgentStep[] = [];
    const finished = Deferred.makeUnsafe<readonly AgentStep[]>();
    const settled = Effect.raceFirst(
      Deferred.await(finished),
      Effect.flatMap(halt.said, (cause) => Effect.fail(new AgentRunBroke({ cause: cause ?? new Error('Thread run stopped.') }))),
    );
    const spoke = (text: string): AgentStep => scriptedStep({ text, messages: [Message.assistant(text)], usage: turn.usage });
    const events = Stream.unwrap(
      Effect.gen(function* () {
        const opensAt = input.stepsTaken ?? 0;
        if (turn.opening) turn.onCrossed(yield* turn.world.crossBoundary(input, { ...turn.opening, stepNumber: opensAt }));
        const first = spoke(turn.said[0]);
        const beginning = Stream.fromIterable<AgentEvent>([
          { type: 'text-start', id: 'g0' },
          { type: 'text-delta', id: 'g0', text: turn.said[0] },
          { type: 'text-end', id: 'g0' },
        ]);
        const firstStep = Stream.unwrap(
          Effect.sync(() => {
            completed.push(first);
            return Stream.fromIterable<AgentEvent>([{ type: 'step-finish', index: opensAt, reason: 'stop' }]);
          }),
        );
        const following = Stream.unwrap(
          Effect.gen(function* () {
            turn.reached();
            yield* turn.released;
            const between = turn.between === undefined ? { generation: 0 } : turn.between;
            if (between) turn.onCrossed(yield* turn.world.crossBoundary(input, { ...between, stepNumber: opensAt + 1 }, turn.refusal));
            if (turn.stays) {
              yield* halt.said;
              return Stream.empty;
            }
            if (turn.onDrained) yield* turn.onDrained((yield* input.signals.drain(opensAt + 1)).map((signal) => signal.text));
            const second = spoke(turn.said[1]);
            return Stream.concat(
              Stream.fromIterable<AgentEvent>([
                { type: 'text-start', id: 'g1' },
                { type: 'text-delta', id: 'g1', text: turn.said[1] },
              ]),
              Stream.unwrap(
                Effect.gen(function* () {
                  completed.push(second);
                  yield* Deferred.succeed(finished, [first, second]);
                  yield* Effect.yieldNow;
                  return Stream.fromIterable<AgentEvent>([{ type: 'text-end', id: 'g1' }]);
                }),
              ),
            );
          }),
        );
        return Stream.concat(Stream.concat(beginning, firstStep), following);
      }),
    ).pipe(Stream.mapError((cause) => new AgentRunBroke({ cause })));
    const output: AgentRunOutput = {
      text: settled.pipe(Effect.map((steps) => steps.map((step) => step.text).join('\n\n'))),
      finishReason: settled.pipe(Effect.as('stop' as const)),
      usage: settled.pipe(Effect.map(billed)),
      response: settled.pipe(Effect.map((steps) => ({ messages: steps.flatMap((step) => step.response?.messages ?? []) }))),
      steps: settled,
    };
    return {
      instructions: '',
      output,
      events,
      catalog: {},
      door: openToolDoor(input.run.id, unthreadedCaller, {}, new ToolJudge(input.modeOf)),
      completedSteps: () => completed,
      stop: halt.stop,
    };
  };
}

export function billed(steps: readonly AgentStep[]): Usage {
  return steps.reduce(
    (total, step) =>
      new Usage({
        inputTokens: (total.inputTokens ?? 0) + (step.usage?.inputTokens ?? 0),
        outputTokens: (total.outputTokens ?? 0) + (step.usage?.outputTokens ?? 0),
        totalTokens: (total.totalTokens ?? 0) + (step.usage?.totalTokens ?? 0),
      }),
    zeroUsage(),
  );
}
export function toolResultIds(messages: readonly Message[]): readonly string[] {
  return messages.flatMap((message) => message.content.flatMap((part) => (part.type === 'tool-result' ? [part.id] : [])));
}
export function reportTurn(): ScriptedTurn {
  return replyTurn({
    chunks: [
      { type: 'text-start', id: 'r1' },
      { type: 'text-delta', id: 'r1', text: 'Noted.' },
      { type: 'text-end', id: 'r1' },
    ],
    steps: [scriptedStep({ text: 'Noted.', messages: [Message.assistant('Noted.')] })],
  });
}
export class GatedTransitions<TTx, TWrite extends TTx = TTx> {
  private gate: ReturnType<typeof readGate> | null = null;
  readonly faces: ThreadTransitionStorage<TTx, TWrite>;
  constructor(transitions: ThreadTransitionStorage<TTx, TWrite>) {
    this.faces = {
      ...transitions,
      readAt: (threadId, work, tx) => {
        const answered = transitions.readAt(threadId, work, tx);
        const held = tx === undefined ? this.gate : null;
        if (held === null) return answered;
        this.gate = null;
        return Effect.tap(answered, () => Effect.andThen(Effect.sync(held.reach), held.released));
      },
    };
  }
  holdNextPrepare() {
    const held = readGate();
    this.gate = held;
    return { release: held.release, taken: held.reached };
  }
}
