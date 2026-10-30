import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { dirname, join } from 'node:path';
import { Context, Effect, FileSystem, Layer, Schema } from 'effect';
import { doctrine } from '../../doctrine.js';
import { fixtureMigrations } from '../migrations.js';
import { harnessAdaptersLayer } from '../../../external-harnesses/adapters.js';
import { builtinHarness } from '../../../external-harnesses/testing/builtin.js';
import type { McpSurface } from '@runlith/tagma/adapter/harness';
import { declareInto } from '../../../external-harnesses/installs/mcpDeclaration.js';
import { besideEnv } from '../../../installation/cut/beside.js';
import { declaredForLaunch, refreshedFor, refreshInstallations } from '../../../external-harnesses/installs/upgrade.js';
import { skillTarget } from '../../../external-harnesses/testing/doubles.js';
import { MCP_KEY_VARIABLE } from '../../../platform/contract/wire/session.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { unitsLayer } from '../../../platform/store/units.js';
import { seededStoreLayer } from '../../../platform/store/open.js';
import type { SectionCatalog } from '../../../platform/contract/service/sections.js';

class RefreshFixture extends Context.Service<RefreshFixture, { contributed: SectionCatalog }>()('test/RefreshFixture') {}

const fixture = Layer.effect(
  RefreshFixture,
  Effect.map(doctrine, ({ contributed }) => RefreshFixture.of({ contributed })),
).pipe(
  Layer.provideMerge(
    Layer.unwrap(
      Effect.map(sharedPool, (pool) =>
        unitsLayer(MachineUnits, MachineStore).pipe(
          Layer.provideMerge(seededStoreLayer(MachineStore, fixtureMigrations, { durable: false }, pool)),
        ),
      ),
    ),
  ),
  Layer.provideMerge(BunFileSystem.layer),
  Layer.provideMerge(harnessAdaptersLayer),
);

const CLI = ['/opt/tagma/install/current/bun', '/opt/tagma/install/current/bin/cli/main.js'];
const claudeCode = builtinHarness('claude-code');
const surface = claudeCode.mcp as McpSurface;
const KEY = 'the-key-this-checkout-signs-with';
const FOREIGN = 'echo foreign keeper';
const nested = (command: string) => ({ hooks: [{ type: 'command', command }] });
const oldClaude = () => ({
  hooks: {
    SessionStart: [nested(FOREIGN), nested('tagma prime'), nested('tagma hook session-start')],
    PreToolUse: [nested('tagma hook pre-tool-use')],
    PostToolUse: [nested('tagma hook post-tool-use')],
    Stop: [nested('tagma hook stop')],
    PermissionRequest: [{ hooks: [{ type: 'command', command: 'tagma hook permission-request', timeout: 300 }] }],
  },
});
const oldCursor = () => ({
  version: 1,
  hooks: {
    sessionStart: [{ command: FOREIGN }, { command: 'tagma prime' }, { command: 'tagma hook session-start' }],
    preToolUse: [{ command: 'tagma hook pre-tool-use' }],
    postToolUse: [{ command: 'tagma hook post-tool-use' }],
    stop: [{ command: 'tagma hook stop' }],
    beforeShellExecution: [{ command: 'tagma hook permission-request', timeout: 300 }],
  },
});

const readHooks = Effect.fnUntraced(function* (root: string, file: string) {
  const disk = yield* FileSystem.FileSystem;
  return (JSON.parse(yield* disk.readFileString(join(root, file))) as { hooks: Record<string, unknown[]> }).hooks;
});

const declared = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      mcpServers: Schema.Struct({
        tagma: Schema.Struct({ args: Schema.Array(Schema.String), env: Schema.Record(Schema.String, Schema.String) }),
      }),
    }),
  ),
);

const staleProject = Effect.fn('testing.staleProject')(function* (prefix: string) {
  const disk = yield* FileSystem.FileSystem;
  const root = yield* disk.makeTempDirectoryScoped({ prefix });
  yield* disk.makeDirectory(skillTarget(root), { recursive: true });
  const stale = {
    command: '/old/bun',
    args: ['/old/main.js', 'mcp-serve', '--harness', 'claude'],
    type: 'stdio',
    env: { [MCP_KEY_VARIABLE]: KEY },
  };
  yield* disk.writeFileString(join(root, '.mcp.json'), `${JSON.stringify({ mcpServers: { tagma: stale } }, null, 2)}\n`);
  return root;
});

const declaration = (root: string) =>
  Effect.flatMap(
    Effect.flatMap(FileSystem.FileSystem, (disk) => disk.readFileString(join(root, '.mcp.json'))),
    (text) => Effect.map(declared(text), (document) => document.mcpServers.tagma),
  );

layer(fixture, { excludeTestServices: true })('installations brought up to a new build', (it) => {
  it.effect('the main installation updates checkout integrations, and a beside installation preserves them on refresh and launch', () =>
    Effect.gen(function* () {
      const { contributed } = yield* RefreshFixture;
      const disk = yield* FileSystem.FileSystem;
      const root = yield* staleProject('beside-integrations-');
      const adapters = (['claude-code', 'devin', 'gemini', 'grok'] as const).map(builtinHarness);
      const declare = (repo: string, cli: readonly string[]) =>
        Promise.all(adapters.map((adapter) => declareInto(repo, adapter, adapter.mcp as McpSurface, cli)));
      yield* Effect.promise(() => declare(root, ['/old/tagma']));
      yield* disk.writeFileString(join(root, 'AGENTS.md'), 'old-law\n');
      const projects = Effect.succeed([{ id: 1, name: 'project', rootPath: root, private: false }]);
      const main = { HOME: '/operator/home' };
      const refreshed = yield* refreshInstallations(
        projects,
        () => Effect.succeed('main-law'),
        (repo) => declare(repo, CLI),
        contributed,
        main,
      );
      expect(refreshed.map((entry) => entry.failed ?? null)).toEqual([null]);
      const paths = ['.mcp.json', '.devin/mcp_config.json', '.gemini/settings.json', '.grok/config.toml', 'AGENTS.md'];
      const installed = yield* Effect.forEach(paths, (path) => disk.readFileString(join(root, path)));
      for (const text of installed.slice(0, -1)) expect(text).toContain(CLI[0]!);
      expect(installed.at(-1)).toContain('main-law');
      const beside = { ...main, ...besideEnv('/trial', 48400) };
      yield* refreshInstallations(
        projects,
        () => Effect.succeed('trial-law'),
        (repo) => declare(repo, ['/trial/tagma']),
        contributed,
        beside,
      );
      expect(yield* declaredForLaunch('claude-code', false, root, ['/trial/tagma'], beside)).toBeNull();
      expect(yield* Effect.forEach(paths, (path) => disk.readFileString(join(root, path)))).toEqual(installed);
    }),
  );

  it.effect('a start under a new build rewrites a stale declaration keeping its key, and a start under the same build reads nothing', () =>
    Effect.gen(function* () {
      const { contributed } = yield* RefreshFixture;
      const root = yield* staleProject('refresh-');
      const refresh = refreshInstallations(
        Effect.succeed([{ id: 1, name: 'project', rootPath: root, private: false }]),
        () => Effect.succeed('law'),
        async (repoRoot) => [await declareInto(repoRoot, claudeCode, surface, CLI)],
        contributed,
      );
      const first = yield* refreshedFor('build-b', refresh);
      expect(first?.map((entry) => entry.failed ?? null)).toEqual([null]);
      const rewritten = yield* declaration(root);
      expect(rewritten.args.slice(-2)).toEqual(['--harness', 'claude-code']);
      expect(rewritten.env[MCP_KEY_VARIABLE]).toBe(KEY);
      expect(yield* refreshedFor('build-b', Effect.die('a start under the same build refreshed again'))).toBeNull();
    }),
  );

  it.effect('refresh reconciles old hooks and continues after a failed project, which can be repaired and retried', () =>
    Effect.gen(function* () {
      const { contributed } = yield* RefreshFixture;
      const disk = yield* FileSystem.FileSystem;
      const bad = yield* staleProject('bad-hooks-');
      const good = yield* staleProject('good-hooks-');
      for (const [path, document] of [
        [join(bad, '.claude/settings.json'), { hooks: { Stop: [null] } }],
        [join(good, '.claude/settings.json'), oldClaude()],
        [join(good, '.codex/hooks.json'), oldClaude()],
        [join(good, '.cursor/hooks.json'), oldCursor()],
      ] as const) {
        yield* disk.makeDirectory(dirname(path), { recursive: true });
        yield* disk.writeFileString(path, JSON.stringify(document));
      }
      const refresh = refreshInstallations(
        Effect.succeed([
          { id: 1, name: 'bad', rootPath: bad, private: false },
          { id: 2, name: 'good', rootPath: good, private: false },
        ]),
        () => Effect.succeed('project law'),
        async () => [],
        contributed,
        {},
      );
      expect((yield* refresh).map((entry) => [entry.place, entry.failed ?? null])).toEqual([
        ['bad', expect.stringContaining(`${bad}/.claude/settings.json holds a malformed entry at Stop[0]`)],
        ['good', null],
      ]);
      const claude = yield* readHooks(good, '.claude/settings.json');
      expect(claude.SessionStart?.[0]).toEqual(nested(FOREIGN));
      expect(claude.SessionStart).toHaveLength(2);
      expect(JSON.stringify(claude.SessionStart)).not.toContain('tagma prime');
      expect(JSON.stringify(claude.UserPromptSubmit)).toContain('hook observe');
      expect(JSON.stringify(claude.SessionEnd)).toContain('hook observe');
      expect(JSON.stringify((yield* readHooks(good, '.codex/hooks.json')).UserPromptSubmit)).toContain('hook observe');
      const cursor = yield* readHooks(good, '.cursor/hooks.json');
      expect(cursor.sessionStart?.[0]).toEqual({ command: FOREIGN });
      expect(cursor.sessionStart).toHaveLength(2);
      expect(JSON.stringify(cursor.sessionStart)).not.toContain('tagma prime');
      expect(JSON.stringify(cursor.beforeSubmitPrompt)).toContain('hook observe');
      yield* disk.writeFileString(join(bad, '.claude/settings.json'), JSON.stringify(oldClaude()));
      expect((yield* refresh).map((entry) => entry.failed ?? null)).toEqual([null, null]);
      expect(JSON.stringify((yield* readHooks(bad, '.claude/settings.json')).UserPromptSubmit)).toContain('hook observe');
    }),
  );

  it.effect('a launch rewrites the stale declaration of a project Tagma stands in, and leaves a private project to its user layer', () =>
    Effect.gen(function* () {
      const disk = yield* FileSystem.FileSystem;
      const root = yield* staleProject('launch-');
      const before = yield* disk.readFileString(join(root, '.mcp.json'));
      expect(yield* declaredForLaunch('claude-code', true, root, CLI)).toBeNull();
      expect(yield* disk.readFileString(join(root, '.mcp.json'))).toBe(before);
      expect((yield* declaredForLaunch('claude-code', false, root, CLI))?.write).toBe('updated');
      const rewritten = yield* declaration(root);
      expect(rewritten.args.slice(-2)).toEqual(['--harness', 'claude-code']);
      expect(rewritten.env[MCP_KEY_VARIABLE]).toBe(KEY);
    }),
  );
});
