import { Effect } from 'effect';
import { bordered } from '@runlith/agent/thread/ThreadBorder';
import { body, pair } from '../platform/contract/service/body.js';
import type { WriteUnit } from '../platform/contract/service/units.js';
import { nativeThreadIdOf } from '../platform/contract/wire/actor.js';
import type { Caller } from '../platform/contract/wire/caller.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { OPERATOR_PRINCIPAL } from '../platform/contract/wire/actor.js';
import { ThreadHarness } from '../threads/contract/service/engine.js';
import { ThreadLookup } from '../threads/contract/service/reads.js';
import { declaredRefusals } from '../threads/refusalAnswers.js';
import { HOSTED_OPERATIONS } from './contract/wire/hosted.js';
import { HostedOpenings } from './contract/service/protocol.js';
import { hostedContent, hostedHistory } from './hostedHistory.js';

const provenThread = (caller: Caller) => {
  const thread = nativeThreadIdOf(caller.actor);
  return thread !== null
    ? Effect.succeed(thread)
    : Effect.fail(
        new GateRefusal('session-unproven', 'a hosted agent serves the thread this call proves it is, and this call proves none', [
          "run it from that thread's own process, which carries the grant this door proves",
        ]),
      );
};

const hostOf = Effect.fn('hostOf')(function* (threadId: string) {
  const row = yield* (yield* ThreadLookup).find(threadId, OPERATOR_PRINCIPAL);
  const hosts = row?.transport.agent ?? null;
  if (hosts === null) {
    return yield* new GateRefusal('not-hosted', `thread ${threadId} runs no agent loop Tagma hosts`, [
      'open the thread as a harness whose profile hosts a native agent',
    ]);
  }
  return hosts;
});

export const hostedPrompt = pair(
  HOSTED_OPERATIONS.read_hosted_agent,
  body(HOSTED_OPERATIONS.read_hosted_agent, {
    execute: Effect.fnUntraced(function* (_input, _prepared, caller) {
      const threadId = yield* provenThread(caller);
      const agentId = yield* declaredRefusals(HOSTED_OPERATIONS.read_hosted_agent)(hostOf(threadId));
      const agent = yield* declaredRefusals(HOSTED_OPERATIONS.read_hosted_agent)(
        (yield* ThreadHarness).runs.hosting().agent(threadId, agentId),
      );
      return { status: 'ok' as const, prompt: agent.prompt, web: agent.web };
    }),
  }),
);

export const hostedTools = pair(
  HOSTED_OPERATIONS.read_hosted_tools,
  body(HOSTED_OPERATIONS.read_hosted_tools, {
    execute: Effect.fnUntraced(function* (_input, _prepared, caller) {
      const threadId = yield* provenThread(caller);
      const agentId = yield* declaredRefusals(HOSTED_OPERATIONS.read_hosted_tools)(hostOf(threadId));
      const offered = yield* declaredRefusals(HOSTED_OPERATIONS.read_hosted_tools)(
        (yield* ThreadHarness).runs.hosting().tools(threadId, agentId),
      );
      return {
        status: 'ok' as const,
        tools: offered.tools.map((tool) => ({ ...tool, inputSchema: { ...tool.inputSchema } })),
        names: offered.names,
        dispatch: offered.dispatch,
      };
    }),
  }),
);

export const hostedHistoryRead = pair(
  HOSTED_OPERATIONS.read_hosted_history,
  body(HOSTED_OPERATIONS.read_hosted_history, {
    execute: Effect.fnUntraced(function* (_input, _prepared, caller) {
      const threadId = yield* provenThread(caller);
      yield* declaredRefusals(HOSTED_OPERATIONS.read_hosted_history)(hostOf(threadId));
      const messages = yield* declaredRefusals(HOSTED_OPERATIONS.read_hosted_history)(
        (yield* ThreadHarness).runs.hosting().history(threadId),
      );
      return { status: 'ok' as const, messages: hostedHistory(messages) };
    }),
  }),
);

export const hostedTurn = pair(
  HOSTED_OPERATIONS.open_hosted_turn,
  body(HOSTED_OPERATIONS.open_hosted_turn, {
    execute: Effect.fnUntraced(function* (_input, _prepared, caller) {
      const threadId = yield* provenThread(caller);
      const agentId = yield* declaredRefusals(HOSTED_OPERATIONS.open_hosted_turn)(hostOf(threadId));
      const openings = yield* HostedOpenings;
      const turn = yield* declaredRefusals(HOSTED_OPERATIONS.open_hosted_turn)(
        (yield* ThreadHarness).runs
          .hosting()
          .open(threadId, agentId, (told, tx) => bordered(openings.owe(threadId, told, tx as unknown as WriteUnit<'machine'>))),
      );
      return { status: 'opened' as const, context: yield* openings.owed(threadId), prompt: turn.prompt, web: turn.web };
    }),
  }),
);

export const hostedCall = pair(
  HOSTED_OPERATIONS.call_hosted_tool,
  body(HOSTED_OPERATIONS.call_hosted_tool, {
    execute: Effect.fnUntraced(function* (input, _prepared, caller) {
      const threadId = yield* provenThread(caller);
      const agentId = yield* declaredRefusals(HOSTED_OPERATIONS.call_hosted_tool)(hostOf(threadId));
      const answer = yield* declaredRefusals(HOSTED_OPERATIONS.call_hosted_tool)(
        (yield* ThreadHarness).runs.hosting().call({
          threadId,
          agentId,
          toolCallId: input.toolCallId,
          name: input.name,
          input: input.input,
          arguments: JSON.stringify(input.input ?? {}),
        }),
      );
      return {
        status: 'called' as const,
        content: hostedContent(answer.output, answer.guides),
        failed: answer.failed,
        offered: answer.offered,
        words: answer.words,
      };
    }),
  }),
);

export const HOSTED_PAIRS = [hostedPrompt, hostedTools, hostedHistoryRead, hostedTurn, hostedCall] as const;
