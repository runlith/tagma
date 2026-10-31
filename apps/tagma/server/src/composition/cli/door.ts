import { Effect, Schema } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { HttpApiClient } from 'effect/http-api';
import { Api } from '../../http/contract/wire/Api.js';
import { healthSchema } from '../../http/contract/wire/health.js';
import { serverDoor } from '../../cli/door.js';
import { SIGNERS } from './signers.js';
import type { Channel } from '../../installation/contract/wire/channel.js';
import { activeElsewhere } from '../../installation/setup/active.js';
import { channelActive } from '../../installation/contract/wire/junction.js';

const readWhole = Schema.decodeUnknownSync(healthSchema);

const readHealth = (body: unknown) => ({ _tag: 'Health' as const, health: readWhole(body) });

export const doorOf = (channel: Channel) =>
  serverDoor({
    connect: (baseUrl, transformClient) => Effect.provide(HttpApiClient.make(Api, { baseUrl, transformClient }), FetchHttpClient.layer),
    readHealth,
    defaultPort: channel.port,
    command: channel.command,
    signers: SIGNERS,
    elsewhere: (env) => {
      const holder = activeElsewhere(channel, env);
      return holder === null ? null : channelActive(holder, channel);
    },
  });

export type ChannelDoor = ReturnType<typeof doorOf>;
