import { Deferred, Effect, Stream } from 'effect';
import type { ModelRequestInput, ModelStreamInput } from '@runlith/agent/modelPort';
import { ModelID, ProviderID } from '@runlith/llm/schema/ids';
import { ModelIdentity } from '@runlith/llm/schema/options';
import { LLMResponse, Usage, type LLMEvent } from '@runlith/llm/schema/events';
import { Message } from '@runlith/llm/schema/messages';
import {
  HttpContext,
  HttpRequestDetails,
  HttpResponseDetails,
  LLMError,
  ProviderInternalReason,
  RateLimitReason,
} from '@runlith/llm/schema/errors';
import type { ModelAccess } from '../../../providers/contract/service/access.js';

export const ASK_CALL = 'ask-bash';

const SUMMARY = `## State\n${'The first turn asked for the push and the answer ran it, with every file it touches. '.repeat(6).trim()}`;

const usage = new Usage({
  inputTokens: 1,
  nonCachedInputTokens: 1,
  cacheReadInputTokens: 0,
  cacheWriteInputTokens: 0,
  outputTokens: 1,
  reasoningTokens: 0,
  totalTokens: 2,
});

const call: LLMEvent[] = [
  { type: 'step-start', index: 0 },
  { type: 'tool-input-start', id: ASK_CALL, name: 'bash' },
  { type: 'tool-call', id: ASK_CALL, name: 'bash', input: { command: 'git push origin main', description: 'Push the branch' } },
  { type: 'step-finish', index: 0, reason: 'tool-calls' },
  { type: 'finish', reason: 'tool-calls', usage },
];

const answer: LLMEvent[] = [
  { type: 'step-start', index: 0 },
  { type: 'text-start', id: 'done' },
  { type: 'text-delta', id: 'done', text: 'Done.' },
  { type: 'text-end', id: 'done' },
  { type: 'step-finish', index: 0, reason: 'stop' },
  { type: 'finish', reason: 'stop', usage },
];

const moving = (id: string, threadId: string, model: string): LLMEvent[] => [
  { type: 'step-start', index: 0 },
  { type: 'tool-input-start', id, name: 'set_agent_model' },
  { type: 'tool-call', id, name: 'set_agent_model', input: { threadId, model } },
  { type: 'step-finish', index: 0, reason: 'tool-calls' },
  { type: 'finish', reason: 'tool-calls', usage },
];

const recapped: LLMEvent[] = [
  { type: 'step-start', index: 0 },
  { type: 'text-start', id: 'recap' },
  { type: 'text-delta', id: 'recap', text: 'SUMMARY: The cache was warmed and the agent echoed.\nNEXT: none' },
  { type: 'text-end', id: 'recap' },
  { type: 'step-finish', index: 0, reason: 'stop' },
  { type: 'finish', reason: 'stop', usage },
];

const streaming: LLMEvent[] = [
  { type: 'step-start', index: 0 },
  { type: 'text-start', id: 'open' },
  { type: 'text-delta', id: 'open', text: 'Partial' },
];

const drifting: LLMEvent[] = [
  { type: 'text-end', id: 'open' },
  { type: 'tool-input-start', id: 'drift-read', name: 'read' },
  { type: 'tool-call', id: 'drift-read', name: 'read', input: { path: 'fixture.ts' } },
  { type: 'step-finish', index: 0, reason: 'tool-calls', usage },
  { type: 'finish', reason: 'tool-calls', usage },
];

const drifts: Deferred.Deferred<void>[] = [];

export const drifted = (): void => {
  for (const gate of drifts.splice(0)) Deferred.doneUnsafe(gate, Effect.void);
};

const lingers: Deferred.Deferred<void>[] = [];

export const lingered = (): void => {
  for (const gate of lingers.splice(0)) Deferred.doneUnsafe(gate, Effect.void);
};

const partial = (reason: 'length' | 'content-filter'): LLMEvent[] => [
  { type: 'step-start', index: 0 },
  { type: 'text-start', id: 'partial' },
  { type: 'text-delta', id: 'partial', text: 'Partial' },
  { type: 'text-end', id: 'partial' },
  { type: 'step-finish', index: 0, reason },
  { type: 'finish', reason, usage },
];

const RATE_LIMITED = new LLMError({
  module: 'RequestExecutor',
  method: 'execute',
  reason: new RateLimitReason({
    message: 'Rate limited',
    retryAfterMs: 720_000,
    rateLimit: { retryAfterMs: 720_000 },
    http: new HttpContext({
      request: new HttpRequestDetails({ method: 'POST', url: 'https://scripted.invalid/v1/messages', headers: {} }),
      response: new HttpResponseDetails({ status: 429, headers: {} }),
    }),
  }),
});

const reasoned: LLMEvent[] = [
  { type: 'step-start', index: 0 },
  { type: 'reasoning-start', id: 'thought' },
  { type: 'reasoning-delta', id: 'thought', text: 'Weighing it.' },
  { type: 'reasoning-end', id: 'thought' },
  { type: 'text-start', id: 'said' },
  { type: 'text-delta', id: 'said', text: 'Said.' },
  { type: 'text-end', id: 'said' },
  { type: 'step-finish', index: 0, reason: 'stop', usage },
  { type: 'finish', reason: 'stop', usage },
];

const reasoning: LLMEvent[] = [
  { type: 'step-start', index: 0 },
  { type: 'reasoning-start', id: 'thought' },
  { type: 'reasoning-delta', id: 'thought', text: 'Weighing it.' },
];

export const WRITTEN = ['{"path":"fix', 'ture.ts"', ',"offset":1}'] as const;

const writing: LLMEvent[] = [
  { type: 'step-start', index: 0 },
  { type: 'tool-input-start', id: 'written-call', name: 'read' },
  ...WRITTEN.map((text): LLMEvent => ({ type: 'tool-input-delta', id: 'written-call', name: 'read', text })),
];

export const MEASURED_USAGE = new Usage({
  inputTokens: 910,
  nonCachedInputTokens: 10,
  cacheReadInputTokens: 0,
  cacheWriteInputTokens: 900,
  outputTokens: 50,
  reasoningTokens: 20,
  totalTokens: 960,
});

const measured: LLMEvent[] = [
  { type: 'step-start', index: 0 },
  { type: 'text-start', id: 'said' },
  { type: 'text-delta', id: 'said', text: 'Measured.' },
  { type: 'text-end', id: 'said' },
  { type: 'step-finish', index: 0, reason: 'stop', usage: MEASURED_USAGE },
  { type: 'finish', reason: 'stop', usage: MEASURED_USAGE },
];

const stepped: LLMEvent[] = [
  { type: 'step-start', index: 0 },
  { type: 'tool-input-start', id: 'stepped-read', name: 'read' },
  { type: 'tool-call', id: 'stepped-read', name: 'read', input: { path: 'fixture.ts' } },
  { type: 'step-finish', index: 0, reason: 'tool-calls', usage: MEASURED_USAGE },
  { type: 'finish', reason: 'tool-calls', usage: MEASURED_USAGE },
];

export const NEXT_USAGE = new Usage({
  inputTokens: 1_000,
  nonCachedInputTokens: 100,
  cacheReadInputTokens: 900,
  cacheWriteInputTokens: 0,
  outputTokens: 30,
  reasoningTokens: 0,
  totalTokens: 1_030,
});

const stepEnded: LLMEvent[] = [
  { type: 'step-start', index: 0 },
  { type: 'text-start', id: 'said' },
  { type: 'text-delta', id: 'said', text: 'Stepped.' },
  { type: 'text-end', id: 'said' },
  { type: 'step-finish', index: 0, reason: 'stop', usage: NEXT_USAGE },
  { type: 'finish', reason: 'stop', usage: NEXT_USAGE },
];

const OVERLOADED = new LLMError({
  module: 'RequestExecutor',
  method: 'execute',
  reason: new ProviderInternalReason({
    message: 'Overloaded',
    http: new HttpContext({
      request: new HttpRequestDetails({ method: 'POST', url: 'https://scripted.invalid/v1/messages', headers: {} }),
      response: new HttpResponseDetails({ status: 529, headers: {} }),
    }),
  }),
});

const MOVE = /MOVE (\d+) ([\w.-]+) ([\w.-]+) ([\w.-]+)/g;

const crossed = new Set<string>();

export const heldOrAsking = (standing: ModelAccess['Service']): ModelAccess['Service'] => {
  const taken = new Set<string>();
  const paused = new Set<string>();
  return {
    ...standing,
    request: (selection: ModelRequestInput) => ({
      system: selection.instructions,
      origin: new ModelIdentity({
        provider: ProviderID.make(selection.provider ?? 'scripted'),
        model: ModelID.make(selection.model ?? 'scripted'),
      }),
      plannedOutputTokens: 8_000,
      text: () =>
        Effect.succeed(
          new LLMResponse({
            message: Message.assistant(SUMMARY),
            events: [{ type: 'text-delta', id: 'summary', text: SUMMARY }],
            usage: new Usage({ inputTokens: 900, outputTokens: 60, totalTokens: 960 }),
            finishReason: 'stop',
          }),
        ),
      object: () => Effect.die(new Error('the scripted model answers streamed requests only')),
      stream: (input: ModelStreamInput) =>
        Stream.suspend(() => {
          const said = JSON.stringify(input.messages);
          const commands = [...said.matchAll(MOVE)];
          const last = commands.at(-1);
          if (last !== undefined) {
            if (taken.has(last[1]!)) return Stream.fromIterable(answer);
            taken.add(last[1]!);
            return Stream.fromIterable(moving(last[4]!, last[2]!, last[3]!));
          }
          if (said.includes('write a recap of where this thread stands')) return Stream.fromIterable(recapped);
          if (said.includes('DRIFT')) {
            if (said.includes('drift-read')) return Stream.never;
            const gate = Deferred.makeUnsafe<void>();
            drifts.push(gate);
            return Stream.concat(
              Stream.fromIterable(streaming),
              Stream.unwrap(Effect.as(Deferred.await(gate), Stream.fromIterable(drifting))),
            );
          }
          if (JSON.stringify(input.messages.at(-1)).includes('LINGER')) {
            const gate = Deferred.makeUnsafe<void>();
            lingers.push(gate);
            return Stream.concat(Stream.fromIterable(streaming), Stream.never).pipe(Stream.ensuring(Deferred.await(gate)));
          }
          if (said.includes('STREAM')) return Stream.concat(Stream.fromIterable(streaming), Stream.never);
          if (said.includes('TRUNCATE')) return Stream.fromIterable(partial('length'));
          if (said.includes('REFUSE')) return Stream.fromIterable(partial('content-filter'));
          if (said.includes('RATELIMIT')) return Stream.fail(RATE_LIMITED);
          if (said.includes('PHASES')) return Stream.fromIterable(reasoned);
          if (said.includes('PONDER')) return Stream.concat(Stream.fromIterable(reasoning), Stream.never);
          if (said.includes('SCRIBBLE')) return Stream.concat(Stream.fromIterable(writing), Stream.never);
          if (said.includes('GAUGE')) return Stream.fromIterable(measured);
          if (said.includes('STEPPED')) {
            if (!said.includes('stepped-read')) return Stream.fromIterable(stepped);
            if (crossed.has(said)) return Stream.fromIterable(stepEnded);
            crossed.add(said);
            return Stream.never;
          }
          if (said.includes('PAUSE')) {
            if (paused.has(said)) return Stream.never;
            paused.add(said);
            return Stream.fail(OVERLOADED);
          }
          if (!said.includes('ASK')) return Stream.never;
          return Stream.fromIterable(said.includes(ASK_CALL) ? answer : call);
        }),
    }),
  };
};
