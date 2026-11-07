import { expect } from 'bun:test';
import { watch } from 'node:fs';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { ActivityLog } from '@runlith/activity/log';
import { activityRecording } from '@runlith/activity/testing';
import { layer } from '@runlith/effect-test';
import { AccountKey } from '@runlith/llm/models/authStatus';
import type { AskProgram } from '@runlith/tagma/adapter/provider';
import { Context, Effect, Fiber, FileSystem, Layer, Queue } from 'effect';
import { ASK_PROGRAM_MODEL, ASK_PROGRAM_PROVIDER, adapter, askProgramFixture } from '../../composition/testing/askProgram.js';
import { makeModelAsks } from '../../providers/asks.js';
import { ProviderAccounts } from '../../providers/contract/service/accounts.js';
import { ModelAccess } from '../../providers/contract/service/access.js';
import { AskPrograms, DefaultSelection } from '../../providers/contract/service/asks.js';
import { PluginRevisions } from '../../plugins/contract/service/plugins.js';
import { unheldRevisions } from '../../plugins/testing/revisions.js';
import { HarnessAccounts } from '../../providers/contract/service/harness.js';
import { ProviderRegistry } from '../../providers/contract/service/registry.js';
import { providerCatalogOf, staticRegistry } from '../../providers/testing/registry.js';
import { UserEnvironment } from '../../installation/contract/service/userEnvironment.js';
import { makeUserEnvironment } from '../../installation/process/userEnvironment.js';
import { InstalledHarnesses } from '../../threads/contract/service/harness.js';
import { makeAskPrograms } from './asks.js';

const MIB = 1024 * 1024;

const filler = Layer.effect(AskPrograms, makeAskPrograms).pipe(
  Layer.provide(Layer.mock(InstalledHarnesses, { program: () => Effect.succeed(null) })),
  Layer.provide(Layer.succeed(UserEnvironment, makeUserEnvironment({ shell: null, env: process.env, world: null, home: null }))),
  Layer.provideMerge(BunFileSystem.layer),
);

const reporting = { ...askProgramFixture, progress: true };

const run = (
  input: string,
  entries: readonly { readonly _tag: 'Set'; readonly name: string; readonly value: string }[] = [],
  program: AskProgram = askProgramFixture,
  stallMs = 60_000,
) =>
  Effect.flatMap(AskPrograms, (programs) =>
    programs.run({
      program,
      ask: { model: ASK_PROGRAM_MODEL, rung: 'low', system: 'Answer.' },
      entries,
      input,
      stallMs,
    }),
  );

const logged = (path: string) =>
  Effect.flatMap(FileSystem.FileSystem, (files) =>
    Effect.map(Effect.orDie(files.readFileString(path)), (text) =>
      text.split('\n').flatMap((line) => (line === '' ? [] : [JSON.parse(line) as Record<string, unknown>])),
    ),
  );

const firstLogged = Effect.fnUntraced(function* (directory: string, path: string) {
  const touched = yield* Queue.unbounded<void>();
  yield* Effect.acquireRelease(
    Effect.sync(() => watch(directory, () => Queue.offerUnsafe(touched, undefined))),
    (watcher) => Effect.sync(() => watcher.close()),
  );
  const rows = Effect.flatMap(FileSystem.FileSystem, (files) =>
    Effect.flatMap(Effect.orDie(files.exists(path)), (exists) => (exists ? logged(path) : Effect.succeed([]))),
  );
  return Effect.repeat(Effect.andThen(Queue.take(touched), rows), { until: (seen) => seen.length > 0 });
});

layer(filler, { excludeTestServices: true })('ask programs', (it) => {
  it.effect('stdin and answers can exceed a mebibyte, and a failed exit keeps its declared refusal', () =>
    Effect.gen(function* () {
      const large = `ASK-BYTES ${'x'.repeat(MIB + 512)}`;
      const ran = yield* run(large);
      expect(ran.exit).toBe(0);
      expect(askProgramFixture.answer(ran)).toMatchObject({ _tag: 'Text', text: String(Buffer.byteLength(large)) });
      expect(askProgramFixture.answer(yield* run('ASK-OUTPUT'))).toMatchObject({
        _tag: 'Text',
        text: 'x'.repeat(MIB + 512),
      });
      const limited = yield* run('ASK-QUOTA');
      expect(limited.exit).toBe(2);
      expect(askProgramFixture.answer(limited)).toMatchObject({ _tag: 'Refused', refusal: 'ask-quota' });
    }),
  );

  it.effect('a program reporting progress is waited for while it moves and stalls once it falls silent', () =>
    Effect.gen(function* () {
      const moving = yield* run('ASK-MOVING ASK-BYTES', [], reporting, 2_000);
      expect(reporting.answer(moving)).toMatchObject({ _tag: 'Text', text: String(Buffer.byteLength('ASK-MOVING ASK-BYTES')) });
      expect(yield* Effect.flip(run('ASK-HANG', [], reporting, 2_000))).toMatchObject({ _tag: 'ProgramStalled', idleMs: 2_000 });
    }),
  );

  it.effect('an interrupted ask leaves no process behind', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const directory = yield* files.makeTempDirectoryScoped({ prefix: 'ask-hang-' });
      const log = join(directory, 'asked.jsonl');
      const started = yield* firstLogged(directory, log);
      const asking = yield* Effect.forkScoped(run('ASK-HANG', [{ _tag: 'Set', name: 'ASK_PROGRAM_LOG', value: log }]));
      const [seen] = yield* started;
      const pid = Number(seen?.pid);
      expect(pid).toBeGreaterThan(0);
      yield* Fiber.interrupt(asking);
      expect(() => process.kill(pid, 0)).toThrow();
    }).pipe(Effect.orDie),
  );

  it.effect('an ask with no thread runs on the provider’s default account', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const directory = yield* files.makeTempDirectoryScoped({ prefix: 'ask-account-' });
      const log = join(directory, 'asked.jsonl');
      const selected: (string | undefined)[] = [];
      const catalog = providerCatalogOf(
        adapter({ product: { mcpServer: 'tagma', client: { name: 'tagma', version: '0' } }, instances: [] }),
      );
      const recording = activityRecording();
      const asks = yield* makeModelAsks.pipe(
        Effect.provideContext(
          Context.make(ProviderRegistry, staticRegistry(catalog)).pipe(
            Context.add(AskPrograms, yield* AskPrograms),
            Context.add(PluginRevisions, unheldRevisions),
            Context.add(ActivityLog, recording.log),
            Context.add(DefaultSelection, DefaultSelection.of({ saved: Effect.succeed(null) })),
            Context.add(ProviderAccounts, {
              connected: Effect.die('not read'),
              of: () => Effect.die('not read'),
            } as ProviderAccounts['Service']),
            Context.add(ModelAccess, { request: () => Effect.die('a program ask makes no request') } as unknown as ModelAccess['Service']),
            Context.add(HarnessAccounts, {
              launch: (_provider: string, account?: string) =>
                Effect.sync(() => {
                  selected.push(account);
                  return {
                    account: AccountKey.make('default-login'),
                    directory: null,
                    entries: [
                      { _tag: 'Set' as const, name: 'ASK_PROGRAM_ACCOUNT', value: 'default-login' },
                      { _tag: 'Set' as const, name: 'ASK_PROGRAM_LOG', value: log },
                    ],
                  };
                }),
            } as unknown as HarnessAccounts['Service']),
          ),
        ),
      );
      const answered = yield* asks.text(
        { provider: ASK_PROGRAM_PROVIDER, model: ASK_PROGRAM_MODEL, reasoning: 'high', account: null },
        { system: 'Answer.', input: 'ASK-BYTES words' },
      );
      expect(answered).toMatchObject({ path: 'program', value: String(Buffer.byteLength('ASK-BYTES words')) });
      expect(selected).toEqual([undefined]);
      expect(yield* logged(log)).toEqual([expect.objectContaining({ account: 'default-login', model: ASK_PROGRAM_MODEL, effort: 'high' })]);
      const quota = yield* Effect.flip(
        asks.text(
          { provider: ASK_PROGRAM_PROVIDER, model: ASK_PROGRAM_MODEL, reasoning: 'high', account: null },
          { system: 'Answer.', input: 'ASK-QUOTA' },
        ),
      );
      expect(quota).toMatchObject({ refusal: 'ask-quota', account: 'default-login' });
    }).pipe(Effect.orDie),
  );
});
