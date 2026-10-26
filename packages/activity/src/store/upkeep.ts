import { sql } from 'drizzle-orm';
import type { EffectSQLiteBunDatabase } from 'drizzle-orm/effect-sqlite-bun';
import { type Context, Effect, type FileSystem } from 'effect';
import { type Bodies, type BodyBucket, bucketOf } from './bodies';

const HOUR_MS = 60 * 60 * 1000;

export type Keeping = { readonly hours: number; readonly bodiesMaxBytes: number };

export function orphaned(db: EffectSQLiteBunDatabase) {
  return db.run(sql`update activity set outcome = 'orphaned',
    ended_at = coalesce((select max(n.at) from note n where n.activity = activity.id), opened_at) where ended_at is null`);
}

export const kept = Effect.fnUntraced(function* (
  db: EffectSQLiteBunDatabase,
  fileSystem: Context.Service.Shape<typeof FileSystem.FileSystem>,
  root: string,
  bodies: Bodies,
  keeping: Keeping,
  now: number,
  initial = false,
) {
  const cutoff = now - keeping.hours * HOUR_MS;
  const oldest = bucketOf(cutoff);
  if (initial) {
    const physical = yield* bodies.inventory(oldest);
    const present = new Set(physical.map((bucket) => bucket.bucket));
    const indexed = yield* db.all<{ readonly bucket: string }>(sql`select bucket from bucket`);
    yield* db.transaction(() =>
      Effect.gen(function* () {
        for (const held of indexed)
          if (!present.has(held.bucket)) {
            yield* db.run(sql`update body set state = 'evicted' where bucket = ${held.bucket} and state = 'written'`);
            yield* db.run(sql`delete from bucket where bucket = ${held.bucket}`);
          }
        for (const held of physical)
          yield* db.run(sql`insert into bucket (bucket, bytes, bodies) values (${held.bucket}, ${held.bytes}, ${held.bodies})
          on conflict (bucket) do update set bytes = excluded.bytes, bodies = excluded.bodies`);
      }),
    );
  }
  const buckets = yield* db.all<BodyBucket>(sql`select bucket, bytes, bodies from bucket order by bucket`);
  const standing = new Map(buckets.map((bucket) => [bucket.bucket, { ...bucket }]));
  let total = buckets.reduce((sum, bucket) => sum + bucket.bytes, 0);
  const evict = Effect.fnUntraced(function* (bucket: BodyBucket, expired: boolean) {
    yield* bodies.remove(bucket.bucket);
    yield* db.transaction(() =>
      Effect.gen(function* () {
        yield* db.run(sql`update body set state = 'evicted' where bucket = ${bucket.bucket} and state = 'written'`);
        yield* db.run(sql`delete from bucket where bucket = ${bucket.bucket}`);
        if (!expired)
          yield* db.run(sql`insert into loss (at, until, cause, facts, bodies, bytes)
          values (${now}, ${now}, 'ceiling', 0, ${bucket.bodies}, ${bucket.bytes})`);
      }),
    );
    standing.delete(bucket.bucket);
    total -= bucket.bytes;
  });
  for (const bucket of buckets) if (bucket.bucket < oldest) yield* evict(bucket, true);
  const strays = (yield* fileSystem.exists(root)) ? yield* fileSystem.readDirectory(root) : [];
  for (const stray of strays) if (stray < oldest) yield* bodies.remove(stray);
  const open = sql`(select id from activity where ended_at is null)`;
  while (true) {
    const leaves = yield* db.all<{ readonly activity: string; readonly n: number; readonly bucket: string; readonly bytes: number }>(sql`
        select b.activity, b.n, b.bucket, b.bytes from body b where b.at < ${cutoff} and b.state = 'written'
          and b.activity not in ${open} and not exists (
            select 1 from body child where child.base_activity = b.activity and child.base_n = b.n and child.state = 'written'
          ) order by b.at limit 128`);
    if (leaves.length === 0) break;
    yield* bodies.discard(leaves.map((body) => ({ id: `${body.activity}.${body.n}`, bucket: body.bucket })));
    yield* db.run(
      sql`delete from body where (activity, n) in (values ${sql.join(
        leaves.map((body) => sql`(${body.activity}, ${body.n})`),
        sql`, `,
      )})`,
    );
    for (const leaf of leaves) {
      const bucket = standing.get(leaf.bucket);
      if (bucket !== undefined) {
        bucket.bytes -= leaf.bytes;
        bucket.bodies -= 1;
      }
      total -= leaf.bytes;
    }
  }
  for (const bucket of standing.values()) {
    if (total <= keeping.bodiesMaxBytes) break;
    yield* evict(bucket, false);
  }
  yield* db.transaction(() =>
    Effect.gen(function* () {
      yield* db.run(sql`delete from reading_row where reading in (select id from reading where expires <= ${now})`);
      yield* db.run(sql`delete from reading where expires <= ${now}`);
      yield* db.run(sql`delete from reading_member where expires <= ${now}`);
      yield* db.run(sql`delete from note where at < ${cutoff} and activity not in ${open}`);
      yield* db.run(sql`delete from body where at < ${cutoff} and state <> 'written' and activity not in ${open}`);
      yield* db.run(sql`delete from activity where ended_at < ${cutoff}`);
      yield* db.run(sql`delete from loss where until < ${cutoff}`);
    }),
  );
});
