import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { Context, Effect, FileSystem, Layer, Schema } from 'effect';
import { doctrine } from '../composed.js';
import { shippedAdaptersLayer } from './shipped.js';
import { installForAccount } from '../../../external-harnesses/installs/skillInstall.js';
import { skillStatus } from '../../../external-harnesses/testing/doubles.js';
import { MCP_KEY_VARIABLE } from '../../../platform/contract/wire/session.js';
import type { SectionCatalog } from '../../../platform/contract/service/sections.js';

class AccountFixture extends Context.Service<AccountFixture, { home: string; contributed: SectionCatalog }>()('test/AccountFixture') {}

const fixture = Layer.effect(
  AccountFixture,
  Effect.gen(function* () {
    const disk = yield* FileSystem.FileSystem;
    const home = yield* disk.makeTempDirectoryScoped({ prefix: 'account-layer-' });
    const { contributed } = yield* doctrine;
    return AccountFixture.of({ home, contributed });
  }),
).pipe(Layer.provideMerge(BunFileSystem.layer), Layer.provideMerge(shippedAdaptersLayer));

const CLI = ['/opt/tagma/install/current/bun', '/opt/tagma/install/current/bin/cli/main.js'];
const decodeConfig = Schema.decodeUnknownEffect(
  Schema.Struct({
    model: Schema.optional(Schema.String),
    mcp_servers: Schema.Record(
      Schema.String,
      Schema.Struct({
        command: Schema.String,
        args: Schema.optional(Schema.Array(Schema.String)),
        env: Schema.optional(Schema.Record(Schema.String, Schema.String)),
      }),
    ),
  }),
);

layer(fixture, { excludeTestServices: true })('account layer', (it) => {
  it.effect('each selected Claude or Codex directory receives its layer and preserves unrelated user hooks', () =>
    Effect.gen(function* () {
      const { home, contributed } = yield* AccountFixture;
      const disk = yield* FileSystem.FileSystem;
      for (const [name, suffix, file] of [
        ['claude-code', 'one', 'settings.json'],
        ['claude-code', 'two', 'settings.json'],
        ['codex', 'codex', 'hooks.json'],
      ] as const) {
        const directory = join(home, suffix);
        yield* disk.makeDirectory(directory);
        const foreign = { hooks: [{ type: 'command', command: 'echo foreign' }] };
        yield* disk.writeFileString(join(directory, file), JSON.stringify({ hooks: { SessionStart: [foreign] } }));
        const installed = yield* installForAccount(name, directory, contributed, CLI);
        expect(installed.hooks[0]?.path).toBe(join(directory, file));
        if (name === 'codex') {
          expect(installed.mcp?.path).toBe(join(directory, 'config.toml'));
          const config = yield* decodeConfig(Bun.TOML.parse(yield* disk.readFileString(join(directory, 'config.toml'))));
          expect(config.mcp_servers?.tagma?.args).toContain('mcp-serve');
          expect(typeof config.mcp_servers?.tagma?.env?.[MCP_KEY_VARIABLE]).toBe('string');
        }
        expect((yield* skillStatus(join(directory, 'skills', 'tagma'), contributed)).state).toBe('current');
        expect(JSON.parse(yield* disk.readFileString(join(directory, file))).hooks.SessionStart[0]).toEqual(foreign);
        expect((yield* installForAccount(name, directory, contributed, CLI)).hooks[0]?.write).toBe('current');
      }
    }),
  );

  it.effect('concurrent starts install one complete Codex account layer while preserving unrelated config', () =>
    Effect.gen(function* () {
      const { home, contributed } = yield* AccountFixture;
      const disk = yield* FileSystem.FileSystem;
      const directory = join(home, 'concurrent');
      yield* disk.makeDirectory(directory);
      yield* disk.writeFileString(join(directory, 'config.toml'), 'model = "fixture"\n[mcp_servers.foreign]\ncommand = "foreign-server"\n');
      yield* Effect.all(
        [installForAccount('codex', directory, contributed, CLI), installForAccount('codex', directory, contributed, CLI)],
        { concurrency: 2 },
      );
      const config = yield* decodeConfig(Bun.TOML.parse(yield* disk.readFileString(join(directory, 'config.toml'))));
      expect(config.model).toBe('fixture');
      expect(config.mcp_servers?.foreign?.command).toBe('foreign-server');
      expect(config.mcp_servers?.tagma?.args).toContain('mcp-serve');
      expect((yield* skillStatus(join(directory, 'skills', 'tagma'), contributed)).state).toBe('current');
    }),
  );

  it.effect('an unreadable account hook file refuses before the skill is installed', () =>
    Effect.gen(function* () {
      const { home, contributed } = yield* AccountFixture;
      const disk = yield* FileSystem.FileSystem;
      const directory = join(home, 'broken');
      yield* disk.makeDirectory(directory);
      yield* disk.writeFileString(join(directory, 'settings.json'), '{broken');
      expect((yield* Effect.flip(installForAccount('claude-code', directory, contributed, CLI)))._tag).toBe('InstallFailed');
      expect((yield* skillStatus(join(directory, 'skills', 'tagma'), contributed)).state).toBe('missing');
    }),
  );
});
