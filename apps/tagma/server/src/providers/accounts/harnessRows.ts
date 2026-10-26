import { hostname } from 'node:os';
import { makeCredentialFile } from '@runlith/credential-file/CredentialFile';
import { CredentialFileInvalid, type CredentialFileFault } from '@runlith/credential-file/failure';
import type { AccountKey } from '@runlith/llm/models/authStatus';
import { DirectoryAccount, requestedAccount } from '../contract/wire/harnessAccounts.js';
import { Context, Effect, Layer, Schema } from 'effect';
import { dirname, join } from 'node:path';
import { CredentialFiles } from '../contract/service/credentials.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';

const Document = Schema.Record(Schema.String, Schema.Array(DirectoryAccount));
const accountsOf = (document: typeof Document.Type, provider: string): readonly DirectoryAccount[] =>
  Object.hasOwn(document, provider) ? (document[provider] ?? []) : [];

export const makeHarnessDirectoryStore = (input: { readonly home: string; readonly machine: string }) => {
  const { home, machine } = input;

  const file = makeCredentialFile({
    path: join(home, 'harness-accounts.json'),
    codec: {
      empty: (): typeof Document.Type => ({}),
      decode: (path, parsed) =>
        Schema.decodeUnknownEffect(Document)(parsed).pipe(
          Effect.map((value) => ({ value, needsWrite: false })),
          Effect.mapError((error) => new CredentialFileInvalid({ path, reason: error.message })),
        ),
    },
  });

  const of = (provider: string): Effect.Effect<readonly DirectoryAccount[], CredentialFileFault> => {
    return Effect.map(file.read(), (document) => accountsOf(document, provider).filter((row) => row.machine === machine));
  };
  const keep = (provider: string, row: DirectoryAccount): Effect.Effect<void, CredentialFileFault> => {
    return file.update((document) =>
      Effect.succeed({
        ...document,
        [provider]: [
          ...accountsOf(document, provider).filter((standing) => standing.key !== row.key || standing.machine !== row.machine),
          row,
        ],
      }),
    );
  };
  const change = Effect.fnUntraced(function* (provider: string, key: AccountKey, update: (row: DirectoryAccount) => DirectoryAccount) {
    let saved!: DirectoryAccount;
    yield* file.update(
      Effect.fnUntraced(function* (document) {
        const standing = accountsOf(document, provider);
        const row = standing.find((row) => row.key === key && row.machine === machine);
        if (row === undefined)
          return yield* new GateRefusal('unknown-account', `${provider} no longer holds account ${key}.`, ['read the accounts again']);
        saved = update(row);
        return { ...document, [provider]: standing.map((current) => (current === row ? saved : current)) };
      }),
    );
    return saved;
  });
  const remove = (provider: string, key: AccountKey): Effect.Effect<void, CredentialFileFault> => {
    return file.update((document) =>
      Effect.succeed({
        ...document,
        [provider]: accountsOf(document, provider).filter((row) => row.key !== key || row.machine !== machine),
      }),
    );
  };
  const heldProviders = () =>
    Effect.map(file.read(), (document) =>
      Object.entries(document).flatMap(([provider, rows]) => (rows.some((row) => row.machine === machine) ? [provider] : [])),
    );
  const requestedProviders = () =>
    Effect.map(file.read(), (document) =>
      Object.entries(document).flatMap(([provider, rows]) =>
        rows.some((row) => row.machine === machine && requestedAccount(row)) ? [provider] : [],
      ),
    );
  const pending = () =>
    Effect.map(file.read(), (document) =>
      Object.entries(document).flatMap(([provider, rows]) =>
        rows.filter((row) => row.machine === machine && row.pending && row.login !== undefined).map((row) => ({ provider, row })),
      ),
    );
  return { home, machine, of, keep, change, remove, heldProviders, requestedProviders, pending };
};
export type HarnessDirectoryStore = ReturnType<typeof makeHarnessDirectoryStore>;

export class HarnessDirectories extends Context.Service<HarnessDirectories, HarnessDirectoryStore>()(
  'tagma/providers/HarnessDirectories',
) {}

export const harnessDirectoriesLayer = Layer.effect(
  HarnessDirectories,
  Effect.map(CredentialFiles, ({ tokensPath }) => makeHarnessDirectoryStore({ home: dirname(tokensPath), machine: hostname() })),
);
