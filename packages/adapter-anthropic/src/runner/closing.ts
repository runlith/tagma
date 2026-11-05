import { Effect } from 'effect';
import type { HookCallbackMatcher, HookInput, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk';
import type { HostedDoor } from '@runlith/hosted-runner/door';

const CLOSE_WAIT_S = 24 * 60 * 60;

const asked = (door: HostedDoor, stderr: (text: string) => void, input: HookInput): Effect.Effect<HookJSONOutput> =>
  input.hook_event_name !== 'Stop'
    ? Effect.succeed({})
    : door.close(crypto.randomUUID(), input.last_assistant_message ?? null).pipe(
        Effect.map((guide): HookJSONOutput => (guide === null ? {} : { decision: 'block', reason: guide })),
        Effect.catch((fault) =>
          Effect.sync((): HookJSONOutput => {
            stderr(`the turn ended without its closing rules: ${fault.message}\n`);
            return {};
          }),
        ),
      );

export const closingHook = (door: HostedDoor, stderr: (text: string) => void): HookCallbackMatcher => ({
  timeout: CLOSE_WAIT_S,
  hooks: [(input, _id, { signal }) => Effect.runPromise(asked(door, stderr, input), { signal })],
});
