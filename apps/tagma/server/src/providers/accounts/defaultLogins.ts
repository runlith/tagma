import { AccountKey } from '@runlith/llm/models/authStatus';
import type { CliHarnessProvider } from '@runlith/tagma/adapter/provider';
import { Clock, Context, Effect, Layer } from 'effect';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { AccountCli } from '../contract/service/cli.js';
import type { DirectoryAccount } from '../contract/wire/harnessAccounts.js';
import { credentialRefusal } from '../credentials/refusal.js';
import { HarnessDirectories, type HarnessDirectoryStore } from './harnessRows.js';

export const DEFAULT_LOGIN = AccountKey.make('default');

//! One status process per half minute bounds what listings cost however often accounts are read; a launch reads anew.
export const LISTED_MS = 30_000;

type Reading = { readonly read: Effect.Effect<DirectoryAccount | null, GateRefusal>; readonly forget: Effect.Effect<void> };

export const makeDefaultLoginBook = (input: { readonly rows: HarnessDirectoryStore; readonly cli: AccountCli['Service'] }) => {
  const { rows, cli } = input;
  const readings = new WeakMap<CliHarnessProvider, Reading>();

  const listed = (registration: CliHarnessProvider): Effect.Effect<DirectoryAccount | null, GateRefusal> => {
    return Effect.flatMap(reading(registration), ({ read }) => read);
  };
  const current = (registration: CliHarnessProvider): Effect.Effect<DirectoryAccount | null, GateRefusal> => {
    return Effect.flatMap(reading(registration), ({ forget }) => carried(registration, true).pipe(Effect.ensuring(forget)));
  };
  const reading = Effect.fnUntraced(function* (registration: CliHarnessProvider) {
    const standing = readings.get(registration);
    if (standing !== undefined) return standing;
    const [read, forget] = yield* Effect.cachedInvalidateWithTTL(carried(registration, false), LISTED_MS);
    const made = readings.get(registration) ?? { read, forget };
    readings.set(registration, made);
    return made;
  });
  const carried = Effect.fnUntraced(
    function* (registration: CliHarnessProvider, requested: boolean) {
      const auth = registration.accounts;
      if (auth === undefined) return null;
      let standing = (yield* rows.of(registration.id)).find((row) => row.directory === null);
      if (!requested && standing?.requested !== true) return null;
      if (standing === undefined) {
        standing = {
          key: DEFAULT_LOGIN,
          label: registration.label,
          machine: rows.machine,
          directory: null,
          addedAt: yield* Clock.currentTimeMillis,
          signed: false,
          pending: false,
          requested: true,
        };
        yield* rows.keep(registration.id, standing);
      } else if (standing.requested !== true) {
        standing = { ...standing, requested: true };
        yield* rows.keep(registration.id, standing);
      }
      const output = yield* cli.run({ ...auth.status, entries: registration.environment(null), timeoutMs: 10_000 });
      const identity = yield* auth
        .loggedIn(output)
        .pipe(
          Effect.mapError((cause) => new GateRefusal('login-unreadable', cause.message, ['check the CLI authentication status and retry'])),
        );
      if (identity === null) {
        if (!standing.signed) return standing;
        return yield* rows.change(registration.id, standing.key, (row) => ({ ...row, signed: false }));
      }
      if (standing.signed && standing.label === identity.label) return standing;
      return yield* rows.change(registration.id, standing.key, (row) => ({ ...row, signed: true, label: identity.label }));
    },
    Effect.mapError((cause) => (cause instanceof GateRefusal ? cause : credentialRefusal('keep the CLI login', cause))),
  );
  return { listed, current };
};
export type DefaultLoginBook = ReturnType<typeof makeDefaultLoginBook>;

export class DefaultLogins extends Context.Service<DefaultLogins, DefaultLoginBook>()('tagma/providers/DefaultLogins') {}

export const defaultLoginsLayer = Layer.effect(
  DefaultLogins,
  Effect.gen(function* () {
    return makeDefaultLoginBook({ rows: yield* HarnessDirectories, cli: yield* AccountCli });
  }),
);
