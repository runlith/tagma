import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { expect } from 'bun:test';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { it } from '@runlith/effect-test';
import { Effect, Layer } from 'effect';
import { gitLayer } from '@runlith/git/Git';
import { SURFACE_INDEX, CLI_ENTRY, RUNTIME_PART } from '../contract/wire/layout.js';
import type { Applications } from '../contract/service/applications.js';
import { CHANNELS } from '../contract/wire/channel.js';
import { SERVER_ENTRY, SURFACE } from '../contract/wire/manifest.js';
import { RELEASE_LOG, releaseInstallation, stepBack } from './release.js';

const treed = Effect.acquireRelease(
  Effect.sync(() => realpathSync(mkdtempSync('/tmp/tagma-release-'))),
  (tree) => Effect.sync(() => rmSync(tree, { recursive: true, force: true })),
);

const spawning = BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));
const machine = Layer.mergeAll(BunFileSystem.layer, spawning, gitLayer.pipe(Layer.provide(spawning)));

const wrote = (path: string, text: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

const checkout = (
  tree: string,
  name: string,
  options: { readonly appBuild: string; readonly cliImportsServer: boolean; readonly ripgrep: boolean },
) => {
  const root = join(tree, name);
  const source = join(root, 'apps/tagma/server');
  mkdirSync(root, { recursive: true });
  wrote(join(root, 'packages/llm/package.json'), '{"name":"@runlith/llm"}\n');
  const repository = join(import.meta.dir, '../../../../../..');
  mkdirSync(source, { recursive: true });
  symlinkSync(join(repository, 'packages/llm/node_modules'), join(root, 'packages/llm/node_modules'));
  symlinkSync(join(repository, 'apps/tagma/server/node_modules'), join(source, 'node_modules'));
  if (options.ripgrep) {
    wrote(join(root, 'packages/ripgrep/package.json'), '{"name":"@runlith/ripgrep"}\n');
    symlinkSync(join(repository, 'packages/ripgrep/node_modules'), join(root, 'packages/ripgrep/node_modules'));
  }
  wrote(join(root, 'packages/navigation-ts/package.json'), '{"name":"@runlith/navigation-ts"}\n');
  symlinkSync(join(repository, 'packages/navigation-ts/node_modules'), join(root, 'packages/navigation-ts/node_modules'));
  wrote(join(root, 'packages/performance/drizzle/0001_first/migration.sql'), 'select 1;\n');
  wrote(join(root, 'packages/activity/drizzle/0001_first/migration.sql'), 'select 1;\n');
  wrote(join(source, 'package.json'), '{"name":"@tagma/server","version":"0.1.0"}\n');
  wrote(join(source, 'drizzle/0001_first/migration.sql'), 'select 1;\n');
  wrote(join(source, 'src/native-harness/skills/rules/SKILL.md'), '---\nname: rules\n---\n');
  wrote(
    join(source, 'src/composition/entries/cli.ts'),
    options.cliImportsServer
      ? `const started = await import('../server.js');\nconsole.log(started);\n`
      : `console.log('a CLI that never starts a server');\n`,
  );
  wrote(join(source, 'src/composition/server.ts'), `export const port = 4100;\n`);
  wrote(join(root, 'apps/tagma/app/package.json'), `{"name":"@tagma/app","scripts":{"build":"${options.appBuild}"}}\n`);
  wrote(join(root, 'apps/tagma/desktop/package.json'), '{"name":"@tagma/desktop"}\n');
  wrote(join(root, 'packages/execution-host/package.json'), '{"name":"@runlith/execution-host"}\n');
  wrote(join(root, 'packages/watch/src/artifact.ts'), 'console.log(process.execPath);\n');
  const install = join(root, 'install');
  mkdirSync(join(install, '20260101T000000000Z'), { recursive: true });
  symlinkSync('20260101T000000000Z', join(install, 'current'));
  const shell: NodeJS.ProcessEnv = { HOME: join(root, 'home'), SHELL: '/bin/zsh', PATH: '/usr/bin:/bin' };
  return { source, install, launcher: join(root, 'bin/tagma'), shell };
};

const inert: Applications = {
  carrier: () => null,
  carried: () => null,
  verify: async () => null,
  copy: async () => undefined,
  unquarantine: async () => null,
  clearPlace: () => undefined,
  forget: () => undefined,
  signature: async () => null,
};

const refusalOf = (where: ReturnType<typeof checkout>) =>
  Effect.flip(
    releaseInstallation(where.source, where.install, where.launcher, where.shell, {
      conditions: [],
      developer: false,
      channel: CHANNELS.dev,
      applications: inert,
    }),
  ).pipe(Effect.provide(machine));

const options = { appBuild: 'exit 0', cliImportsServer: true, ripgrep: true };

it.live(
  'a release whose producer refuses leaves the installation that stands, deletes what it wrote, and names the step with its log',
  () =>
    Effect.gen(function* () {
      const where = checkout(yield* treed, 'surface-fails', { ...options, appBuild: 'exit 3' });
      const refusal = yield* refusalOf(where);
      expect(refusal.step).toBe('surface');
      expect(refusal.detail).toContain('3');
      expect(readlinkSync(join(where.install, 'current'))).toBe('20260101T000000000Z');
      expect(existsSync(join(where.install, '20260101T000000000Z'))).toBe(true);
      expect(existsSync(where.launcher)).toBe(false);
      expect(refusal.log).toBe(join(where.install, RELEASE_LOG));
      const log = readFileSync(refusal.log, 'utf8');
      expect(log).toContain('=== surface ===');
      expect(readdirSync(where.install).sort()).toEqual(['20260101T000000000Z', 'current', RELEASE_LOG]);
      expect(readdirSync(join(where.source, '../app/.svelte-kit'))).toEqual([]);
    }),
  30_000,
);

it.live('a refusal from before the version opens writes the log it names', () =>
  Effect.gen(function* () {
    const where = checkout(yield* treed, 'no-app-package', options);
    rmSync(join(where.source, '../app/package.json'));
    const refusal = yield* refusalOf(where);
    expect(refusal.step).toBe('checkout');
    expect(refusal.log).toBe(join(where.install, RELEASE_LOG));
    expect(readFileSync(refusal.log, 'utf8')).toContain('=== checkout ===');
    expect(readFileSync(refusal.log, 'utf8')).toContain(refusal.detail);
    expect(readdirSync(where.install).sort()).toEqual(['20260101T000000000Z', 'current', RELEASE_LOG]);
  }),
);

it.live(
  'a producer that exits 0 having written nothing refuses at its own step',
  () =>
    Effect.gen(function* () {
      const where = checkout(yield* treed, 'surface-empty', options);
      const refusal = yield* refusalOf(where);
      expect(refusal.step).toBe('surface');
      expect(refusal.detail).toContain(`no ${SURFACE}/${SURFACE_INDEX}`);
      expect(readlinkSync(join(where.install, 'current'))).toBe('20260101T000000000Z');
      expect(existsSync(where.launcher)).toBe(false);
    }),
  30_000,
);

it.live('a refusal that could not make the installation root names no log', () =>
  Effect.gen(function* () {
    const tree = yield* treed;
    const where = checkout(tree, 'no-install-root', options);
    const blocked = join(tree, 'no-install-root/blocked');
    writeFileSync(blocked, 'a file standing where the installation root would go\n');
    const refusal = yield* refusalOf({ ...where, install: join(blocked, 'install') });
    expect(refusal.step).toBe('install root');
    expect(refusal.log).toBe('');
  }),
);

it.live(
  'a checkout that cannot supply ripgrep refuses at the tools step',
  () =>
    Effect.gen(function* () {
      const where = checkout(yield* treed, 'no-ripgrep', { ...options, ripgrep: false });
      const refusal = yield* refusalOf(where);
      expect(refusal.step).toBe('tools');
      expect(refusal.detail).toContain('ripgrep');
      expect(readlinkSync(join(where.install, 'current'))).toBe('20260101T000000000Z');
      expect(existsSync(where.launcher)).toBe(false);
    }),
  30_000,
);

it.live(
  'a CLI bundle that would have swallowed the server refuses instead of landing',
  () =>
    Effect.gen(function* () {
      const where = checkout(yield* treed, 'cli-inlines', { ...options, cliImportsServer: false });
      const refusal = yield* refusalOf(where);
      expect(refusal.step).toBe('program');
      expect(refusal.detail).toContain('../server/http.js');
      expect(readlinkSync(join(where.install, 'current'))).toBe('20260101T000000000Z');
    }),
  30_000,
);

const versions = (tree: string, name: string, standing: string, ...held: readonly string[]): string => {
  const root = join(tree, name, 'install');
  for (const version of held) wrote(join(root, version, 'install.json'), '{}\n');
  symlinkSync(standing, join(root, 'current'));
  return root;
};

it.live('stepping back lands on the version below the standing one, and refuses from the oldest kept', () =>
  Effect.gen(function* () {
    const root = versions(yield* treed, 'stepping', '20260102T000000000Z', '20260101T000000000Z', '20260102T000000000Z');
    const stepped = yield* stepBack(root);
    expect(stepped.version).toBe('20260101T000000000Z');
    expect(stepped.from).toBe('20260102T000000000Z');
    expect(readlinkSync(join(root, 'current'))).toBe('20260101T000000000Z');
    yield* Effect.flip(stepBack(root));
    expect(readlinkSync(join(root, 'current'))).toBe('20260101T000000000Z');
  }),
);

it.live('stepping back over an installation root with no link at all names no standing version', () =>
  Effect.gen(function* () {
    const root = join(yield* treed, 'nothing-installed', 'install');
    mkdirSync(root, { recursive: true });
    const refused = yield* Effect.flip(stepBack(root));
    expect(refused.standing).toBeNull();
  }),
);
