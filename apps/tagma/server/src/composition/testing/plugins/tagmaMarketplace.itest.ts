import { expect } from 'bun:test';
import { join, resolve } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { oauthServer } from '@runlith/mcp/testing/oauth';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { McpServers } from '../../../mcp/contract/service/servers.js';
import { DoorFixture, doorFixture, projectLeaving } from '../doorFixture.js';
import { repository } from './files.js';

const REVISION = resolve(import.meta.dir, 'tagma-plugins');
const SERVICES = ['linear', 'notion', 'sentry'] as const;

type Answer = {
  readonly code?: string;
  readonly marketplace?: { readonly id: string };
  readonly entries?: readonly { readonly name: string; readonly state: string }[];
  readonly preview?: { readonly prepared: string };
  readonly plugin?: { readonly id: string; readonly components: readonly { readonly kind: string; readonly name: string }[] };
  readonly skills?: readonly { readonly id: string }[];
  readonly mcp?: readonly { readonly name: string; readonly status: string; readonly signIn?: { readonly signedIn: boolean } }[];
  readonly url?: string;
};

layer(Layer.mergeAll(doorFixture(), BunFileSystem.layer), { excludeTestServices: true })('tagma marketplace', (it) => {
  it.effect(
    'the published revision installs each service plugin through the operations, offers its skill, and its server signs in and answers a tool call',
    () =>
      Effect.gen(function* () {
        const world = yield* DoorFixture;
        const files = yield* FileSystem.FileSystem;
        const oauth = yield* oauthServer();
        const projectId = yield* world.stealthProject();
        yield* projectLeaving(world, projectId);
        const answered = Effect.fnUntraced(function* (id: string, input: unknown) {
          const answer = yield* world.op(id, input, `project=${projectId}`);
          if (answer.status !== 200) return yield* Effect.die(new Error(`${id} answered ${answer.status}: ${JSON.stringify(answer.body)}`));
          return answer.body as Answer;
        });

        const copy = join(yield* world.directory('tagma-marketplace'), 'tagma-plugins');
        yield* files.copy(REVISION, copy);
        for (const service of SERVICES) {
          const path = join(copy, 'plugins', service, '.mcp.json');
          const servers = JSON.parse(yield* files.readFileString(path)) as { mcpServers: Record<string, { url: string }> };
          for (const server of Object.values(servers.mcpServers)) server.url = oauth.url;
          yield* files.writeFileString(path, JSON.stringify(servers));
        }
        yield* repository(copy, {});

        yield* Effect.addFinalizer(() =>
          Effect.andThen(
            Effect.forEach(SERVICES, (id) => world.op('uninstall_plugin', { id }, `project=${projectId}`), { discard: true }),
            world.op('remove_marketplace', { id: 'tagma' }, `project=${projectId}`),
          ).pipe(Effect.orDie),
        );
        expect((yield* answered('add_marketplace', { source: `file://${copy}` })).marketplace?.id).toBe('tagma');
        expect((yield* answered('read_marketplaces', { marketplace: 'tagma' })).entries).toEqual(
          SERVICES.map((name) => expect.objectContaining({ name, state: 'available' })),
        );

        for (const service of SERVICES) {
          const { preview } = yield* answered('preview_plugin', { marketplace: 'tagma', entry: service });
          const { plugin } = yield* answered('install_plugin', { prepared: preview?.prepared });
          expect(plugin?.components.map(({ kind, name }) => [kind, name]).sort()).toEqual([
            ['mcp-server', `${service}-${service}`],
            ['skill', `${service}-${service}`],
          ]);
        }
        const offered = ((yield* answered('read_agent_skills', { kind: 'draft' })).skills ?? []).map((skill) => skill.id);
        expect(offered).toEqual(expect.arrayContaining(SERVICES.map((service) => `${service}-${service}`)));

        const servers = Context.get(world.runtime.owners, McpServers);
        for (const service of SERVICES) {
          const name = `${service}-${service}`;
          const rowOf = Effect.map(answered('read_mcp_servers', {}), (read) => read.mcp?.find((row) => row.name === name));
          expect((yield* rowOf)?.status).toBe('needs-sign-in');
          const { url } = yield* answered('sign_in_mcp_server', { name, scope: 'contributed' });
          const returned = yield* oauth.follow(url ?? '');
          expect((yield* world.call(`${returned.pathname}${returned.search}`)).status).toBe(200);
          expect(yield* rowOf).toMatchObject({ status: 'connected', signIn: { signedIn: true } });
          const said = yield* servers.caller(projectId).call(name, 'whoami', {}, {});
          expect('content' in said ? said.content : said).toEqual([expect.objectContaining({ type: 'text', text: 'Bearer [redacted]' })]);
        }

        const [first] = SERVICES;
        yield* answered('uninstall_plugin', { id: first });
        const { preview } = yield* answered('preview_plugin', { marketplace: 'tagma', entry: first });
        yield* answered('install_plugin', { prepared: preview?.prepared });
        const again = (yield* answered('read_mcp_servers', {})).mcp?.find((row) => row.name === `${first}-${first}`);
        expect(again?.status).toBe('needs-sign-in');
      }),
  );
});
