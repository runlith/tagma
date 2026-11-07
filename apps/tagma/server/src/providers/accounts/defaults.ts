import type { AccountKey } from '@runlith/llm/models/authStatus';
import { Effect, Layer, PubSub, Stream } from 'effect';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits, type WriteUnit } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { OPERATOR_PRINCIPAL } from '../../platform/contract/wire/actor.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { type AccountRows, type DefaultAccount, DefaultAccounts, storedKeys, unknownAccount } from '../contract/service/accounts.js';
import { notInstalled, type NotInstalled, type ProviderRegistry } from '../contract/service/registry.js';
import { defaultAccount } from '../store/tables.js';
import { makeAccountDefaultRows } from '../store/defaultAccounts.js';
import { credentialRefusal, isTokenFault } from '../credentials/refusal.js';

export const defaultAccountsLayer = (
  accounts: AccountRows,
  consoles: () => ReadonlyArray<string>,
  registry: ProviderRegistry['Service'],
): Layer.Layer<DefaultAccounts, never, MachineStore | MachineUnits> =>
  Layer.effect(
    DefaultAccounts,
    Effect.gen(function* () {
      const known = (provider: string): Effect.Effect<void, NotInstalled> =>
        consoles().includes(provider) ? Effect.void : Effect.asVoid(registry.registration(provider));
      const { db } = yield* MachineStore;
      const units = yield* MachineUnits;
      const rows = makeAccountDefaultRows({ db });
      const sourceOf = (provider: string, runId?: string) =>
        (runId === undefined ? registry.current() : registry.forRun(runId)).accountSource(provider);
      const moves = yield* PubSub.unbounded<string>();

      const moved = Effect.fnUntraced(function* (
        unit: WriteUnit<'machine'>,
        provider: string,
        standing: DefaultAccount,
        account: string | null,
      ) {
        const saved = yield* rows.write(unit, OPERATOR_PRINCIPAL, provider, standing, account);
        if (saved.revision !== standing.revision) yield* unit.afterCommit(Effect.asVoid(PubSub.publish(moves, provider)));
        return saved;
      });

      const settle = Effect.fnUntraced(function* (
        unit: WriteUnit<'machine'>,
        provider: string,
        account: string | null,
        stored: readonly string[],
        expectedRevision?: number,
      ) {
        if (account !== null && !stored.includes(account)) return yield* unknownAccount(provider, account, stored);
        const standing = yield* rows.read(unit, OPERATOR_PRINCIPAL, provider);
        if (expectedRevision !== undefined && expectedRevision !== standing.revision) {
          return yield* new GateRefusal(
            'stale-revision',
            `The default ${provider} account moved to revision ${standing.revision} since revision ${expectedRevision} was read.`,
            ['read the default account again and retry'],
          );
        }
        return yield* moved(unit, provider, standing, account);
      });

      return DefaultAccounts.of({
        defaultAccount: Effect.fnUntraced(function* (provider, unit, runId) {
          if (runId === undefined) yield* known(provider);
          else if (!registry.forRun(runId).models.registered(provider)) return yield* notInstalled(provider);
          const source = sourceOf(provider, runId);
          const standing = yield* unit === undefined
            ? units.read((read) => rows.read(read, OPERATOR_PRINCIPAL, source))
            : rows.read(unit, OPERATOR_PRINCIPAL, source);
          const selected = standing.account;
          const { wires } = registry.current();
          if (runId !== undefined || unit !== undefined || !wires.registered(provider) || wires.named(provider).borrows === undefined)
            return standing;
          if (selected === null && standing.revision !== 0) return standing;
          const stored = yield* accounts
            .of(source)
            .pipe(Effect.mapError((cause) => (isTokenFault(cause) ? credentialRefusal(`resolve the ${provider} default`, cause) : cause)));
          if (stored.some((row) => row.key === selected)) return standing;
          const canonical =
            selected === null
              ? stored.length === 1
                ? stored[0]!.key
                : null
              : (stored.find((row) => row.aliases?.includes(selected))?.key ?? null);
          if (canonical === null) return standing;
          return yield* units.write(
            writes('DefaultAccounts.adopt', [defaultAccount]),
            Effect.fnUntraced(function* (write) {
              const current = yield* rows.read(write, OPERATOR_PRINCIPAL, source);
              if (current.revision !== standing.revision) return current;
              return yield* moved(write, source, current, canonical);
            }),
          );
        }),

        heldAccount: (provider) => units.read((read) => rows.read(read, OPERATOR_PRINCIPAL, sourceOf(provider))),

        saveDefaultAccount: Effect.fnUntraced(function* (provider, account, expectedRevision) {
          if (account !== null) yield* known(provider);
          const source = sourceOf(provider);
          const keys = account === null ? [] : yield* storedKeys(accounts, source);
          return yield* units.write(writes('DefaultAccounts.save', [defaultAccount]), (write) =>
            settle(write, source, account, keys, expectedRevision),
          );
        }),

        settleDefaultAccount: (unit, provider, account, stored, expectedRevision) =>
          Effect.andThen(known(provider), settle(unit, sourceOf(provider), account, stored, expectedRevision)),

        forgetAccount: Effect.fn('DefaultAccounts.forgetAccount')(function* (provider, account) {
          return yield* units.write(
            writes('DefaultAccounts.forget', [defaultAccount]),
            Effect.fnUntraced(function* (write) {
              const standing = yield* rows.read(write, OPERATOR_PRINCIPAL, provider);
              return standing.account === account ? yield* moved(write, provider, standing, null) : standing;
            }),
          );
        }),

        adoptDefaultAccount: Effect.fnUntraced(function* (provider, account: AccountKey) {
          yield* known(provider);
          const source = sourceOf(provider);
          const keys = yield* storedKeys(accounts, source);
          if (!keys.includes(String(account))) return;
          yield* units.write(
            writes('DefaultAccounts.adopt', [defaultAccount]),
            Effect.fnUntraced(function* (unit) {
              const standing = yield* rows.read(unit, OPERATOR_PRINCIPAL, source);
              if (standing.account !== null && keys.includes(String(standing.account))) return;
              yield* moved(unit, source, standing, String(account));
            }),
          );
        }),

        defaultAccountMoved: Stream.fromPubSub(moves),
      });
    }),
  );
