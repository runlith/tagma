import { expect } from 'bun:test';
import { join, resolve } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { makeDoorWorld } from '../doorFixture.js';
import { committed, type Files, repository, skill } from './files.js';

const MCP_SERVER = resolve(import.meta.dir, '../../../../../../../packages/mcp/test/mcpTestServer.ts');

type Component = { readonly kind: string; readonly name: string; readonly detail?: string };
type Entry = { readonly marketplace: string; readonly name: string; readonly state: string; readonly taken?: string };
type Marketplace = {
  readonly id: string;
  readonly label: string;
  readonly revision: { readonly commit: string | null } | null;
  readonly failure: { readonly reason: string } | null;
};
type Preview = {
  readonly prepared: string;
  readonly id: string;
  readonly source: { readonly commit?: string };
  readonly components: readonly Component[];
  readonly consent: { readonly runs: readonly string[] };
};
type Plugin = {
  readonly id: string;
  readonly source: { readonly commit?: string };
  readonly origin?: { readonly marketplace: string; readonly entry: string };
  readonly components: readonly Component[];
  readonly ignored: readonly { readonly component: string }[];
};
type Answer = {
  readonly code?: string;
  readonly marketplace?: Marketplace;
  readonly marketplaces?: readonly Marketplace[];
  readonly entries?: readonly Entry[];
  readonly preview?: Preview;
  readonly plugin?: Plugin;
  readonly plugins?: readonly Plugin[];
};

const claudeList = (name: string, plugins: readonly unknown[]): Files => ({
  '.claude-plugin/marketplace.json': JSON.stringify({ name, owner: { name: 'Fixture' }, plugins }),
});

const setup = Effect.gen(function* () {
  const world = yield* makeDoorWorld();
  const scope = `project=${yield* world.stealthProject()}`;
  const call = (id: string, input: unknown) => Effect.map(world.op(id, input, scope), (answer) => answer.body as Answer);
  const kept = Effect.fnUntraced(function* (marketplaces: readonly string[], plugins: readonly string[]) {
    yield* Effect.addFinalizer(() =>
      Effect.andThen(
        Effect.forEach(plugins, (id) => world.op('uninstall_plugin', { id }, scope), { discard: true }),
        Effect.forEach(marketplaces, (id) => world.op('remove_marketplace', { id }, scope), { discard: true }),
      ).pipe(Effect.orDie),
    );
  });
  const installed = Effect.fnUntraced(function* (marketplace: string, entry: string) {
    const { preview } = yield* call('preview_plugin', { marketplace, entry });
    if (preview === undefined) return yield* Effect.die(new Error(`${entry} was not previewed`));
    const { plugin } = yield* call('install_plugin', { prepared: preview.prepared });
    if (plugin === undefined) return yield* Effect.die(new Error(`${entry} was not installed`));
    return { preview, plugin };
  });
  return { world, call, kept, installed };
});

class Market extends Context.Service<Market, Effect.Success<typeof setup>>()('testing/Market') {}

const names = (components: readonly Component[]) => components.map((component) => component.name).sort();

layer(Layer.effect(Market, setup).pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })('marketplaces', (it) => {
  it.effect(
    'entries of both list formats install by their source kind, combine with plugin.json by Claude’s rules, and refused entries never hide the rest',
    () =>
      Effect.gen(function* () {
        const { world, call, kept, installed } = yield* Market;
        yield* kept(['fixture-claude', 'fixture-codex'], ['manifestless', 'appended', 'nested', 'pinned', 'legacy', 'twin']);
        const tools = yield* world.directory('tools');
        yield* repository(tools, {
          '.claude-plugin/plugin.json': JSON.stringify({ name: 'tools' }),
          'sub/.claude-plugin/plugin.json': JSON.stringify({ name: 'nested' }),
          'sub/skills/deep/SKILL.md': skill('Deep.'),
        });
        const pins = yield* world.directory('pins');
        const early = yield* repository(pins, {
          '.claude-plugin/plugin.json': JSON.stringify({ name: 'pinned' }),
          'skills/early/SKILL.md': skill('Early.'),
        });
        yield* committed(pins, { 'skills/late/SKILL.md': skill('Late.') });

        const claude = yield* world.directory('claude-market');
        yield* repository(claude, {
          ...claudeList('fixture-claude', [
            {
              name: 'manifestless',
              source: './plugins/manifestless',
              mcpServers: { echo: { command: process.execPath, args: [MCP_SERVER] } },
            },
            { name: 'appended', source: './plugins/appended', commands: ['./more'] },
            { name: 'conflicted', source: './plugins/conflicted', strict: false, skills: ['./extra'] },
            { name: 'nested', source: { source: 'git-subdir', url: `file://${tools}`, path: 'sub' } },
            { name: 'pinned', source: { source: 'url', url: `file://${pins}`, sha: early } },
            { name: 'unserved', source: { source: 'url', url: `file://${pins}`, sha: 'a'.repeat(40) } },
            { name: 'escaping', source: './../outside' },
            { name: 'packaged', source: { source: 'npm', package: '@acme/packaged' } },
            { name: 'zipped', source: { source: 'archive', url: 'https://example.invalid/zipped.zip' } },
            { name: 'commanded', source: { source: 'command', command: 'acme plugin-path' } },
            { name: 'broken' },
            { name: 'twin', source: './plugins/twin' },
          ]),
          'plugins/manifestless/skills/greet/SKILL.md': skill('Greets.'),
          'plugins/appended/.claude-plugin/plugin.json': JSON.stringify({ name: 'appended' }),
          'plugins/appended/commands/hello.md': 'Say hello.\n',
          'plugins/appended/more/extra.md': 'Say more.\n',
          'plugins/conflicted/.claude-plugin/plugin.json': JSON.stringify({ name: 'conflicted' }),
          'plugins/conflicted/extra/x/SKILL.md': skill('Extra.'),
          'plugins/twin/.claude-plugin/plugin.json': JSON.stringify({ name: 'twin' }),
          'plugins/twin/skills/one/SKILL.md': skill('One.'),
        });
        const codex = yield* world.directory('codex-market');
        yield* repository(codex, {
          '.agents/plugins/marketplace.json': JSON.stringify({
            name: 'fixture-codex',
            plugins: [
              {
                name: 'legacy',
                source: { source: 'local', path: './plugins/legacy' },
                policy: { installation: 'AVAILABLE', products: ['CODEX'] },
              },
              { name: 'twin', source: { source: 'local', path: './plugins/twin' } },
            ],
          }),
          'plugins/legacy/.codex-plugin/plugin.json': JSON.stringify({ name: 'legacy', interface: { displayName: 'Legacy' } }),
          'plugins/legacy/skills/hello/SKILL.md': skill('Hello.'),
          'plugins/legacy/.mcp.json': JSON.stringify({ mcpServers: { remote: { type: 'http', url: 'http://127.0.0.1:9/mcp' } } }),
          'plugins/legacy/.app.json': JSON.stringify({ apps: { legacy: { id: 'asdk_app_legacy' } } }),
          'plugins/twin/.codex-plugin/plugin.json': JSON.stringify({ name: 'twin' }),
          'plugins/twin/skills/two/SKILL.md': skill('Two.'),
        });

        expect((yield* call('add_marketplace', { source: `file://${claude}` })).marketplace).toMatchObject({
          id: 'fixture-claude',
          label: 'unreviewed',
        });
        expect((yield* call('add_marketplace', { source: `file://${codex}` })).marketplace).toMatchObject({
          id: 'fixture-codex',
          label: 'unreviewed',
        });
        const listed = new Map(
          ((yield* call('read_marketplaces', { marketplace: 'fixture-claude', limit: 20 })).entries ?? []).map((entry) => [
            entry.name,
            entry.state,
          ]),
        );
        expect(Object.fromEntries(listed)).toEqual({
          manifestless: 'available',
          appended: 'available',
          conflicted: 'available',
          nested: 'available',
          pinned: 'available',
          unserved: 'available',
          escaping: 'refused',
          packaged: 'refused',
          zipped: 'refused',
          commanded: 'refused',
          broken: 'refused',
          twin: 'available',
        });
        for (const entry of ['escaping', 'packaged', 'zipped', 'commanded', 'broken']) {
          expect((yield* call('preview_plugin', { marketplace: 'fixture-claude', entry })).code).toBe('marketplace-entry-refused');
        }

        const manifestless = yield* installed('fixture-claude', 'manifestless');
        expect(manifestless.preview.consent.runs).toEqual([`${process.execPath} ${MCP_SERVER}`]);
        expect(names(manifestless.plugin.components)).toEqual(['manifestless-echo', 'manifestless-greet']);
        expect(manifestless.plugin.origin).toEqual({ marketplace: 'fixture-claude', entry: 'manifestless' });
        expect(names((yield* installed('fixture-claude', 'appended')).plugin.components)).toEqual(['appended-extra', 'appended-hello']);
        expect((yield* call('preview_plugin', { marketplace: 'fixture-claude', entry: 'conflicted' })).code).toBe('plugin-refused');
        expect(names((yield* installed('fixture-claude', 'nested')).plugin.components)).toEqual(['nested-deep']);
        const pinned = yield* installed('fixture-claude', 'pinned');
        expect([pinned.plugin.source.commit, names(pinned.plugin.components)]).toEqual([early, ['pinned-early']]);
        expect((yield* call('preview_plugin', { marketplace: 'fixture-claude', entry: 'unserved' })).code).toBe('plugin-pin-unreachable');

        const legacy = (yield* installed('fixture-codex', 'legacy')).plugin;
        expect(legacy.components).toEqual(
          expect.arrayContaining([
            { kind: 'skill', name: 'legacy-hello' },
            { kind: 'mcp-server', name: 'legacy-remote', detail: 'http://127.0.0.1:9/mcp' },
          ]),
        );
        expect(legacy.ignored).toContainEqual(expect.objectContaining({ component: '.app.json' }));

        yield* installed('fixture-claude', 'twin');
        const twins = ((yield* call('read_marketplaces', { limit: 20 })).entries ?? []).filter((entry) => entry.name === 'twin');
        expect(twins).toEqual([
          expect.objectContaining({ marketplace: 'fixture-claude', state: 'installed' }),
          expect.objectContaining({ marketplace: 'fixture-codex', state: 'taken', taken: 'twin@fixture-claude' }),
        ]);
        expect((yield* call('preview_plugin', { marketplace: 'fixture-codex', entry: 'twin' })).code).toBe('plugin-id-taken');
      }),
  );

  it.effect(
    'install keeps the previewed revision, a refresh moves no installed plugin, update follows the stored list, and a failed refresh keeps it',
    () =>
      Effect.gen(function* () {
        const { world, call, kept, installed } = yield* Market;
        yield* kept(['fixture-rooted'], ['rooted']);
        const files = yield* FileSystem.FileSystem;
        const rooted = yield* world.directory('rooted');
        yield* repository(rooted, {
          '.claude-plugin/plugin.json': JSON.stringify({ name: 'rooted' }),
          'skills/first/SKILL.md': skill('First.'),
        });
        const market = yield* world.directory('rooted-market');
        const listed = yield* repository(
          market,
          claudeList('fixture-rooted', [{ name: 'rooted', source: { source: 'url', url: `file://${rooted}` } }]),
        );
        yield* call('add_marketplace', { source: `file://${market}` });

        const { preview } = yield* call('preview_plugin', { marketplace: 'fixture-rooted', entry: 'rooted' });
        yield* committed(rooted, { 'skills/later/SKILL.md': skill('Later.') });
        const first = (yield* call('install_plugin', { prepared: preview?.prepared })).plugin;
        expect([first?.source.commit, names(first?.components ?? [])]).toEqual([preview?.source.commit, ['rooted-first']]);
        expect((yield* call('install_plugin', { prepared: preview?.prepared })).code).toBe('plugin-preview-expired');

        expect((yield* call('refresh_marketplace', { id: 'fixture-rooted' })).marketplace?.revision?.commit).toBe(listed);
        expect(names((yield* call('read_plugins', {})).plugins?.find((plugin) => plugin.id === 'rooted')?.components ?? [])).toEqual([
          'rooted-first',
        ]);
        expect(names((yield* call('update_plugin', { id: 'rooted' })).plugin?.components ?? [])).toEqual(['rooted-first', 'rooted-later']);

        yield* files.rename(market, `${market}-gone`);
        expect((yield* call('refresh_marketplace', { id: 'fixture-rooted' })).code).toBe('marketplace-unreachable');
        const read = yield* call('read_marketplaces', { marketplace: 'fixture-rooted' });
        expect(read.marketplaces?.[0]?.revision?.commit).toBe(listed);
        expect(read.marketplaces?.[0]?.failure?.reason).toContain('could not clone');
        expect(read.entries).toEqual([expect.objectContaining({ name: 'rooted', state: 'installed' })]);

        yield* call('remove_marketplace', { id: 'fixture-rooted' });
        expect((yield* call('update_plugin', { id: 'rooted' })).code).toBe('marketplace-gone');
        expect(names((yield* call('read_plugins', {})).plugins?.find((plugin) => plugin.id === 'rooted')?.components ?? [])).toEqual([
          'rooted-first',
          'rooted-later',
        ]);
      }),
  );
});
