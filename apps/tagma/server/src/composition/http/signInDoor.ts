import { Effect } from 'effect';
import { McpSignInDoor } from '../../mcp/contract/service/door.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { Access } from '../../remote/contract/service/access.js';

const unserved = (reason: string, unblock: string) => new GateRefusal('mcp-sign-in-unserved', reason, [unblock]);

export const localSignInDoor = (origin: string | undefined) =>
  McpSignInDoor.of({
    origin:
      origin === undefined
        ? Effect.fail(
            unserved('This server was started without a loopback address its sign-ins can return to.', 'sign in from a paired device'),
          )
        : Effect.succeed(origin),
  });

export const remoteSignInDoor = (access: Access['Service']) =>
  McpSignInDoor.of({
    origin: Effect.suspend(() => {
      const origin = access.parentOrigin;
      return origin === null
        ? Effect.fail(unserved('The door for paired devices has no address yet.', 'sign in once read_remote_access reports the door ready'))
        : Effect.succeed(origin);
    }),
  });
