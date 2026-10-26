import { unthreadedCaller } from '../../../agent/testing/caller';
import { builtinMode } from '../../../agent/testing/modes';
import { Deferred, Effect, Stream } from 'effect';
import type { AgentEvent } from '../../../agent/AgentEvent';
import { openToolDoor } from '../../../agent/door/openToolDoor';
import { ToolJudge } from '../../../agent/door/openToolDoor';
import { Message } from '@runlith/llm/schema/messages';
import { Usage } from '@runlith/llm/schema/events';
import type { AgentStep } from '../../../agent/AgentStep';
import type { AgentRunOutput } from '../../../agent/AgentRunner';
import { AgentRunBroke } from '../../../agent/AgentFailure';
import { type ScriptedTurn } from './world';

export function stopLatch() {
  const said = Deferred.makeUnsafe<unknown>();
  return { said: Deferred.await(said), stop: (reason: unknown) => Effect.asVoid(Deferred.succeed(said, reason)) };
}

export function heldTurn(release: Effect.Effect<void>): ScriptedTurn {
  return (input) => {
    const halt = stopLatch();
    const settled = Effect.raceFirst(
      release,
      Effect.flatMap(halt.said, (cause) => Effect.fail(new AgentRunBroke({ cause }))),
    );
    const step = scriptedStep({ text: 'Held.', messages: [Message.assistant('Held.')] });
    const completed: AgentStep[] = [];
    const events = Stream.concat(
      Stream.fromIterable<AgentEvent>([
        { type: 'text-start', id: 'held-1' },
        { type: 'text-delta', id: 'held-1', text: 'Held.' },
        { type: 'text-end', id: 'held-1' },
      ]),
      Stream.concat(
        Stream.fromEffect(
          Effect.sync(() => {
            completed.push(step);
            return { type: 'step-finish', index: input.stepsTaken ?? 0, reason: 'stop' } as AgentEvent;
          }),
        ),
        Stream.drain(Stream.fromEffect(settled)),
      ),
    );
    const output: AgentRunOutput = {
      text: settled.pipe(Effect.as('Held.')),
      finishReason: settled.pipe(Effect.as('stop' as const)),
      usage: settled.pipe(Effect.as(zeroUsage())),
      response: settled.pipe(Effect.as({ messages: step.response?.messages ?? [] })),
      steps: settled.pipe(Effect.as([step])),
    };
    return {
      instructions: 'Scripted prompt v1',
      output,
      events,
      catalog: {},
      door: openToolDoor(input.run.id, unthreadedCaller, {}, new ToolJudge(builtinMode('trust'))),
      completedSteps: () => completed,
      stop: halt.stop,
    };
  };
}

export function processTurn(exit: Effect.Effect<void>): ScriptedTurn {
  return (input) => {
    const halt = stopLatch();
    const settled = Effect.raceFirst(
      exit,
      Effect.flatMap(halt.said, (cause) => Effect.fail(new AgentRunBroke({ cause }))),
    );
    const step = scriptedStep({ text: 'Exited 0.', messages: [] });
    const output: AgentRunOutput = {
      text: settled.pipe(Effect.as(step.text)),
      finishReason: settled.pipe(Effect.as('stop' as const)),
      usage: settled.pipe(Effect.as(zeroUsage())),
      response: settled.pipe(Effect.as({ messages: [] as readonly Message[] })),
      steps: settled.pipe(Effect.as([step])),
    };
    return {
      instructions: 'Scripted prompt v1',
      output,
      events: Stream.empty,
      catalog: {},
      door: openToolDoor(input.run.id, unthreadedCaller, {}, new ToolJudge(builtinMode('trust'))),
      completedSteps: () => [],
      stop: halt.stop,
    };
  };
}

export function replyTurn(turn: { chunks: readonly AgentEvent[]; steps: readonly AgentStep[] }): ScriptedTurn {
  return (input) => {
    const finished = Deferred.makeUnsafe<void>();
    const completed: AgentStep[] = [];
    const settled = Deferred.await(finished);
    const events = Stream.concat(
      Stream.fromIterable(turn.chunks.slice(0, -1)),
      Stream.unwrap(
        Effect.gen(function* () {
          completed.push(...turn.steps);
          yield* Deferred.succeed(finished, undefined);
          yield* Effect.yieldNow;
          const last = turn.chunks.at(-1);
          return last === undefined ? Stream.empty : Stream.make(last);
        }),
      ),
    );
    const output: AgentRunOutput = {
      text: settled.pipe(Effect.as(turn.steps.map((step) => step.text).join('\n\n'))),
      finishReason: settled.pipe(Effect.as('stop' as const)),
      usage: settled.pipe(Effect.as(zeroUsage())),
      response: settled.pipe(Effect.as({ messages: turn.steps.flatMap((step) => step.response?.messages ?? []) })),
      steps: settled.pipe(Effect.as(turn.steps)),
    };
    return {
      instructions: '',
      output,
      events,
      catalog: {},
      door: openToolDoor(input.run.id, unthreadedCaller, {}, new ToolJudge(builtinMode('trust'))),
      completedSteps: () => completed,
    };
  };
}

export function brokenTurn(reason: string): ScriptedTurn {
  return (input) => {
    const broke = Effect.fail(new AgentRunBroke({ cause: new Error(reason) }));
    const output: AgentRunOutput = { text: broke, finishReason: broke, usage: broke, response: broke, steps: broke };
    return {
      instructions: '',
      output,
      events: Stream.fromEffect(broke),
      catalog: {},
      door: openToolDoor(input.run.id, unthreadedCaller, {}, new ToolJudge(builtinMode('trust'))),
      completedSteps: () => [],
    };
  };
}

export function steeredTurn(turn: {
  reached(): void;
  released: Effect.Effect<void>;
  onDrained(texts: readonly string[]): void;
  drainSeen?: { reached(): void; released: Effect.Effect<void> };
}): ScriptedTurn {
  return (input) => {
    const finished = Deferred.makeUnsafe<readonly AgentStep[]>();
    const completed: AgentStep[] = [];
    const settled = Deferred.await(finished);
    const events = Stream.concat(
      Stream.fromIterable<AgentEvent>([{ type: 'text-start', id: 's1' }]),
      Stream.unwrap(
        Effect.gen(function* () {
          turn.reached();
          yield* turn.released;
          const drained = (yield* input.signals.drain(1)).map((signal) => signal.text);
          turn.onDrained(drained);
          if (turn.drainSeen) {
            turn.drainSeen.reached();
            yield* turn.drainSeen.released;
          }
          const reply = `Read: ${drained.join(' | ')}`;
          const steps = [scriptedStep({ text: reply, messages: [Message.assistant(reply)] })];
          completed.push(...steps);
          yield* Deferred.succeed(finished, steps);
          yield* Effect.yieldNow;
          return Stream.fromIterable<AgentEvent>([
            { type: 'text-delta', id: 's1', text: reply },
            { type: 'text-end', id: 's1' },
          ]);
        }).pipe(Effect.mapError((cause) => new AgentRunBroke({ cause }))),
      ),
    );
    const output: AgentRunOutput = {
      text: settled.pipe(Effect.map((steps) => steps.map((step) => step.text).join('\n\n'))),
      finishReason: settled.pipe(Effect.as('stop' as const)),
      usage: settled.pipe(Effect.as(zeroUsage())),
      response: settled.pipe(Effect.map((steps) => ({ messages: steps.flatMap((step) => step.response?.messages ?? []) }))),
      steps: settled,
    };
    return {
      instructions: '',
      output,
      events,
      catalog: {},
      door: openToolDoor(input.run.id, unthreadedCaller, {}, new ToolJudge(builtinMode('trust'))),
      completedSteps: () => completed,
    };
  };
}

export function hangingTurn(turn: {
  chunks: readonly AgentEvent[];
  reached(): void;
  onAbort?: () => Effect.Effect<void, import('../../ThreadBorder').ThreadBorderFailed>;
}): ScriptedTurn {
  return (input) => {
    const halt = stopLatch();
    const ended = Deferred.makeUnsafe<never, AgentRunBroke>();
    const torn = Deferred.await(ended);
    const cancelled = Effect.flatMap(halt.said, (reason) =>
      Effect.andThen(
        turn.onAbort?.() ?? Effect.void,
        Effect.fail(new AgentRunBroke({ cause: reason ?? new Error('Thread run stopped.') })),
      ),
    ).pipe(
      Effect.mapError((cause) => (cause instanceof AgentRunBroke ? cause : new AgentRunBroke({ cause }))),
      Effect.onExit((exit) => Deferred.done(ended, exit)),
    );
    const stop = halt.stop;
    const events = Stream.concat(
      Stream.fromIterable(turn.chunks),
      Stream.drain(Stream.fromEffect(Effect.andThen(Effect.sync(turn.reached), cancelled))),
    );
    const output: AgentRunOutput = { text: torn, finishReason: torn, usage: torn, response: torn, steps: torn };
    return {
      instructions: '',
      output,
      events,
      catalog: {},
      door: openToolDoor(input.run.id, unthreadedCaller, {}, new ToolJudge(builtinMode('trust'))),
      completedSteps: () => [],
      stop,
    };
  };
}

export function streamOf(events: AsyncIterable<AgentEvent>): Stream.Stream<AgentEvent, AgentRunBroke> {
  return Stream.fromAsyncIterable(events, (cause) => new AgentRunBroke({ cause }));
}

export function scriptedStep(input: {
  text: string;
  messages: readonly Message[];
  toolCalls?: AgentStep['toolCalls'];
  toolResults?: AgentStep['toolResults'];
  usage?: Usage;
}): AgentStep {
  return {
    content: [],
    text: input.text,
    reasoningText: undefined,
    toolCalls: input.toolCalls ?? [],
    toolResults: input.toolResults ?? [],
    usage: input.usage ?? zeroUsage(),
    response: { messages: input.messages },
  };
}

export function zeroUsage(): Usage {
  return new Usage({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
}
