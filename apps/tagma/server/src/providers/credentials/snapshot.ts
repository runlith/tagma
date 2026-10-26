import { join } from 'node:path';
import { vendorWire } from '@runlith/llm/oauth/vendorCall';
import { sql } from 'drizzle-orm';
import { Effect, Schema } from 'effect';
import { consoleAccountOf } from './consoleKeys.js';
import { CONSOLE_KEYS_FILE, consoleKeyFile, keepDurably } from './consoleKeyFile.js';
import { type SnapshotParticipant, type SnapshotStore, SnapshotFailed } from '../../platform/contract/service/snapshots.js';
import { makeFileTokenStore } from '@runlith/llm/oauth/FileTokenStore';

type Db = SnapshotStore['db'];

type KeyShape = { readonly table: boolean; readonly account: boolean };

type StoredKey = { readonly provider: string; readonly account: string; readonly stored: string; readonly keyValue: string };

type Evacuated = readonly { readonly provider: string; readonly stored: string; readonly account: string }[];

type StandingDefault = { readonly table: string; readonly principal: string; readonly provider: string; readonly account: string };

const keyShape = Effect.fnUntraced(function* (db: Db) {
  const columns = yield* db.all<{ name: string }>(sql`select name from pragma_table_info('console_key')`);
  return { table: columns.length > 0, account: columns.some((column) => column.name === 'account') } satisfies KeyShape;
});

const storedKeys = (db: Db, shape: KeyShape) =>
  !shape.table
    ? Effect.succeed([] as readonly StoredKey[])
    : Effect.map(
        db.all<StoredKey>(
          shape.account
            ? sql`select provider, account, account as stored, key_value as keyValue from console_key where key_value <> ''`
            : sql`select provider, '' as account, '' as stored, key_value as keyValue from console_key where key_value <> ''`,
        ),
        (rows) => rows.map((row) => (row.account === '' ? { ...row, account: consoleAccountOf(row.keyValue) } : row)),
      );

const standingDefaults = Effect.fn('providers.standingDefaults')(function* (db: Db, selected: readonly string[]) {
  const wanted = selected.filter((table) => table === 'default_account' || table === 'thread_owner_settings');
  if (wanted.length === 0) return [] as readonly StandingDefault[];
  const existing = new Set(
    (yield* db.all<{ name: string }>(
      sql`select name from sqlite_master where type = 'table' and name in ('default_account', 'thread_owner_settings')`,
    )).map((row) => row.name),
  );
  const found: StandingDefault[] = [];
  if (wanted.includes('default_account') && existing.has('default_account')) {
    found.push(
      ...(yield* db.all<StandingDefault>(
        sql`select 'default_account' as "table", principal_id as principal, provider, account from default_account where account is not null`,
      )),
    );
  }
  if (wanted.includes('thread_owner_settings') && existing.has('thread_owner_settings')) {
    const [column] = yield* db.all<{ name: string }>(
      sql`select name from pragma_table_info('thread_owner_settings') where name = 'default_accounts'`,
    );
    if (column !== undefined) {
      found.push(
        ...(yield* db.all<StandingDefault>(
          sql`select 'thread_owner_settings' as "table", owner_id as principal, entry.key as provider, entry.value as account
        from thread_owner_settings, json_each(thread_owner_settings.default_accounts) as entry where entry.type = 'text'`,
        )),
      );
    }
  }
  return found as readonly StandingDefault[];
});

const withoutParameters = (cause: unknown): string => {
  const said =
    typeof cause === 'object' && cause !== null && 'reason' in cause && typeof cause.reason === 'string'
      ? cause.reason
      : cause instanceof Error
        ? cause.message
        : String(cause);
  const cut = said.search(/\n?params:/);
  return cut === -1 ? said : said.slice(0, cut);
};

const recordSchema = Schema.Struct({
  evacuated: Schema.Array(Schema.Struct({ provider: Schema.String, stored: Schema.String, account: Schema.String })),
});

const identityKey = (provider: string, stored: string): string => JSON.stringify([provider, stored]);

const recordedIdentities = (record: unknown) =>
  Effect.map(
    Schema.decodeUnknownEffect(recordSchema)(record ?? { evacuated: [] }),
    ({ evacuated }) => new Map(evacuated.map((key) => [identityKey(key.provider, key.stored), key.account])),
  );

const TOKENS_FILE = 'tokens.json';

export const credentialParticipant = (credentials: string): SnapshotParticipant => {
  const file = consoleKeyFile(credentials);
  const keysPath = join(credentials, CONSOLE_KEYS_FILE);
  const tokensPath = join(credentials, TOKENS_FILE);
  const tokens = makeFileTokenStore({ path: tokensPath, schemes: () => undefined, wire: vendorWire });
  const prepared = new Map<string, readonly StoredKey[]>();
  const failed = (path: string) => (cause: unknown) => new SnapshotFailed({ path, reason: `credentials: ${withoutParameters(cause)}` });

  return {
    tables: ['console_key', 'default_account', 'thread_owner_settings'],

    prepare: Effect.fn('providers.snapshotPrepare')(
      function* ({ path, db, tables }) {
        if (!tables.includes('console_key')) {
          prepared.set(path, []);
          return;
        }
        const kept = yield* storedKeys(db, yield* keyShape(db));
        if (kept.length > 0) {
          yield* keepDurably(
            file,
            kept.map(({ provider, account, keyValue }) => ({ provider, account, keyValue })),
          );
        }
        prepared.set(path, kept);
      },
      (effect, { path, db, tables }) => effect.pipe(Effect.mapError(failed(path))),
    ),

    record: ({ path }) =>
      Effect.sync(() => {
        const evacuated: Evacuated = (prepared.get(path) ?? []).map(({ provider, stored, account }) => ({
          provider,
          stored,
          account,
        }));
        prepared.delete(path);
        return { evacuated };
      }),

    scrub: Effect.fn('providers.snapshotScrub')(
      function* ({ path, db, tables }) {
        if (!tables.includes('console_key')) return;
        const shape = yield* keyShape(db);
        if (!shape.table) return;
        const keys = yield* storedKeys(db, shape);
        if (keys.length === 0) return;
        yield* db.run(sql`PRAGMA secure_delete = ON`);
        for (const key of keys) {
          yield* db.run(
            shape.account
              ? sql`update console_key set key_value = '' where provider = ${key.provider} and account = ${key.stored}`
              : sql`update console_key set key_value = '' where provider = ${key.provider}`,
          );
        }
      },
      (effect, { path, db, tables }) => effect.pipe(Effect.mapError(failed(path))),
    ),

    restore: Effect.fn('providers.snapshotRestore')(
      function* ({ path, db, record, report, tables }) {
        const kept = (yield* file.readFresh()).keys;
        if (tables.includes('console_key')) {
          const shape = yield* keyShape(db);
          if (shape.table) {
            const identities = yield* recordedIdentities(record);
            const rows = yield* db.all<{ provider: string; account: string }>(
              shape.account ? sql`select provider, account from console_key` : sql`select provider, '' as account from console_key`,
            );
            for (const row of rows) {
              const stored = shape.account ? row.account : '';
              const logical = shape.account
                ? (identities.get(identityKey(row.provider, row.account)) ?? row.account)
                : identities.get(identityKey(row.provider, ''));
              const keyValue = logical === undefined ? undefined : kept[row.provider]?.[logical];
              if (keyValue === undefined) {
                report({
                  table: 'console_key',
                  key: `${row.provider}/${logical ?? stored}`,
                  reason: `${keysPath} holds no key for this account`,
                });
                continue;
              }
              yield* db.run(
                shape.account
                  ? sql`update console_key set key_value = ${keyValue} where provider = ${row.provider} and account = ${stored}`
                  : sql`update console_key set key_value = ${keyValue} where provider = ${row.provider}`,
              );
            }
          }
        }
        for (const standing of yield* standingDefaults(db, tables)) {
          const held =
            kept[standing.provider]?.[standing.account] !== undefined ||
            (yield* tokens.held(standing.provider)).some((row) => row.key === standing.account);
          if (held) continue;
          report({
            table: standing.table,
            key: `${standing.principal}/${standing.provider}`,
            reason: `the default account ${standing.account} has no credential in ${tokensPath} or ${keysPath}`,
          });
        }
      },
      (effect, { path, db, record, report, tables }) => effect.pipe(Effect.mapError(failed(path))),
    ),
  };
};
