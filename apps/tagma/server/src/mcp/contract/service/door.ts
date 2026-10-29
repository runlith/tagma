import { Context, Effect } from 'effect';
import { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import { MCP_CALLBACK_PATH } from '../wire/callback.js';

export class McpSignInDoor extends Context.Service<McpSignInDoor, { readonly origin: () => string | null }>()('tagma/mcp/McpSignInDoor') {}

export const callbackOf = (door: McpSignInDoor['Service']): string | null => {
  const origin = door.origin();
  return origin === null ? null : `${origin}${MCP_CALLBACK_PATH}`;
};

export const servedCallback = Effect.flatMap(McpSignInDoor, (door) => {
  const callback = callbackOf(door);
  return callback === null
    ? Effect.fail(
        new GateRefusal('mcp-sign-in-unserved', 'This door has no address yet that a sign-in could return to.', [
          'sign in once read_remote_access reports the door ready',
          'or sign in from the machine Tagma runs on',
        ]),
      )
    : Effect.succeed(callback);
});
