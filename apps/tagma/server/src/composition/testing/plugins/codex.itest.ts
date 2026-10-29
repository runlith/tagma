import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { Context, Effect, Layer } from 'effect';
import { makeDoorWorld } from '../doorFixture.js';
import { type Files, skill, written } from './files.js';

const LEGACY: Files = {
  '.codex-plugin/plugin.json': JSON.stringify({
    name: 'cx-demo',
    version: '0.2.0',
    author: { name: 'Acme' },
    interface: { displayName: 'Codex Demo', shortDescription: 'Does codex things.', brandColor: '#112233' },
    skills: './skills/',
    mcpServers: './.mcp.json',
    apps: './.app.json',
    onboardingSkill: './skills/greet/SKILL.md',
  }),
  'skills/greet/SKILL.md': skill('Greets.'),
  '.mcp.json': JSON.stringify({
    mcpServers: { remote: { type: 'http', url: 'http://127.0.0.1:9/mcp', oauth_resource: 'http://127.0.0.1:9' } },
  }),
  '.app.json': JSON.stringify({ apps: { demo: { id: 'asdk_app_demo' } } }),
};

const PORTABLE: Files = {
  'plugin.json': JSON.stringify({
    $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
    name: 'cx.portable',
    extensions: {
      'com.openai': {
        interface: { displayName: 'Inline Title' },
        hooks: { PreToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'echo inline >&2; exit 2' }] }] },
      },
    },
  }),
  '.codex-plugin/plugin.json': JSON.stringify({
    name: 'cx.portable',
    interface: { displayName: 'Fallback Title' },
    hooks: './fallback-hooks.json',
  }),
  'fallback-hooks.json': JSON.stringify({
    hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'echo fallback >&2; exit 2' }] }] },
  }),
  'skills/plan/SKILL.md': skill('Plans.'),
};

type Row = {
  readonly id: string;
  readonly title: string | null;
  readonly format: string | null;
  readonly components: readonly { readonly kind: string; readonly name: string; readonly detail?: string }[];
  readonly ignored: readonly { readonly component: string; readonly name: string | null }[];
};

const setup = Effect.gen(function* () {
  const world = yield* makeDoorWorld();
  const scope = `project=${yield* world.stealthProject()}`;
  const installed: string[] = [];
  yield* Effect.addFinalizer(() =>
    Effect.forEach(installed, (id) => world.op('uninstall_plugin', { id }, scope), { discard: true }).pipe(Effect.orDie),
  );
  const install = Effect.fnUntraced(function* (name: string, files: Files) {
    const source = yield* written(yield* world.directory(name), files);
    const answer = yield* world.op('install_plugin', { source }, scope);
    const plugin = (answer.body as { readonly plugin?: Row }).plugin;
    if (plugin === undefined) return yield* Effect.die(new Error(JSON.stringify(answer.body)));
    installed.push(plugin.id);
    return plugin;
  });
  return { install };
});

class Codex extends Context.Service<Codex, Effect.Success<typeof setup>>()('testing/Codex') {}

layer(Layer.effect(Codex, setup).pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })('codex plugins', (it) => {
  it.effect('a legacy Codex package installs with its skills and remote server and lists its app connection as ignored', () =>
    Effect.gen(function* () {
      const { install } = yield* Codex;
      const plugin = yield* install('legacy', LEGACY);

      expect(plugin.format).toBe('codex');
      expect(plugin.title).toBe('Codex Demo');
      expect(plugin.components).toEqual(
        expect.arrayContaining([
          { kind: 'skill', name: 'cx-demo-greet' },
          { kind: 'mcp-server', name: 'cx-demo-remote', detail: 'http://127.0.0.1:9/mcp' },
        ]),
      );
      expect(plugin.ignored).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ component: '.app.json' }),
          expect.objectContaining({ component: 'apps', name: './.app.json' }),
          expect.objectContaining({ component: 'onboardingSkill' }),
        ]),
      );
    }),
  );

  it.effect('an inline extensions["com.openai"] overlay replaces the .codex-plugin manifest beside a root Agent Plugins manifest', () =>
    Effect.gen(function* () {
      const { install } = yield* Codex;
      const plugin = yield* install('portable', PORTABLE);

      expect(plugin.format).toBe('codex');
      expect(plugin.title).toBe('Inline Title');
      expect(plugin.components).toEqual(
        expect.arrayContaining([
          { kind: 'skill', name: 'cx-portable-plan' },
          { kind: 'hook', name: 'PreToolUse Edit: echo inline >&2; exit 2' },
        ]),
      );
      expect(plugin.components.filter((component) => component.kind === 'hook')).toHaveLength(1);
      expect(plugin.ignored).toContainEqual(expect.objectContaining({ component: '.codex-plugin/plugin.json' }));
    }),
  );
});
