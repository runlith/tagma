import type { Effect } from 'effect';
import * as live from '../../cli/live.js';
import type { ThreadLive } from '../../threads/cli/turnVerbs.js';
import { TAGMA_SOCKET_PATH } from '../../socket/rpc.js';
import { LiveRpc } from '../rpc.js';
import { door } from './door.js';

const wire = { group: LiveRpc, path: TAGMA_SOCKET_PATH, baseUrl: door.baseUrl, headers: door.sessionHeader };

export const askLive = <A, R>(work: (client: ThreadLive) => Effect.Effect<A, unknown, R>): Effect.Effect<A, never, R> =>
  live.askLive(wire, work);
