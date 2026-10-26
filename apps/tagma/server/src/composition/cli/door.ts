import { Effect, Schema } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { HttpApiClient } from 'effect/http-api';
import { Api } from '../../http/contract/wire/Api.js';
import { healthSchema } from '../../http/contract/wire/health.js';
import { serverDoor } from '../../cli/door.js';
import { SESSION_SIGNERS } from '../../external-harnesses/contract/wire/sessionVariables.js';
import { CHANNEL } from '@tagma/server/composition/channel';
import { activeElsewhere } from '../../installation/setup/active.js';
import { channelActive } from '../../installation/contract/wire/junction.js';

const readWhole = Schema.decodeUnknownSync(healthSchema);

const readHealth = (body: unknown) => ({ _tag: 'Health' as const, health: readWhole(body) });

export const door = serverDoor({
  connect: (baseUrl, transformClient) => Effect.provide(HttpApiClient.make(Api, { baseUrl, transformClient }), FetchHttpClient.layer),
  readHealth,
  defaultPort: CHANNEL.port,
  command: CHANNEL.command,
  signers: SESSION_SIGNERS,
  elsewhere: (env) => {
    const holder = activeElsewhere(CHANNEL, env);
    return holder === null ? null : channelActive(holder, CHANNEL);
  },
});
