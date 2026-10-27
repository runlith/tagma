import { Effect } from 'effect';
import { LANE_PATH } from '@runlith/executions/protocol/lane';
import { LaneEndpoint } from '../../executions/contract/service/views.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { TerminalSite } from '../../remote/contract/service/sites.js';

export const localEndpoint = LaneEndpoint.of({ address: (port) => Effect.succeed(`ws://127.0.0.1:${port}${LANE_PATH}`) });

export const remoteEndpoint = (site: TerminalSite['Service']) =>
  LaneEndpoint.of({
    address: (port) =>
      site.origin(port).pipe(
        Effect.map((origin) => `${origin.replace(/^https:/u, 'wss:')}${LANE_PATH}`),
        Effect.mapError(
          (blocked) =>
            new GateRefusal(
              'terminal-endpoint-unserved',
              `the terminal endpoint has no address on Tailscale Serve yet: ${blocked.detail}`,
              ['open the terminal again once read_remote_access reports the door ready', 'type into it from the machine itself'],
            ),
        ),
      ),
  });
