import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const device = sqliteTable(
  'device',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    secretDigest: text('secret_digest').notNull(),
    pairedAt: integer('paired_at', { mode: 'timestamp_ms' }).notNull(),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
  },
  (table) => [index('device_paired_idx').on(table.pairedAt, table.id)],
);

export const pairing = sqliteTable('pairing', {
  codeDigest: text('code_digest').primaryKey(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
});

export const remoteOrigin = sqliteTable('remote_origin', {
  origin: text('origin').primaryKey(),
  settledAt: integer('settled_at', { mode: 'timestamp_ms' }).notNull(),
});

export const remoteTerminal = sqliteTable('remote_terminal', {
  port: integer('port').primaryKey(),
});
