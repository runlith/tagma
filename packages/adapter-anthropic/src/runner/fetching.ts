import { Effect } from 'effect';
import type { HookCallbackMatcher, HookInput, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk';
import type { Outlet } from '@runlith/acp/agent';
import { permitted } from '@runlith/hosted-runner/question';
import type { Feed } from './feed.js';
import { WEB_FETCH } from './vendor.js';

const ANSWER_WAIT_S = 24 * 60 * 60;

const decided = (permissionDecision: 'allow' | 'deny', reason: string | null): HookJSONOutput => ({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision,
    permissionDecisionReason: reason ?? undefined,
  },
});

const refused = (reason: string): HookJSONOutput => decided('deny', reason);

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
    const toolCallId = input.tool_use_id;
    return permitted(this.outlet, this.id, {
      toolCallId,
      title: WEB_FETCH.tagma,
      name: WEB_FETCH.tagma,
      kind: 'fetch',
      rawInput: input.tool_input,
    }).pipe(
      Effect.flatMap((refusal) =>
        refusal !== null ? Effect.succeed(refused(refusal)) : Effect.as(this.feed.started(toolCallId), decided('allow', null)),
      ),
    );
  }
}
