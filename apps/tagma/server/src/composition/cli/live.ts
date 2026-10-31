import type { Effect } from 'effect';
import * as live from '../../cli/live.js';
import type { ThreadLive } from '../../threads/cli/turnVerbs.js';
import { TAGMA_SOCKET_PATH } from '../../socket/rpc.js';
import type { LiveGroup } from '../rpc.js';
import type { ChannelDoor } from './door.js';

export const liveAsking =
  (door: ChannelDoor, group: LiveGroup) =>
  <A, R>(work: (client: ThreadLive) => Effect.Effect<A, unknown, R>): Effect.Effect<A, never, R> =>
    live.askLive({ group, path: TAGMA_SOCKET_PATH, baseUrl: door.baseUrl, headers: door.sessionHeader }, work);
