import type { AccountKey } from '@runlith/llm/models/authStatus';
import type { ModelCredentials, ProviderQuota } from '@runlith/llm/profiles/contract';
import { type QuotaFailure, QuotaObservation, QuotaWindow } from '@runlith/llm/schema/quota';
import { Cause, Clock, Data, Effect, Exit, Fiber, FiberMap, Layer, Queue, Result, Semaphore, Stream, SubscriptionRef } from 'effect';
import type { AccountRows, DefaultAccounts, StoredAccount } from '../contract/service/accounts.js';
import { AccountQuota } from '../contract/service/quota.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { AccountQuotaRow, QuotaTable } from '../contract/wire/accounts.js';
import type { QuotaReading, QuotaReadingChange, QuotaReadings } from './readings.js';
import { quotaRefresh } from './refresh.js';

export type AccountQuotaProvider = {
  readonly id: string;
  readonly quota: ProviderQuota | null;
  readonly shownAs?: string | null;
};

const lentQuota = (row: AccountQuotaRow, lent: AccountQuotaRow | undefined): AccountQuotaRow =>
  lent === undefined || lent.quota === null || (row.quota !== null && row.quota.observedAt >= lent.quota.observedAt)
    ? row
    : { ...row, quota: lent.quota, restored: lent.restored, failure: lent.failure, failedAt: lent.failedAt };

type AccessUse = {
  readonly provider: string;
  readonly account: AccountKey;
  readonly accessToken: string;
};

type InternalRow = {
  readonly row: AccountQuotaRow;
  readonly accessToken: string | undefined;
  readonly credentialKey: string;
  readonly enrollment: string;
  readonly durable: boolean;
  readonly version: number;
  readonly merged: readonly QuotaWindow[];
};

const windowKey = (window: QuotaWindow): string => `${window.kind}/${window.label ?? ''}`;

const outside = (windows: readonly QuotaWindow[], taken: readonly QuotaWindow[]): readonly QuotaWindow[] => {
  const keys = new Set(taken.map(windowKey));
  return windows.filter((window) => !keys.has(windowKey(window)));
};

const rolled = (window: QuotaWindow, at: number): QuotaWindow => {
  if (window.resetsAt === undefined || window.resetsAt * 1000 > at) return window;
  const span = window.windowMinutes === undefined || window.windowMinutes <= 0 ? null : window.windowMinutes * 60;
  const resetsAt = span === null ? undefined : window.resetsAt + (Math.floor((at / 1000 - window.resetsAt) / span) + 1) * span;
  return new QuotaWindow({ ...window, usedPercent: 0, resetsAt });
};

const withMerged = (observation: QuotaObservation, merged: readonly QuotaWindow[]): QuotaObservation => {
  const at = observation.observedAt.getTime();
  const kept = outside(merged, observation.windows).map((window) => rolled(window, at));
  return kept.length === 0 ? observation : new QuotaObservation({ ...observation, windows: [...observation.windows, ...kept] });
};

const resetBetween = (quota: QuotaObservation, after: number, until: number): boolean =>
  quota.windows.some((window) => window.resetsAt !== undefined && window.resetsAt * 1000 > after && window.resetsAt * 1000 <= until);

const nextReset = (table: QuotaTable, now: number): { readonly at: number; readonly due: readonly AccountQuotaRow[] } | null => {
  let at: number | null = null;
  let due: AccountQuotaRow[] = [];
  for (const row of table) {
    for (const window of row.quota?.windows ?? []) {
      if (window.resetsAt === undefined || window.resetsAt * 1000 <= now) continue;
      const reset = window.resetsAt * 1000;
      if (at === null || reset < at) {
        at = reset;
        due = [row];
      } else if (reset === at && !due.includes(row)) due.push(row);
    }
  }
  return at === null ? null : { at, due };
};

const REPLY_FRESH_MS = 300_000;
const AFTER_RESET_MS = 10_000;
const KEEP_RETRY = '10 seconds';

const rowKey = (provider: string, account: AccountKey): string => `${provider}/${account}`;

const sameOrigin = (left: AccountQuotaRow['origin'], right: AccountQuotaRow['origin']): boolean =>
  left.kind === right.kind && (left.kind === 'own' || (right.kind === 'cli' && left.place === right.place));

const sameRow = (left: AccountQuotaRow, right: AccountQuotaRow): boolean =>
  left.provider === right.provider &&
  left.account === right.account &&
  left.label === right.label &&
  sameOrigin(left.origin, right.origin) &&
  left.problem?.kind === right.problem?.kind &&
  left.default === right.default &&
  left.expiresAt === right.expiresAt &&
  left.quota === right.quota &&
  left.restored === right.restored &&
  left.failure === right.failure &&
  left.failedAt === right.failedAt;

const sameTable = (left: QuotaTable, right: QuotaTable): boolean =>
  left.length === right.length && left.every((row, index) => right[index] !== undefined && sameRow(row, right[index]));

const skipRefresh = (row: AccountQuotaRow, now: number): boolean => {
  if (
    !row.restored &&
    row.quota?.source === 'reply' &&
    now >= row.quota.observedAt.getTime() &&
    now - row.quota.observedAt.getTime() < REPLY_FRESH_MS &&
    !resetBetween(row.quota, row.quota.observedAt.getTime(), now)
  ) {
    return true;
  }
  if (
    row.failure?._tag === 'rate-limited' &&
    row.failure.retryAfterMs !== undefined &&
    row.failedAt !== null &&
    now < row.failedAt + row.failure.retryAfterMs
  ) {
    return true;
  }
  return row.failure?._tag === 'unsupported';
};

export const accountQuotaLayer = (
  ownerId: string,
  accounts: AccountRows,
  readings: QuotaReadings,
  providers: () => readonly AccountQuotaProvider[],
  defaultAccount: DefaultAccounts['Service']['defaultAccount'],
  signer: (onAccess: (use: AccessUse) => void) => ModelCredentials,
  uninstalled: Effect.Effect<readonly string[], unknown> = Effect.succeed([]),
): Layer.Layer<AccountQuota> =>
  Layer.effect(
    AccountQuota,
    Effect.gen(function* () {
      const kept = new Map<string, QuotaReading>();
      for (const reading of yield* readings.all().pipe(
        Effect.catch((failure) =>
          Effect.sync(() => {
            console.warn('[account-quota] kept readings unreadable', failure);
            return [];
          }),
        ),
      )) {
        kept.set(rowKey(reading.provider, reading.account), reading);
      }

      const unsaved = new Map<string, QuotaReadingChange>();
      const wake = yield* Queue.dropping<void>(1);
      const save = (key: string, change: QuotaReadingChange): void => {
        unsaved.set(key, change);
        Queue.offerUnsafe(wake, undefined);
      };
      const drop = (key: string, provider: string, account: AccountKey): void => save(key, { _tag: 'drop', provider, account });
      const keep = (key: string, entry: InternalRow, observation: QuotaObservation, merged: readonly QuotaWindow[]): void => {
        if (!entry.durable) return;
        save(key, {
          _tag: 'save',
          reading: { provider: entry.row.provider, account: entry.row.account, enrollment: entry.enrollment, observation, merged },
        });
      };
      const flush: Effect.Effect<boolean> = Effect.suspend(() => {
        if (unsaved.size === 0) return Effect.succeed(true);
        const batch = [...unsaved];
        unsaved.clear();
        return readings.apply(batch.map(([, change]) => change)).pipe(
          Effect.as(true),
          Effect.catchCause((cause) =>
            Effect.sync(() => {
              console.warn('[account-quota] readings not kept', Cause.pretty(cause));
              for (const [key, change] of batch) if (!unsaved.has(key)) unsaved.set(key, change);
              return false;
            }),
          ),
        );
      }).pipe(Effect.uninterruptible);
      yield* Effect.addFinalizer(() => flush);
      yield* Effect.forkScoped(
        Effect.forever(
          Queue.take(wake).pipe(
            Effect.andThen(flush),
            Effect.flatMap((written) => (written ? Effect.void : Effect.andThen(Effect.sleep(KEEP_RETRY), Queue.offer(wake, undefined)))),
          ),
        ),
      );

      const state = new Map<string, InternalRow>();
      const stateGate = Semaphore.makeUnsafe(1);
      const reads = yield* FiberMap.make<string, void>();
      const tableRef = yield* SubscriptionRef.make<QuotaTable>([]);
      const providerOrder = (): ReadonlyMap<string, number> => new Map(providers().map((provider, index) => [provider.id, index]));

      const publicTable = (): QuotaTable => {
        const order = providerOrder();
        const shown = new Map(
          providers().map((provider) => [provider.id, provider.shownAs === undefined ? provider.id : provider.shownAs]),
        );
        const own: AccountQuotaRow[] = [];
        const lent = new Map<string, AccountQuotaRow>();
        for (const { row } of state.values()) {
          const named = shown.get(row.provider);
          const target = named === undefined ? row.provider : named;
          if (target === row.provider) own.push(row);
          else if (target !== null) lent.set(rowKey(target, row.account), row);
        }
        return own
          .map((row) => lentQuota(row, lent.get(rowKey(row.provider, row.account))))
          .sort(
            (left, right) =>
              (order.get(left.provider) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.provider) ?? Number.MAX_SAFE_INTEGER) ||
              String(left.account).localeCompare(String(right.account)),
          );
      };

      const publish = Effect.fnUntraced(function* () {
        const next = publicTable();
        const current = yield* SubscriptionRef.get(tableRef);
        if (!sameTable(current, next)) yield* SubscriptionRef.set(tableRef, next);
      });

      const readableRows = (provider: AccountQuotaProvider): Effect.Effect<readonly StoredAccount[] | null> =>
        Effect.catch(accounts.of(provider.id), (failure) =>
          Effect.sync(() => {
            console.warn(`[account-quota] ${provider.id} accounts unreadable`, failure);
            return null;
          }),
        );

      let lastUninstalled: readonly AccountQuotaProvider[] = [];
      const uninstalledProviders: Effect.Effect<readonly AccountQuotaProvider[]> = Effect.map(Effect.result(uninstalled), (read) => {
        if (Result.isFailure(read)) {
          console.warn('[account-quota] uninstalled providers unreadable; the last known stand', read.failure);
          return lastUninstalled;
        }
        const order = providerOrder();
        lastUninstalled = read.success.filter((id) => !order.has(id)).map((id) => ({ id, quota: null }));
        return lastUninstalled;
      });

      const reconcile = Effect.fnUntraced(function* () {
        const installed = yield* Effect.forEach(
          providers(),
          (provider) =>
            Effect.all({
              rows: readableRows(provider),
              defaultAccount: defaultAccount(provider.id).pipe(
                Effect.map(({ account }) => account),
                Effect.catchIf(
                  (failure): failure is GateRefusal<'provider-not-installed'> =>
                    failure instanceof GateRefusal && failure.code === 'provider-not-installed',
                  () => Effect.succeed(null),
                ),
                Effect.orDie,
              ),
            }).pipe(Effect.map((value) => ({ provider: provider.id, ...value }))),
          { concurrency: 'unbounded' },
        );
        const orphaned = yield* Effect.forEach(
          yield* uninstalledProviders,
          (provider) => Effect.map(readableRows(provider), (rows) => ({ provider: provider.id, rows, defaultAccount: null })),
          { concurrency: 'unbounded' },
        );
        const loaded = [...installed, ...orphaned];
        const next = new Map<string, InternalRow>();
        const answered = new Set<string>();
        for (const group of loaded) {
          if (group.rows === null) {
            for (const [key, entry] of state) {
              if (entry.row.provider === group.provider) next.set(key, entry);
            }
            continue;
          }
          answered.add(group.provider);
          for (const stored of group.rows) {
            const key = rowKey(group.provider, stored.key);
            const previous = state.get(key);
            const enrolled = previous !== undefined && previous.enrollment === stored.enrollment;
            const reading = previous === undefined ? kept.get(key) : undefined;
            kept.delete(key);
            const restored =
              stored.durable && reading !== undefined && reading.enrollment === stored.enrollment ? reading.observation : null;
            if (!enrolled && restored === null && (previous !== undefined || reading !== undefined)) {
              drop(key, group.provider, stored.key);
            }
            const nextCredential = stored.fingerprint;
            const failing = enrolled && !(previous.row.failure?._tag === 'stale-token' && previous.credentialKey !== nextCredential);
            const metadata: AccountQuotaRow = {
              provider: group.provider,
              account: stored.key,
              label: stored.label,
              origin: stored.origin,
              problem: stored.problem,
              default: stored.key === group.defaultAccount,
              expiresAt: stored.expiresAt,
              quota: enrolled ? previous.row.quota : restored,
              restored: enrolled ? previous.row.restored : restored !== null,
              failure: failing ? previous.row.failure : null,
              failedAt: failing ? previous.row.failedAt : null,
            };
            next.set(key, {
              row: previous && sameRow(previous.row, metadata) ? previous.row : metadata,
              accessToken: stored.bearer,
              credentialKey: nextCredential,
              enrollment: stored.enrollment,
              durable: stored.durable,
              version: (previous?.version ?? 0) + (previous && !enrolled ? 1 : 0),
              merged: enrolled ? previous.merged : restored === null ? [] : (reading?.merged ?? []),
            });
          }
        }
        for (const [key, entry] of state) {
          if (!next.has(key)) drop(key, entry.row.provider, entry.row.account);
        }
        for (const [key, reading] of kept) {
          if (!answered.has(reading.provider)) continue;
          kept.delete(key);
          drop(key, reading.provider, reading.account);
        }
        state.clear();
        for (const [key, entry] of next) state.set(key, entry);
        yield* publish();
      });

      const withRows = <A>(work: (rows: ReadonlyMap<string, InternalRow>) => Effect.Effect<A>): Effect.Effect<A> =>
        stateGate.withPermit(
          Effect.andThen(
            reconcile(),
            Effect.suspend(() => work(new Map(state))),
          ),
        );

      const syncRows = (): Effect.Effect<ReadonlyMap<string, InternalRow>> => withRows(Effect.succeed);

      const apply = (
        provider: string,
        account: AccountKey,
        started: InternalRow,
        usedToken: string | null,
        outcome: {
          readonly quota: QuotaObservation | null;
          readonly failure: QuotaFailure | null;
          readonly at: number;
        },
      ): Effect.Effect<void> =>
        withRows(
          Effect.fnUntraced(function* (rows) {
            const key = rowKey(provider, account);
            const current = rows.get(key);
            if (!current) return;
            const sameCredential = usedToken === null ? current.credentialKey === started.credentialKey : current.accessToken === usedToken;
            if (!sameCredential || current.version !== started.version) return;
            state.set(key, {
              ...current,
              row: {
                ...current.row,
                quota: outcome.quota === null ? current.row.quota : withMerged(outcome.quota, current.merged),
                restored: outcome.quota === null && current.row.restored,
                failure: outcome.failure,
                failedAt: outcome.failure === null ? null : outcome.at,
              },
              version: current.version + 1,
            });
            if (outcome.quota !== null) keep(key, current, withMerged(outcome.quota, current.merged), current.merged);
            yield* publish();
          }),
        );

      const refreshOne = (provider: AccountQuotaProvider, requested: InternalRow): Effect.Effect<void> => {
        const quota = provider.quota;
        if (quota === null) return Effect.void;
        const key = rowKey(provider.id, requested.row.account);
        const work = Effect.gen(function* () {
          const rows = yield* syncRows();
          const started = rows.get(key);
          if (!started || started.version !== requested.version) return;
          const now = yield* Clock.currentTimeMillis;
          if (started.row.problem !== null || skipRefresh(started.row, now)) return;

          let usedToken: string | null = null;
          const credentials = signer((use) => {
            if (use.provider === provider.id && use.account === started.row.account) usedToken = use.accessToken;
          });
          const result = yield* quota
            .read(credentials, ownerId, String(started.row.account))
            .pipe(Effect.match({ onFailure: (failure) => ({ failure }), onSuccess: (quota) => ({ quota }) }));
          const at = yield* Clock.currentTimeMillis;
          yield* apply(
            provider.id,
            started.row.account,
            started,
            usedToken,
            'quota' in result ? { quota: result.quota, failure: null, at } : { quota: null, failure: result.failure, at },
          );
        });
        return Effect.gen(function* () {
          const fiber = yield* FiberMap.run(reads, key, { onlyIfMissing: true, startImmediately: true })(work);
          const exit = yield* Fiber.await(fiber);
          if (Exit.isFailure(exit) && !Cause.hasInterrupts(exit.cause)) return yield* Effect.failCause(exit.cause);
        });
      };

      const refresh: AccountQuota['Service']['refresh'] = Effect.fnUntraced(function* (provider, account) {
        const current = yield* syncRows();
        const selected = providers().flatMap((entry) => {
          if (entry.quota === null || (provider !== undefined && entry.id !== provider && entry.shownAs !== provider)) return [];
          return [...current.values()]
            .filter((row) => row.row.provider === entry.id && (account === undefined || row.row.account === account))
            .map((row) => ({ provider: entry, row }));
        });
        yield* Effect.forEach(selected, ({ provider: entry, row }) => refreshOne(entry, row), {
          concurrency: 'unbounded',
          discard: true,
        });
      });

      const atReset = Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const next = nextReset(yield* SubscriptionRef.get(tableRef), now);
        const changed = Effect.asVoid(Stream.runHead(Stream.drop(SubscriptionRef.changes(tableRef), 1)));
        if (next === null) return yield* changed;
        const reached = yield* Effect.raceFirst(Effect.as(Effect.sleep(next.at + AFTER_RESET_MS - now), true), Effect.as(changed, false));
        if (!reached) return;
        yield* Effect.forEach(next.due, (row) => refresh(row.provider, row.account), { concurrency: 'unbounded', discard: true });
      });

      yield* syncRows();
      const driver = yield* quotaRefresh(
        Effect.suspend(() => refresh()),
        atReset,
      );

      return {
        table: () => Effect.andThen(syncRows(), SubscriptionRef.get(tableRef)),
        observe: (provider, account, observation) =>
          withRows(
            Effect.fnUntraced(function* (rows) {
              const key = rowKey(provider, account);
              const current = rows.get(key);
              if (!current) return;
              const plan = observation.plan ?? current.row.quota?.plan;
              const planned =
                plan === undefined || plan === observation.plan ? observation : new QuotaObservation({ ...observation, plan });
              const quota = withMerged(planned, current.merged);
              state.set(key, {
                ...current,
                row: { ...current.row, quota, restored: false, failure: null, failedAt: null },
                version: current.version + 1,
              });
              keep(key, current, quota, current.merged);
              yield* publish();
            }),
          ),
        merge: (provider, account, observation) =>
          withRows(
            Effect.fnUntraced(function* (rows) {
              const key = rowKey(provider, account);
              const current = rows.get(key);
              if (!current) return;
              const merged = [...outside(current.merged, observation.windows), ...observation.windows];
              const standing = current.row.quota;
              const quota =
                standing === null
                  ? observation
                  : new QuotaObservation({
                      ...standing,
                      windows: [...outside(standing.windows, observation.windows), ...observation.windows],
                    });
              state.set(key, { ...current, row: { ...current.row, quota }, version: current.version + 1, merged });
              keep(key, current, quota, merged);
              yield* publish();
            }),
          ),
        fail: (provider, account, failure) =>
          withRows(
            Effect.fnUntraced(function* (rows) {
              const key = rowKey(provider, account);
              const current = rows.get(key);
              if (current === undefined) return;
              state.set(key, {
                ...current,
                row: { ...current.row, failure, failedAt: yield* Clock.currentTimeMillis },
                version: current.version + 1,
              });
              yield* publish();
            }),
          ),
        refresh,
        changes: SubscriptionRef.changes(tableRef).pipe(Stream.onStart(driver.startWatching), Stream.ensuring(driver.stopWatching)),
      };
    }),
  );
