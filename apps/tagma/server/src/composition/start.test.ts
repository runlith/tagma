import { it } from '@runlith/effect-test';
import { expect } from 'bun:test';
import { Effect, Schema } from 'effect';
import { settingKey } from '../platform/contract/wire/setting.js';
import { testGrantSigner } from '../platform/testing/grants.js';
import { testSessionIdentity } from '../platform/testing/identity.js';
import { start } from './start.js';
import { storeSnapshots } from '../platform/store/snapshot.js';

const servers = settingKey({
  id: 'mcp.servers',
  order: 10,
  title: 'MCP servers',
  description: 'The servers a session reaches.',
  schema: Schema.Array(Schema.String),
  control: { kind: 'managed', by: 'add_mcp_server' },
  fallback: [],
  scopes: ['user', 'project'],
  merge: 'replace',
});

const started = (operations: readonly string[]) =>
  start('drizzle', 'seeds', testSessionIdentity, testGrantSigner, [servers], operations, storeSnapshots({}));

it.effect('start refuses a managed setting whose operation is not registered', () =>
  Effect.gen(function* () {
    const refused = yield* Effect.flip(started(['remove_mcp_server']));
    expect(refused._tag).toBe('AssemblyInvalid');
    expect(refused.unregistered).toEqual([{ key: 'mcp.servers', by: 'add_mcp_server' }]);
  }),
);
