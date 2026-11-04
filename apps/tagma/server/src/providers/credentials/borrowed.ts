import type { AccountKey } from '@runlith/llm/models/authStatus';
import type { AccountRow, HeldAccount, StoredCredential } from '@runlith/llm/oauth/credential';
import type { TokenStore } from '@runlith/llm/oauth/FileTokenStore';
import { TokenStoreFailed, type TokenStoreFault } from '@runlith/llm/oauth/storeFailure';
import type { BorrowedAccounts, CliHarnessProvider } from '@runlith/tagma/adapter/provider';
import { VENDOR_CALL_TIMEOUT_MS } from '@runlith/llm/vendorCall';
import { Deferred, Effect } from 'effect';
import { directoryOrigin, type HarnessDirectoryStore } from '../accounts/harnessRows.js';
import { DEFAULT_LOGIN, type DefaultLoginBook } from '../accounts/defaultLogins.js';
import type { AccountCli } from '../contract/service/cli.js';
import type { ProviderCatalog } from '../contract/service/registry.js';
import { requestedAccount, type DirectoryAccount } from '../contract/wire/harnessAccounts.js';

const RENEW_BEFORE_MS = 5 * 60_000;

type Lending = { readonly borrows: BorrowedAccounts; readonly lender: CliHarnessProvider };

type Borrowed = { readonly lending: Lending; readonly row: DirectoryAccount };

const rowOf = (row: DirectoryAccount, credential: StoredCredential): AccountRow => ({
  key: row.key,
  label: row.label,
  origin: directoryOrigin(row),
  addedAt: row.addedAt,
  credential,
});

export const makeBorrowingTokens = (input: {
  readonly own: TokenStore;
  readonly catalog: () => ProviderCatalog;
  readonly directories: HarnessDirectoryStore;
  readonly cli: AccountCli['Service'];
  readonly now?: () => number;
  readonly options?: { readonly renew: true; readonly logins: DefaultLoginBook };
}): TokenStore => {
  const { own, catalog, directories, cli } = input;
  const now = input.now ?? Date.now;
  const options = input.options;
  const renewals = new Map<string, Deferred.Deferred<void, TokenStoreFailed>>();

  const lending = (provider: string): Lending | null => {
    const { wires, harnesses } = catalog();
    if (!wires.registered(provider)) return null;
    const registration = wires.named(provider);
    const borrows = registration.borrows;
    if (borrows === undefined || (registration.accountMode !== undefined && catalog().accountSource(provider) === provider)) return null;
    const lender = harnesses.find(
      (candidate): candidate is CliHarnessProvider =>
        candidate.id === borrows.provider && candidate.auth === 'cli' && candidate.accounts !== undefined,
    );
    return lender === undefined ? null : { borrows, lender };
  };

  const lent = (provider: string): Effect.Effect<readonly DirectoryAccount[], TokenStoreFault> => {
    const lender = lending(provider);
    if (lender === null) return Effect.succeed([]);
    return Effect.map(directories.of(lender.lender.id), (rows) => rows.filter((row) => row.signed && requestedAccount(row)));
  };

  const borrowedRows = Effect.fn('BorrowingTokens.rows')(function* (provider: string, account?: AccountKey) {
    const lender = lending(provider);
    if (lender === null) return [];
    let rows = yield* lent(provider);
    const discover = account === undefined ? rows.length === 0 : account === DEFAULT_LOGIN && !rows.some((row) => row.key === account);
    if (options?.renew === true && discover) {
      const current = yield* options.logins.current(lender.lender).pipe(
        Effect.mapError(
          (cause) =>
            new TokenStoreFailed({
              kind: 'read',
              provider,
              account,
              reason: cause.message,
            }),
        ),
      );
      rows = [...rows.filter((row) => row.directory !== null), ...(current?.signed === true ? [current] : [])];
    }
    return rows.map((row) => ({ lending: lender, row }));
  });

  const borrowedOf = (provider: string, account: AccountKey): Effect.Effect<Borrowed | null, TokenStoreFault> =>
    Effect.map(borrowedRows(provider, account), (rows) => rows.find(({ row }) => row.key === account) ?? null);

  const unheld = (provider: string, account: AccountKey, mode: string | undefined): TokenStoreFailed =>
    new TokenStoreFailed({
      kind: 'missing',
      provider,
      account,
      reason: `${provider} holds no account ${account} in its selected ${mode ?? 'own'} sign-in mode`,
    });

  const borrowedOnly = (provider: string, account: AccountKey): Effect.Effect<Borrowed | null, TokenStoreFault> => {
    const lender = lending(provider);
    if (lender === null) return Effect.succeed(null);
    return Effect.flatMap(borrowedOf(provider, account), (borrowed) =>
      borrowed === null ? Effect.fail(unheld(provider, account, lender.lender.accountMode?.label)) : Effect.succeed(borrowed),
    );
  };

  const owned = <A>(provider: string, account: AccountKey, work: Effect.Effect<A, TokenStoreFault>): Effect.Effect<A, TokenStoreFault> => {
    const { wires } = catalog();
    const mode = wires.registered(provider) ? wires.named(provider).accountMode : undefined;
    if (mode === undefined) return work;
    return Effect.mapError(work, (failure) =>
      failure instanceof TokenStoreFailed && failure.kind === 'missing' ? unheld(provider, account, mode.label) : failure,
    );
  };

  const ownOnly = (provider: string, account: AccountKey): Effect.Effect<void, TokenStoreFault> =>
    Effect.flatMap(borrowedOnly(provider, account), (borrowed) =>
      borrowed === null
        ? Effect.void
        : Effect.fail(
            new TokenStoreFailed({
              kind: 'origin',
              provider,
              account,
              reason: `${provider} account ${account} is borrowed from ${borrowed.lending.lender.label}; manage it there`,
            }),
          ),
    );

  const readLent = (provider: string, { lending: lender, row }: Borrowed): Effect.Effect<StoredCredential | null, TokenStoreFailed> =>
    lender.borrows
      .read(row.directory)
      .pipe(Effect.mapError((cause) => new TokenStoreFailed({ kind: 'read', provider, account: row.key, reason: cause.message })));

  const reconnect = (provider: string, { lending: lender, row }: Borrowed, why: string): Effect.Effect<never, TokenStoreFailed> =>
    Effect.fail(
      new TokenStoreFailed({
        kind: 'reconnect',
        provider,
        account: row.key,
        reason: `Borrowed ${provider} account ${row.key} must sign in again with ${lender.lender.label} because ${why}`,
      }),
    );

  const signedIn = (provider: string, borrowed: Borrowed): Effect.Effect<StoredCredential, TokenStoreFailed> =>
    Effect.flatMap(readLent(provider, borrowed), (credential) =>
      credential === null
        ? reconnect(provider, borrowed, borrowed.lending.borrows.missing ?? `${borrowed.lending.lender.label} holds no sign-in for it`)
        : Effect.succeed(credential),
    );

  const expiring = (credential: StoredCredential): boolean =>
    credential.expiresAt !== null && credential.expiresAt - now() <= RENEW_BEFORE_MS;

  const renewal = Effect.fn('BorrowingTokens.renewal')(function* (provider: string, borrowed: Borrowed, stale: string) {
    const { lending: lender, row } = borrowed;
    const renew = lender.lender.accounts?.renew;
    if (renew === undefined) return yield* reconnect(provider, borrowed, `${lender.lender.label} declares no renewal`);
    const failed = (reason: string) => new TokenStoreFailed({ kind: 'refresh', provider, account: row.key, reason });
    const current = yield* readLent(provider, borrowed);
    if (current === null)
      return yield* reconnect(provider, borrowed, lender.borrows.missing ?? `${lender.lender.label} holds no readable sign-in for it`);
    if (current.accessToken !== stale && !expiring(current)) return;
    const output = yield* cli
      .run({
        ...renew,
        entries: lender.lender.environment(row.directory),
        cwd: row.directory ?? undefined,
        timeoutMs: VENDOR_CALL_TIMEOUT_MS,
      })
      .pipe(Effect.mapError((refusal) => failed(refusal.message)));
    if (output.code !== 0)
      return yield* failed(
        `${renew.program} ${renew.args.join(' ')} exited ${output.code}: ${output.stderr.trim() || output.stdout.trim()}`,
      );
  });

  const renew = (provider: string, borrowed: Borrowed, stale: string): Effect.Effect<void, TokenStoreFailed> =>
    Effect.uninterruptibleMask((restore) =>
      Effect.suspend(() => {
        const key = `${borrowed.lending.lender.id}/${borrowed.row.key}`;
        const standing = renewals.get(key);
        if (standing !== undefined) return restore(Deferred.await(standing));
        const done = Deferred.makeUnsafe<void, TokenStoreFailed>();
        renewals.set(key, done);
        const running = renewal(provider, borrowed, stale).pipe(
          Effect.timeoutOrElse({
            duration: VENDOR_CALL_TIMEOUT_MS,
            orElse: () =>
              Effect.fail(
                new TokenStoreFailed({
                  kind: 'refresh',
                  provider,
                  account: borrowed.row.key,
                  reason: 'The account renewal exceeded the provider request deadline.',
                }),
              ),
          }),
          Effect.onExit((exit) =>
            Effect.andThen(
              Deferred.done(done, exit),
              Effect.sync(() => renewals.delete(key)),
            ),
          ),
        );
        return Effect.andThen(Effect.forkDetach(running), restore(Deferred.await(done)));
      }),
    );

  const heldProviders = Effect.fnUntraced(function* () {
    const active = new Set(yield* own.heldProviders());
    for (const provider of catalog().wires.providers) {
      if (lending(provider.id) === null) continue;
      active.delete(provider.id);
      if ((yield* lent(provider.id)).length > 0) active.add(provider.id);
    }
    return [...active];
  });

  const held = Effect.fnUntraced(function* (provider: string) {
    if (lending(provider) === null) return yield* own.held(provider);
    const rows = yield* borrowedRows(provider);
    const borrowed = yield* Effect.forEach(
      rows,
      (row) =>
        Effect.map(Effect.result(readLent(provider, row)), (read): HeldAccount => ({
          key: row.row.key,
          label: row.row.label,
          origin: directoryOrigin(row.row),
          addedAt: row.row.addedAt,
          credential: read._tag === 'Success' ? read.success : null,
          unreadable:
            read._tag === 'Failure'
              ? read.failure.reason
              : read.success === null
                ? (row.lending.borrows.missing ?? `${row.lending.lender.label} holds no sign-in for this account`)
                : null,
        })),
      { concurrency: 'unbounded' },
    );
    const { wires } = catalog();
    const accounts = wires.registered(provider) ? wires.named(provider).accounts : undefined;
    const identities = new Map<string, { row: HeldAccount; aliases: AccountKey[] }>();
    for (const row of borrowed) {
      const identity = row.credential === null ? row.key : (accounts?.key(row.credential) ?? row.key);
      const existing = identities.get(identity);
      if (existing === undefined) identities.set(identity, { row, aliases: [] });
      else existing.aliases.push(row.key);
    }
    return Array.from(identities.values(), ({ row, aliases }) => (aliases.length === 0 ? row : { ...row, aliases }));
  });

  const accounts = (provider: string): Effect.Effect<ReadonlyArray<AccountRow>, TokenStoreFault> => {
    if (lending(provider) === null) return own.accounts(provider);
    return Effect.map(held(provider), (rows) =>
      rows.flatMap((row) => (row.credential === null ? [] : [{ ...row, credential: row.credential }])),
    );
  };

  const get = Effect.fnUntraced(function* (provider: string, account: AccountKey) {
    if (lending(provider) === null) return yield* own.get(provider, account);
    const borrowed = yield* borrowedOf(provider, account);
    if (borrowed === null) return null;
    const credential = yield* readLent(provider, borrowed);
    if (credential === null) return null;
    return rowOf(borrowed.row, credential);
  });

  const find = Effect.fnUntraced(function* (provider: string, credential: StoredCredential) {
    if (lending(provider) === null) return yield* own.find(provider, credential);
    const { wires } = catalog();
    const schemes = wires.registered(provider) ? wires.named(provider).accounts : undefined;
    if (schemes === undefined) return null;
    const identity = schemes.key(credential);
    let unreadable: TokenStoreFailed | undefined;
    for (const borrowed of yield* borrowedRows(provider)) {
      const read = yield* Effect.result(readLent(provider, borrowed));
      if (read._tag === 'Failure') {
        unreadable ??= read.failure;
        continue;
      }
      const lentCredential = read.success;
      if (lentCredential !== null && schemes.key(lentCredential) === identity) return rowOf(borrowed.row, lentCredential);
    }
    if (unreadable !== undefined) return yield* unreadable;
    return null;
  });

  const getAccessToken = Effect.fnUntraced(function* (provider: string, account: AccountKey) {
    const borrowed = yield* borrowedOnly(provider, account);
    if (borrowed === null) return yield* owned(provider, account, own.getAccessToken(provider, account));
    const credential = yield* signedIn(provider, borrowed);
    if (options?.renew !== true) {
      if (credential.expiresAt !== null && credential.expiresAt <= now())
        return yield* new TokenStoreFailed({
          kind: 'reconnect',
          provider,
          account: borrowed.row.key,
          reason: `Borrowed ${provider} account ${borrowed.row.key} needs ${borrowed.lending.lender.label} to refresh its expired sign-in`,
        });
      return credential.accessToken;
    }
    if (!expiring(credential)) return credential.accessToken;
    yield* renew(provider, borrowed, credential.accessToken);
    const renewed = yield* signedIn(provider, borrowed);
    if (expiring(renewed)) return yield* reconnect(provider, borrowed, 'its renewal left the sign-in expired');
    return renewed.accessToken;
  });

  const recoverAccessToken = Effect.fnUntraced(function* (provider: string, account: AccountKey, rejected: string) {
    const borrowed = yield* borrowedOnly(provider, account);
    if (borrowed === null) return yield* owned(provider, account, own.recoverAccessToken(provider, account, rejected));
    const reread = yield* signedIn(provider, borrowed);
    if (reread.accessToken !== rejected) return reread.accessToken;
    if (options?.renew !== true || borrowed.lending.borrows.renewOnReject !== true)
      return yield* reconnect(provider, borrowed, 'its current sign-in was rejected');
    yield* renew(provider, borrowed, rejected);
    const renewed = yield* signedIn(provider, borrowed);
    if (renewed.accessToken === rejected) return yield* reconnect(provider, borrowed, 'its renewal kept the rejected sign-in');
    if (expiring(renewed)) return yield* reconnect(provider, borrowed, 'its renewal left the sign-in expired');
    return renewed.accessToken;
  });

  return {
    keeps: (provider) => own.keeps(provider),
    heldProviders,
    held,
    accounts,
    get,
    find,
    owns: (provider, account) => (lending(provider) === null ? own.owns(provider, account) : Effect.succeed(false)),
    add: (provider, credential) => own.add(provider, credential),
    remove: (provider, account) => Effect.flatMap(ownOnly(provider, account), () => own.remove(provider, account)),
    relabel: (provider, account, label) => Effect.flatMap(ownOnly(provider, account), () => own.relabel(provider, account, label)),
    getAccessToken,
    recoverAccessToken,
  };
};

export type BorrowingTokens = TokenStore;
