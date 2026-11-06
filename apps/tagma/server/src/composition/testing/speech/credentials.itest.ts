import { expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { layer } from '@runlith/effect-test';
import { AccountKey } from '@runlith/llm/models/authStatus';
import { SpeechCredentials } from '@runlith/speech/engine/SpeechCredentials';
import { Effect, Layer, Stream } from 'effect';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { fixtureMigrations } from '../migrations.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { seededStoreLayer } from '../../../platform/store/open.js';
import { unitsLayer } from '../../../platform/store/units.js';
import { DefaultAccounts } from '../../../providers/contract/service/accounts.js';
import { CredentialFiles, KeyedProviders, QuotaProviders } from '../../../providers/contract/service/credentials.js';
import { AccountQuota } from '../../../providers/contract/service/quota.js';
import { AccountCli } from '../../../providers/contract/service/cli.js';
import { BuiltinAdapters } from '../../../providers/contract/service/registry.js';
import { SignIns } from '../../../providers/contract/service/signIns.js';
import { providers } from '../../../providers/providers.js';
import { sessionlessLayer } from '../../../providers/testing/holders.js';
import { credentialsLayer } from '../../../speech/credentials.js';

const home = mkdtempSync(join(tmpdir(), 'tagma-speech-keys-'));

const world = credentialsLayer.pipe(
  Layer.provideMerge(providers.lifetimes.installation),
  Layer.provide(
    Layer.mergeAll(
      Layer.succeed(CredentialFiles, { tokensPath: join(home, 'tokens.json') }),
      Layer.succeed(KeyedProviders, { ids: () => ['soniox', 'elevenlabs'] }),
      Layer.succeed(QuotaProviders, { providers: [] }),
      Layer.succeed(BuiltinAdapters, { sources: [] }),
      sessionlessLayer,
      Layer.succeed(AccountCli, {
        installed: () => Effect.succeed({ _tag: 'Missing', reason: 'absent' } as const),
        changes: Stream.empty,
        run: () => Effect.die('speech credentials do not run an account CLI'),
        login: () => Effect.die('speech credentials do not run an account CLI'),
        ended: () => Effect.die('speech credentials do not run an account CLI'),
        stop: () => Effect.die('speech credentials do not stop an account CLI'),
      }),
    ),
  ),
  Layer.provideMerge(unitsLayer(MachineUnits, MachineStore)),
  Layer.provideMerge(seededStoreLayer(MachineStore, fixtureMigrations, {}, sharedPool)),
);

const refusalOf = (provider: string) =>
  Effect.flatMap(SpeechCredentials, (credentials) =>
    Effect.match(credentials.get(provider), {
      onSuccess: (credential) => ({ credential }),
      onFailure: (refused) => ({ code: refused.code, retryable: refused.retryable, unblocked: refused.unblock.length > 0 }),
    }),
  );

layer(world, { excludeTestServices: true })('speech credentials', (it) => {
  it.effect('no key and several keys without a default are two refusals, each with a way out, and a default signs', () =>
    Effect.gen(function* () {
      expect(yield* refusalOf('soniox')).toEqual({ code: 'no-key', retryable: false, unblocked: true });
      const signIns = yield* SignIns;
      yield* Effect.acquireRelease(signIns.saveConsoleKey('soniox', 'soniox-first'), (key) =>
        signIns.removeConsoleKey('soniox', key.account).pipe(Effect.orDie),
      );
      const second = yield* Effect.acquireRelease(signIns.saveConsoleKey('soniox', 'soniox-second'), (key) =>
        signIns.removeConsoleKey('soniox', key.account).pipe(Effect.orDie),
      );
      const defaults = yield* DefaultAccounts;
      yield* defaults.saveDefaultAccount('soniox', null);
      expect(yield* refusalOf('soniox')).toEqual({ code: 'ambiguous-key', retryable: false, unblocked: true });
      yield* defaults.saveDefaultAccount('soniox', AccountKey.make(second.account));
      expect(yield* refusalOf('soniox')).toEqual({ credential: { apiKey: 'soniox-second' } });
    }),
  );

  it.effect('removing the default key hands the default to the one key left, and to nobody when none is left', () =>
    Effect.gen(function* () {
      const signIns = yield* SignIns;
      const first = yield* signIns.saveConsoleKey('elevenlabs', 'eleven-first');
      const second = yield* signIns.saveConsoleKey('elevenlabs', 'eleven-second');
      yield* (yield* DefaultAccounts).saveDefaultAccount('elevenlabs', AccountKey.make(second.account));
      yield* signIns.removeConsoleKey('elevenlabs', second.account);
      expect(yield* refusalOf('elevenlabs')).toEqual({ credential: { apiKey: 'eleven-first' } });
      const listed = (yield* signIns.consoleKeys()).find((entry) => entry.provider === 'elevenlabs');
      expect(listed?.keys.map((key) => [key.account, key.default])).toEqual([[first.account, true]]);
      yield* signIns.removeConsoleKey('elevenlabs', first.account);
      expect([(yield* (yield* DefaultAccounts).defaultAccount('elevenlabs')).account, yield* refusalOf('elevenlabs')]).toEqual([
        null,
        { code: 'no-key', retryable: false, unblocked: true },
      ]);
    }),
  );

  it.effect('the console-key door keeps a speech key apart from the model accounts and refuses a provider it does not know', () =>
    Effect.gen(function* () {
      const signIns = yield* SignIns;
      yield* Effect.acquireRelease(signIns.saveConsoleKey('soniox', 'soniox-third'), (key) =>
        signIns.removeConsoleKey('soniox', key.account).pipe(Effect.orDie),
      );
      const accounts = yield* (yield* AccountQuota).table();
      expect(accounts.filter((row) => String(row.provider) === 'soniox')).toEqual([]);
      const unknown = yield* Effect.flip(signIns.saveConsoleKey('nobody', 'key'));
      expect(unknown._tag === 'GateRefusal' ? unknown.code : unknown._tag).toBe('unknown-provider');
    }),
  );
});
