import { Effect } from 'effect';
import { DoorAddress } from '../../../platform/contract/service/door.js';
import { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import { MCP_CALLBACK_PATH } from '../wire/callback.js';

export const callbackOf = (door: DoorAddress['Service']): string | null => {
  const origin = door.origin();
  return origin === null ? null : `${origin}${MCP_CALLBACK_PATH}`;
};

export const servedCallback = Effect.flatMap(DoorAddress, (door) => {
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
