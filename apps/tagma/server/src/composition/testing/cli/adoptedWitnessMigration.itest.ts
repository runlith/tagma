import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { sql } from 'drizzle-orm';
import { inDatabase } from '../../../platform/testing/connection.js';
import { applyMigration, chain } from '../../../platform/store/chain.js';
import { fixtureMigrations } from '../migrations.js';
import { parseExternalSession } from '../../../threads/contract/wire/harness/externalSession.js';
import { unmeasuredObservation } from '../../../threads/contract/wire/harness/observation.js';

const migration = chain(fixtureMigrations).find((step) => step.name === '20261011042000_adopted_job_witness');

const facet = (origin: string, job: unknown) => ({
  name: 'claude-code',
  sessionKey: 'cli-key',
  execution: { execution: 'shell', incarnation: 0 },
  observation: unmeasuredObservation(),
  session: {
    id: 'session',
    origin,
    job,
    state: 'running',
    prompt: '',
    cwd: null,
    argv: null,
    startedAt: '2026-10-10T00:00:00.000Z',
  },
});

it.effect('only adopted sessions lacking birth are ended, with their lease released and key retained', () =>
  Effect.gen(function* () {
    expect(migration, 'the adopted job witness migration is not shipped').toBeDefined();
    const rows = yield* inDatabase(':memory:', (db) =>
      Effect.gen(function* () {
        yield* db.run(
          sql`create table __drizzle_migrations (id integer primary key, hash text, created_at integer, name text, applied_at text)`,
        );
        yield* db.run(sql`create table external_session (id text primary key, facet text, lease_owner text, lease_beat integer)`);
        const fixtures = [facet('adopted', { pid: 10 }), facet('adopted', { pid: 11, birth: 'witness' }), facet('launched', undefined)];
        for (let id = 0; id < fixtures.length; id++)
          yield* db.run(sql`insert into external_session values (${String(id)}, ${JSON.stringify(fixtures[id])}, 'server', 123)`);
        yield* applyMigration(db, migration!);
        return yield* db.all<{ id: string; facet: string; lease_owner: string | null; lease_beat: number | null }>(
          sql`select * from external_session order by id`,
        );
      }),
    );
    const ended = parseExternalSession(JSON.parse(rows[0]!.facet));
    expect(ended).toMatchObject({ sessionKey: 'cli-key', session: { state: 'ended', endedReason: 'identity-unproven' } });
    expect(ended?.session?.job).toBeUndefined();
    expect(rows[0]).toMatchObject({ lease_owner: null, lease_beat: null });
    expect(parseExternalSession(JSON.parse(rows[1]!.facet))?.session).toMatchObject({
      state: 'running',
      job: { pid: 11, birth: 'witness' },
    });
    expect(parseExternalSession(JSON.parse(rows[2]!.facet))?.session).toMatchObject({ origin: 'launched', state: 'running' });
    expect(rows.slice(1).map((row) => [row.lease_owner, row.lease_beat])).toEqual([
      ['server', 123],
      ['server', 123],
    ]);
  }),
);
