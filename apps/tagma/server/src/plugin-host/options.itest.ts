import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Effect } from 'effect';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { hostWorld } from './testing/world.js';

const FIXTURE = resolve(import.meta.dir, 'testing/keyed.ts');
const TOKEN = 'tok-5678-abcdef';
const OTHER = 'tok-9012-ghijklmnop';
const manifest = {
  process: { command: process.execPath, args: [FIXTURE] },
  options: [{ key: 'API_TOKEN', title: 'API token', description: 'The token of the service the plugin bridges.', sensitive: true }],
};
const target = { owner: 'plugins', id: 'fixture', name: 'API_TOKEN' } as const;

const refusal = Effect.fnUntraced(function* <E>(attempt: Effect.Effect<unknown, E>) {
  const failure = yield* Effect.flip(attempt);
  return failure instanceof GateRefusal ? failure.code : String(failure);
});

it.live('a secret option reaches the process in its variable, masked, and each change restarts it once until removing drops it', () =>
  Effect.gen(function* () {
    const world = yield* hostWorld({ prefix: 'options-' });
    const { host, secrets, projectId, said, until } = world;
    const starts = () =>
      Effect.promise(
        async () =>
          (await readFile(join(world.data('fixture'), 'journal'), 'utf8')).split('\n').filter((line) => line.startsWith('start ')).length,
      );
    const kept = () => Effect.promise(async () => JSON.parse(await readFile(join(world.home, 'secrets.json'), 'utf8')) as unknown);
    yield* world.install(yield* world.place('fixture', manifest));
    yield* until(() => host.reading('fixture')?.state === 'running');
    expect(yield* said('length')).toBe('absent');
    expect(yield* secrets.read(projectId, 'plugins', undefined)).toEqual([
      {
        owner: 'plugins',
        id: 'fixture',
        title: 'Fixture',
        secrets: [{ name: 'API_TOKEN', description: 'API token: The token of the service the plugin bridges.', set: false }],
        missing: 1,
      },
    ]);
    expect(yield* refusal(secrets.set(projectId, { ...target, name: 'OTHER' }, TOKEN))).toBe('secret-unknown');
    yield* secrets.set(projectId, target, TOKEN);
    yield* until(() => host.reading('fixture')?.state === 'running');
    yield* Effect.repeat(said('length'), { until: (length) => length === String(TOKEN.length) });
    expect(yield* said('reveal')).toBe('token=[redacted]');
    expect(JSON.stringify(yield* host.call('fixture', 'keyed', {}, {}))).not.toContain(TOKEN);
    expect(yield* starts()).toBe(2);
    yield* secrets.set(projectId, target, OTHER);
    yield* Effect.repeat(said('length'), { until: (length) => length === String(OTHER.length) });
    expect(yield* starts()).toBe(3);
    yield* world.plugins.uninstall({ projectId, id: 'fixture' });
    yield* until(() => host.reading('fixture') === undefined);
    expect(yield* kept()).toEqual({ owners: {} });
    expect(yield* refusal(secrets.set(projectId, target, TOKEN))).toBe('secret-owner-unknown');
  }),
);

it.live('a plugin whose secret store cannot be read is refused before its process starts, and the refusal does not quote the store', () =>
  Effect.gen(function* () {
    const world = yield* hostWorld({
      prefix: 'options-unread-',
      seed: (home) =>
        writeFile(join(home, 'secrets.json'), '{"owners": {"plugins": {"fixture": {"values": {"API_TOKEN": 7}}}}}  garbage-token-5521'),
    });
    const refused = yield* Effect.flip(world.install(yield* world.place('fixture', manifest)));
    expect(refused).toMatchObject({ code: 'plugin-refused' });
    expect(JSON.stringify(refused)).toContain('secret store');
    expect(JSON.stringify(refused)).not.toContain('garbage-token-5521');
    expect(world.host.reading('fixture')).toBeUndefined();
  }),
);
