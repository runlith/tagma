import { Effect, Result, Schema } from 'effect';
import type { HookCallbackMatcher, HookInput, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk';
import type { Outlet } from '@runlith/acp/agent';
import { RequestPermissionResult, type RequestPermissionParams } from '@runlith/acp/methods';
import type { Feed } from './feed.js';
import { WEB_FETCH } from './vendor.js';

const ALLOW = 'allow';
const REJECT = 'reject';

const ANSWER_WAIT_S = 24 * 60 * 60;

const decodeAnswer = Schema.decodeUnknownResult(RequestPermissionResult);

const decided = (permissionDecision: 'allow' | 'deny', reason: string | null): HookJSONOutput => ({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision,
    permissionDecisionReason: reason ?? undefined,
  },
});

const refused = (reason: string): HookJSONOutput => decided('deny', reason);

const refusalOf = (answer: unknown): string | null => {
  const read = decodeAnswer(answer);
  if (Result.isFailure(read)) return 'The client answered the question about this fetch in a shape Tagma cannot read.';
  const { outcome } = read.success;
  if (outcome.outcome === 'cancelled') return 'The question about this fetch was cancelled before it was allowed.';
  return outcome.optionId === ALLOW ? null : 'Tagma declined this fetch.';
};

export class Fetching {
  constructor(
    private readonly id: string,
    private readonly outlet: Outlet,
    private readonly feed: Feed,
  ) {}

  hook(): HookCallbackMatcher {
    return {
      matcher: WEB_FETCH.wire,
      timeout: ANSWER_WAIT_S,
      hooks: [(input, _id, { signal }) => Effect.runPromise(this.ask(input), { signal })],
    };
  }

  private ask(input: HookInput): Effect.Effect<HookJSONOutput> {
    if (input.hook_event_name !== 'PreToolUse')
      return Effect.succeed(refused(`${WEB_FETCH.wire} was asked about by a ${input.hook_event_name} hook.`));
    const params: RequestPermissionParams = {
      sessionId: this.id,
      toolCall: { toolCallId: input.tool_use_id, title: WEB_FETCH.tagma, name: WEB_FETCH.tagma, kind: 'fetch', rawInput: input.tool_input },
      options: [
        { optionId: ALLOW, name: 'Allow', kind: 'allow_once' },
        { optionId: REJECT, name: 'Reject', kind: 'reject_once' },
      ],
    };
    return this.outlet.request('session/request_permission', params).pipe(
      Effect.map(refusalOf),
      Effect.catchTag('AgentFault', (fault) => Effect.succeed(`Tagma could not ask whether this fetch may go ahead: ${fault.message}`)),
      Effect.flatMap((refusal) =>
        refusal !== null ? Effect.succeed(refused(refusal)) : Effect.as(this.feed.started(input.tool_use_id), decided('allow', null)),
      ),
    );
  }
}
