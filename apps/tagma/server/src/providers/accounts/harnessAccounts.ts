import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { AccountKey } from '@runlith/llm/models/authStatus';
import type { CredentialFileFault } from '@runlith/credential-file/failure';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import type { CliHarnessProvider } from '@runlith/tagma/adapter/provider';
import { Clock, Effect, Fiber, PubSub, Semaphore, Stream } from 'effect';
import { AccountCli } from '../contract/service/cli.js';
import { AccountQuota } from '../contract/service/quota.js';
import { DefaultAccounts } from '../contract/service/accounts.js';
import { ProviderRegistry } from '../contract/service/registry.js';
import { ProviderCredentials } from '../contract/service/credentials.js';
import type { AccountStatus } from '../contract/wire/signIns.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { credentialRefusal } from '../credentials/refusal.js';
import { chooseAccount } from './choice.js';
import { DEFAULT_LOGIN, DefaultLogins } from './defaultLogins.js';
import { HarnessDirectories } from './harnessRows.js';
import { requestedAccount, type DirectoryAccount, type DirectoryLogin } from '../contract/wire/harnessAccounts.js';

const unavailable = (provider: string) =>
  new GateRefusal('account-kind', `${provider} has no directory accounts.`, ['choose a provider that declares external CLI sign-in']);

export const makeHarnessAccountBook = Effect.gen(function* () {
  const rows = yield* HarnessDirectories;
  const { tokens } = yield* ProviderCredentials;
  const registry = yield* ProviderRegistry;
  const defaults = yield* DefaultAccounts;
  const cli = yield* AccountCli;
  const logins = yield* DefaultLogins;
  const quota = yield* AccountQuota;
  const scope = yield* Effect.scope;
  const signed = yield* Effect.acquireRelease(PubSub.unbounded<string>(), PubSub.shutdown);
  const gate = yield* Semaphore.make(1);
  const exclusive = gate.withPermits(1);

  const declared = (provider: string) =>
    Effect.flatMap(registry.callable(provider), (registration) =>
      registration.kind === 'harness' && registration.auth === 'cli' && registration.accounts !== undefined
        ? Effect.succeed(registration)
        : Effect.fail(unavailable(provider)),
    );

  const stored = (provider: string) => Effect.mapError(rows.of(provider), (cause) => credentialRefusal('read directory accounts', cause));

  const identity = Effect.fnUntraced(function* (registration: CliHarnessProvider, directory: string | null) {
    const auth = registration.accounts;
    if (auth === undefined) return yield* unavailable(registration.id);
    const output = yield* cli.run({
      ...auth.status,
      entries: registration.environment(directory),
      timeoutMs: null,
      located: auth.discovery !== undefined,
    });
    const status = yield* auth.loggedIn(output);
    if (status.kind === 'signed-in') return { label: status.label };
    if (status.kind === 'signed-out') return null;
    return yield* new GateRefusal(
      'login-unreadable',
      status.kind === 'unreadable' ? status.reason : `The CLI uses the unsupported ${status.method} sign-in method.`,
      ['sign in with a subscription'],
    );
  });

  const status = Effect.fnUntraced(function* (provider: string) {
    const { account } = yield* defaults.defaultAccount(provider);
    return (yield* stored(provider))
      .filter((row) => requestedAccount(row) && (row.signed || row.pending || row.failed === true))
      .map((row): AccountStatus => ({
        provider,
        account: row.key,
        label: row.label,
        expiresAt: null,
        addedAt: row.addedAt,
        origin: { kind: 'cli', place: row.directory ?? 'default' },
        default: row.key === account,
        pending: row.pending,
        failed: row.failed,
      }));
  });

  const named = (provider: string, account: string) =>
    Effect.flatMap(stored(provider), (held) => {
      const row = held.find((candidate) => candidate.key === account);
      return row === undefined
        ? Effect.fail(
            new GateRefusal('unknown-account', `${provider} has no directory account ${account}.`, ['read its directory accounts']),
          )
        : Effect.succeed(row);
    });

  const finish = Effect.fnUntraced(function* (provider: string, key: AccountKey, label: string) {
    yield* rows
      .change(provider, key, (current) => ({
        ...current,
        signed: true,
        pending: false,
        failed: false,
        label,
        login: undefined,
        problem: null,
      }))
      .pipe(Effect.mapError((cause) => (cause instanceof GateRefusal ? cause : credentialRefusal('finish the CLI account', cause))));
    const previous = yield* defaults.defaultAccount(provider);
    yield* defaults.adoptDefaultAccount(provider, key).pipe(Effect.mapError((cause) => credentialRefusal('adopt the CLI account', cause)));
    if (previous.account === key) yield* PubSub.publish(signed, provider);
    return (yield* status(provider)).find((candidate) => candidate.account === key)!;
  });

  const currentAttempt = (provider: string, key: AccountKey, login: DirectoryLogin | undefined) =>
    Effect.map(stored(provider), (held) =>
      held.find(
        (row) =>
          row.key === key &&
          row.pending &&
          (login === undefined ? row.login === undefined : row.login !== undefined && sameExecution(row.login.execution, login.execution)),
      ),
    );

  const endCancelled = Effect.fnUntraced(function* (provider: string, key: AccountKey, login: DirectoryLogin) {
    const row = yield* currentAttempt(provider, key, login);
    if (row?.login?.cancelled !== true) return false;
    const ending: Effect.Effect<void, GateRefusal | CredentialFileFault> = login.added
      ? rows.remove(provider, key)
      : Effect.asVoid(rows.change(provider, key, (current) => ({ ...current, pending: false, failed: false, login: undefined })));
    yield* ending.pipe(
      Effect.mapError((cause) => (cause instanceof GateRefusal ? cause : credentialRefusal('cancel the CLI sign-in', cause))),
    );
    return true;
  });

  const stopCancelled = Effect.fn('HarnessAccountBook.stopCancelled')(function* (provider: string, key: AccountKey, login: DirectoryLogin) {
    yield* cli.stop(login.execution, login.projectId);
    if (yield* exclusive(endCancelled(provider, key, login))) yield* quota.refresh(provider);
  });

  const settle = Effect.fnUntraced(function* (provider: string, key: AccountKey, login: DirectoryLogin) {
    yield* cli.ended(login.execution, login.projectId);
    const row = yield* exclusive(currentAttempt(provider, key, login));
    if (row === undefined) return;
    if (row.login?.cancelled === true) return;
    const read = yield* Effect.result(Effect.flatMap(declared(provider), (registration) => identity(registration, row.directory)));
    const changed = yield* exclusive(
      Effect.gen(function* () {
        const standing = yield* currentAttempt(provider, key, login);
        if (standing === undefined || standing.login?.cancelled === true) return false;
        if (read._tag === 'Success' && read.success !== null) {
          yield* finish(provider, key, read.success.label);
          return true;
        }
        if (read._tag === 'Failure')
          yield* Effect.logWarning('the CLI sign-in ended unreadable', { provider, reason: read.failure.message });
        const provenOut = read._tag === 'Success';
        const ending: Effect.Effect<void, GateRefusal | CredentialFileFault> = login.added
          ? rows.remove(provider, key)
          : Effect.asVoid(
              rows.change(provider, key, (current) => ({
                ...current,
                signed: provenOut ? false : current.signed,
                pending: false,
                failed: true,
                login: undefined,
              })),
            );
        yield* ending.pipe(
          Effect.mapError((cause) => (cause instanceof GateRefusal ? cause : credentialRefusal('end the CLI sign-in', cause))),
        );
        return true;
      }),
    );
    if (changed) yield* quota.refresh(provider);
  });

  const cancel = Effect.fn('HarnessAccountBook.cancel')(function* (provider: string, account: string, execution: ExecutionRef) {
    const key = AccountKey.make(account);
    const stopping = yield* exclusive(
      Effect.uninterruptible(
        Effect.gen(function* () {
          const row = (yield* stored(provider)).find((candidate) => candidate.key === key && candidate.pending);
          if (row?.login === undefined || !sameExecution(row.login.execution, execution))
            return yield* new GateRefusal('no-sign-in', 'This CLI sign-in attempt is no longer current.', [
              'read the sign-in status before cancelling another attempt',
            ]);
          const login: DirectoryLogin = { ...row.login, cancelled: true };
          yield* rows
            .change(provider, key, (current) => ({ ...current, login }))
            .pipe(
              Effect.mapError((cause) =>
                cause instanceof GateRefusal ? cause : credentialRefusal('record the CLI sign-in cancellation', cause),
              ),
            );
          return yield* Effect.forkIn(Effect.interruptible(stopCancelled(provider, key, login)), scope);
        }),
      ),
    );
    yield* Fiber.join(stopping);
  });

  const watched = new Set<string>();
  const watch = Effect.fnUntraced(function* (provider: string, key: AccountKey, login: DirectoryLogin) {
    const execution = `${login.execution.installation}/${login.execution.execution}/${login.execution.incarnation}`;
    if (watched.has(execution)) return;
    watched.add(execution);
    yield* Effect.forkIn(
      (login.cancelled === true ? stopCancelled(provider, key, login) : settle(provider, key, login)).pipe(
        Effect.tapCause((cause) => Effect.logWarning('a CLI sign-in could not settle after its login terminal ended', { provider, cause })),
        Effect.ensuring(Effect.sync(() => watched.delete(execution))),
      ),
      scope,
    );
  });

  const resume = Effect.fn('HarnessAccountBook.resume')(function* () {
    for (const { provider, row } of yield* rows
      .pending()
      .pipe(Effect.mapError((cause) => credentialRefusal('resume CLI sign-ins', cause)))) {
      yield* watch(provider, row.key, row.login!);
    }
  });
  yield* Effect.forkIn(
    resume().pipe(Effect.tapCause((cause) => Effect.logWarning('pending CLI sign-ins could not resume their terminal watches', { cause }))),
    scope,
  );

  const begin = Effect.fn('HarnessAccountBook.begin')(
    function* (provider: string, projectId?: number, selected?: string) {
      const registration = yield* declared(provider);
      const auth = registration.accounts!;
      let existing = selected === undefined ? null : yield* named(provider, selected);
      if (selected === undefined && auth.discovery !== undefined) {
        const held = yield* stored(provider);
        if (!held.some((row) => row.pending) && (projectId === undefined || !held.some((row) => row.signed && row.problem == null))) {
          const current = yield* logins.current(registration);
          if (current?.signed && current.problem == null) {
            const adopted = yield* finish(provider, current.key, current.label);
            yield* quota.refresh(provider);
            return { flow: 'adopted' as const, provider, account: adopted.account, label: adopted.label };
          }
          if (current?.problem?.kind !== 'unsupported-method') existing = current;
        }
      }
      if (projectId === undefined)
        return yield* new GateRefusal('project-required', 'A login terminal needs the project it is opened in.', [
          'begin sign-in from a project',
        ]);
      const key = existing?.key ?? AccountKey.make(crypto.randomUUID());
      const directory = existing === null ? join(rows.home, auth.directory, key) : existing.directory;
      if (directory !== null)
        yield* Effect.tryPromise({
          try: () => mkdir(directory, { recursive: true, mode: 0o700 }),
          catch: (cause) => credentialRefusal('create the account directory', cause),
        });
      const row: DirectoryAccount =
        existing === null
          ? {
              key,
              label: registration.label,
              machine: rows.machine,
              directory,
              addedAt: yield* Clock.currentTimeMillis,
              signed: false,
              pending: true,
              requested: true,
              failed: false,
            }
          : { ...existing, pending: true, requested: true, failed: false, problem: null };
      const writing: Effect.Effect<void, GateRefusal | CredentialFileFault> =
        existing === null
          ? rows.keep(provider, row)
          : Effect.asVoid(
              rows.change(provider, key, (current) => ({ ...current, pending: true, requested: true, failed: false, problem: null })),
            );
      yield* exclusive(
        Effect.gen(function* () {
          if (existing !== null && (yield* named(provider, key)).pending)
            return yield* new GateRefusal('sign-in-failed', 'This account already has a CLI sign-in attempt.', [
              'finish or cancel its current attempt first',
            ]);
          yield* writing.pipe(
            Effect.mapError((cause) => (cause instanceof GateRefusal ? cause : credentialRefusal('keep the new account directory', cause))),
          );
        }),
      );
      const started = yield* Effect.result(cli.login({ ...auth.login, entries: registration.environment(directory) }, projectId));
      if (started._tag === 'Failure') {
        if (started.failure.code === 'account-cli-uncertain')
          return yield* new GateRefusal(
            'account-cli-uncertain',
            `${started.failure.reason} Pending account: ${key}.`,
            started.failure.unblock,
          );
        yield* exclusive(
          Effect.gen(function* () {
            if (existing === null)
              yield* rows.remove(provider, key).pipe(Effect.mapError((cause) => credentialRefusal('remove the failed sign-in', cause)));
            else
              yield* rows
                .change(provider, key, (current) => ({ ...current, pending: existing.pending, failed: existing.failed }))
                .pipe(
                  Effect.mapError((cause) => (cause instanceof GateRefusal ? cause : credentialRefusal('end the failed sign-in', cause))),
                );
          }),
        );
        return yield* Effect.fail(started.failure);
      }
      const login: DirectoryLogin = { execution: started.success, projectId, added: existing === null };
      const recorded = yield* Effect.result(
        exclusive(
          rows
            .change(provider, key, (current) => ({ ...current, login }))
            .pipe(
              Effect.mapError((cause) => (cause instanceof GateRefusal ? cause : credentialRefusal('keep the CLI login execution', cause))),
            ),
        ),
      );
      if (recorded._tag === 'Failure') {
        yield* cli.stop(started.success, projectId);
        return yield* recorded.failure;
      }
      yield* watch(provider, key, login);
      return { flow: 'external-cli' as const, provider, account: key, execution: started.success };
    },
    Effect.mapError((cause) => (cause instanceof GateRefusal ? cause : credentialRefusal('begin the CLI sign-in', cause))),
  );

  const complete = Effect.fnUntraced(function* (provider: string, selected?: string) {
    const registration = yield* declared(provider);
    const pending = yield* exclusive(Effect.map(stored(provider), (held) => held.filter((candidate) => candidate.pending)));
    if (selected === undefined && pending.length > 1)
      return yield* new GateRefusal('account-required', `Several CLI sign-ins are pending for ${provider}.`, [
        'name the account returned by begin sign-in',
      ]);
    const row = pending.find((candidate) => selected === undefined || candidate.key === selected);
    if (row === undefined)
      return yield* new GateRefusal('no-sign-in', `No CLI sign-in is pending for ${provider}.`, ['begin a CLI sign-in']);
    if (row.login?.cancelled === true)
      return yield* new GateRefusal('no-sign-in', 'This CLI sign-in attempt was cancelled.', ['read the sign-in status']);
    const login = yield* identity(registration, row.directory);
    const answered = yield* exclusive(
      Effect.gen(function* () {
        const standing = yield* named(provider, row.key);
        if (
          !standing.pending ||
          standing.login?.cancelled === true ||
          (row.login === undefined
            ? standing.login !== undefined
            : standing.login === undefined || !sameExecution(standing.login.execution, row.login.execution))
        )
          return yield* new GateRefusal('no-sign-in', 'This CLI sign-in attempt ended or was cancelled.', ['read the sign-in status']);
        if (login === null) return { pending: true as const, message: 'Finish sign-in in the CLI terminal.' };
        return yield* finish(provider, row.key, login.label);
      }),
    );
    if (!('message' in answered)) yield* quota.refresh(provider);
    return answered;
  });

  const rename = Effect.fnUntraced(function* (provider: string, account: string, label: string) {
    const row = yield* named(provider, account);
    yield* rows
      .change(provider, row.key, (current) => ({ ...current, label }))
      .pipe(Effect.mapError((cause) => (cause instanceof GateRefusal ? cause : credentialRefusal('rename the CLI account', cause))));
    yield* quota.refresh(provider);
    return (yield* status(provider)).find((candidate) => candidate.account === row.key)!;
  });

  const remove = Effect.fnUntraced(function* (provider: string, account: string) {
    const removed = yield* exclusive(
      Effect.gen(function* () {
        const row = yield* named(provider, account);
        const standing = yield* defaults.forgetAccount(provider, row.key);
        yield* rows.remove(provider, row.key).pipe(Effect.mapError((cause) => credentialRefusal('remove the CLI account', cause)));
        return { provider, removed: row.key, default: standing.account };
      }),
    );
    yield* quota.refresh(provider);
    return removed;
  });

  const launch = Effect.fnUntraced(function* (provider: string, selected?: string) {
    const registration = yield* registry.callable(provider);
    if (registration.kind !== 'harness' || registration.accounts === undefined) return null;
    if (registration.auth === 'api-key') {
      const fallback = yield* defaults.defaultAccount(provider);
      const held = yield* tokens.accounts(provider).pipe(Effect.mapError((cause) => credentialRefusal('read the harness keys', cause)));
      const choice = chooseAccount(
        selected === undefined ? fallback.account : AccountKey.make(selected),
        held.map((row) => row.key),
      );
      if (choice.kind !== 'chosen')
        return yield* new GateRefusal('account-required', `Choose a signed-in account for ${provider}.`, ['sign in or select an account']);
      const row = held.find((candidate) => candidate.key === choice.account);
      if (row === undefined)
        return yield* new GateRefusal('unknown-account', `${provider} has no account ${choice.account}.`, ['sign in or select an account']);
      if (row.credential.expiresAt !== null && row.credential.expiresAt <= (yield* Clock.currentTimeMillis))
        return yield* new GateRefusal('credential-reconnect', `The ${provider} key expired. Sign in again.`, ['sign in again']);
      return { account: row.key, directory: null, entries: registration.environment(row.credential) };
    }
    const fallback = yield* defaults.defaultAccount(provider);
    const wanted = selected === undefined ? fallback.account : AccountKey.make(selected);
    const held = (yield* stored(provider)).filter(requestedAccount);
    const named = held.find((row) => row.key === wanted);
    const leans =
      wanted === null
        ? !held.some((row) => row.signed)
        : named === undefined
          ? wanted === DEFAULT_LOGIN
          : named.directory === null && !named.signed;
    const read = leans ? yield* logins.current(registration) : undefined;
    const signed = (read === undefined ? held : [...held.filter((row) => row.directory !== null), ...(read === null ? [] : [read])]).filter(
      (row) => row.signed && row.problem == null,
    );
    const choice =
      wanted === null
        ? chooseAccount(
            null,
            signed.map((row) => row.key),
          )
        : { kind: 'chosen' as const, account: wanted };
    if (choice.kind !== 'chosen')
      return yield* new GateRefusal('account-required', `Choose a signed-in directory account for ${provider}.`, [
        'sign in to the CLI, or select an account',
      ]);
    const row = signed.find((candidate) => candidate.key === choice.account);
    if (row === undefined)
      return yield* new GateRefusal('unknown-account', `${provider} has no signed-in directory account ${choice.account}.`, [
        'sign in to the CLI, or select a signed-in account',
      ]);
    return { account: row.key, directory: row.directory, entries: registration.environment(row.directory) };
  });

  const launchable = Effect.fn('HarnessAccounts.launchable')(function* (provider: string, account: string) {
    const registration = yield* registry.callable(provider);
    if (registration.kind !== 'harness' || registration.accounts === undefined) return false;
    if (registration.auth === 'api-key') {
      const held = yield* tokens.accounts(provider).pipe(Effect.mapError((cause) => credentialRefusal('read the harness keys', cause)));
      const row = held.find((candidate) => candidate.key === account);
      return row !== undefined && (row.credential.expiresAt === null || row.credential.expiresAt > (yield* Clock.currentTimeMillis));
    }
    if (account === DEFAULT_LOGIN) return true;
    const named = (yield* stored(provider)).filter(requestedAccount).find((row) => row.key === account);
    return named !== undefined && (named.signed || named.directory === null);
  });

  return {
    stored,
    defaultSignedIn: Stream.fromPubSub(signed),
    owns: (provider: string, account: string) => Effect.map(stored(provider), (held) => held.some((row) => row.key === account)),
    launchable,
    status,
    begin,
    complete,
    cancel,
    rename,
    remove,
    launch,
  };
});

const sameExecution = (a: ExecutionRef, b: ExecutionRef): boolean =>
  a.installation === b.installation && a.execution === b.execution && a.incarnation === b.incarnation;

export type HarnessAccountBook = Effect.Success<typeof makeHarnessAccountBook>;
