import { createHash, randomUUID } from 'node:crypto';
import { bulk, readOnly } from '@runlith/sqlite-process/SqliteProcess';
import { sql, type SQL } from 'drizzle-orm';
import type { EffectSQLiteBunDatabase } from 'drizzle-orm/effect-sqlite-bun';
import { Clock, Effect, type Semaphore } from 'effect';
import type { Bodies } from './bodies';
import { ACTIVITY_FIELDS, type ActivityOrder, matching, projected, rank, type Term, term, unprojected } from './query';
import type { ActivityLoss } from '../fact';
import { type ActivityFreshness, type ActivityGroupsQuery, ActivityRecord, type ActivityScope, ActivityUnreadable } from './record';

const CHAIN_LINKS = 64;
const PAGE_BYTES = 50 * 1024;
const PAGE_ROWS = Math.floor(PAGE_BYTES / 587);

type Projected = {
  readonly id: string | null;
  readonly opened_at: number | null;
  readonly n: number;
  readonly row: string | null;
  readonly bytes: number;
};
type Grouped = {
  readonly by: string;
  readonly types: string;
  readonly count: number;
  readonly matched: number;
  readonly [sum: string]: unknown;
};
type LossRow = {
  readonly cause: string;
  readonly facts: number;
  readonly bodies: number;
  readonly bytes: number;
  readonly unknown: number;
};
type Held = {
  readonly id: string;
  readonly question: string;
  readonly expires: number;
  readonly matched: number;
  readonly total: number;
  readonly threads: number;
};
type ReadingShape =
  | { readonly kind: 'rows'; readonly paths: readonly string[]; readonly order: ActivityOrder | undefined }
  | {
      readonly kind: 'groups';
      readonly group: readonly string[];
      readonly count: boolean;
      readonly sum: readonly string[];
      readonly order: ActivityOrder | undefined;
    }
  | {
      readonly kind: 'threads';
      readonly since: number | undefined;
      readonly before: number | undefined;
      readonly ids: readonly string[] | undefined;
    };

export function activityReading(
  db: EffectSQLiteBunDatabase,
  bodies: Bodies,
  fresh: Effect.Effect<ActivityFreshness>,
  hours: () => number,
  lane: Semaphore.Semaphore,
  readingsMax: number,
): ActivityRecord['Service'] {
  const all = <A>(query: SQL, scale: 'point' | 'bulk' = 'bulk') =>
    (scale === 'bulk' ? bulk : readOnly)(db.all<A>(query)).pipe(
      Effect.mapError((cause) => new ActivityUnreadable({ reason: cause.message })),
    );
  const write = (query: SQL) => db.run(query).pipe(Effect.mapError((cause) => new ActivityUnreadable({ reason: cause.message })));
  const horizon = () => hours() * 60 * 60 * 1000;
  const scoped = (scope: ActivityScope) => sql`
    ${scope.project === undefined ? sql`1` : sql`a.project = ${scope.project}`}
    and ${scope.threads === undefined ? sql`1` : sql`a.thread in (select value from json_each(${JSON.stringify(scope.threads)}))`}
    and ${scope.members === undefined ? sql`1` : sql`a.thread in (select thread from reading_member where reading = ${scope.members})`}
    and ${
      scope.window === undefined
        ? sql`1`
        : sql`a.thread in (select w.thread from activity w where w.project = ${scope.window.project}
      ${scope.window.since === undefined ? sql`` : sql`and w.opened_at >= ${scope.window.since}`}
      ${scope.window.before === undefined ? sql`` : sql`and w.opened_at < ${scope.window.before}`} and w.opened_at <= ${scope.through})`
    }
    and a.opened_at <= ${scope.through} and ${matching(scope.where)}`;
  const losses = (scope: ActivityScope, freshness: ActivityFreshness, now: number) =>
    lostBetween(db, freshness, scope.since ?? now - horizon(), Math.min(now, scope.through));
  const retain = Effect.fnUntraced(function* (scope: ActivityScope, shape: ReadingShape, select: SQL) {
    const now = yield* Clock.currentTimeMillis;
    const id = scope.reading ?? randomUUID();
    const question = createHash('sha256')
      .update(
        JSON.stringify({
          threads: scope.threads,
          project: scope.project,
          members: scope.members,
          window: scope.window,
          through: scope.through,
          since: scope.since,
          where: scope.where,
          ...shape,
        }),
      )
      .digest('hex');
    const held = yield* db
      .transaction(() =>
        Effect.gen(function* () {
          const [standing] = yield* db.all<Held>(sql`select * from reading where id = ${id}`);
          if (standing !== undefined) return standing;
          if (scope.resumed === true) return null;
          const evicted = sql`select id from reading where expires <= ${now} or rowid in (select rowid from reading order by rowid desc limit -1 offset ${Math.max(0, readingsMax - 1)})`;
          yield* db.run(sql`delete from reading_row where reading in (${evicted})`);
          yield* db.run(sql`delete from reading_member where reading in (${evicted})`);
          yield* db.run(sql`delete from reading where id in (${evicted})`);
          yield* db.run(
            shape.kind === 'threads'
              ? sql`insert or ignore into reading_member (reading, thread, expires) select ${id}, id, ${now + horizon()} from (${select})`
              : shape.kind === 'groups'
                ? sql`insert into reading_row (reading, n, answer) select ${id}, row_number() over (), json_object(${sql.join([sql`'by', by, 'types', types, 'count', count, 'matched', matched`, ...shape.sum.map((_path, index) => sql`${`s${index}`}, ${sql.raw(`s${index}`)}, ${`n${index}`}, ${sql.raw(`n${index}`)}, ${`u${index}`}, ${sql.raw(`u${index}`)}`)], sql`, `)}) from (${select})`
                : sql`insert into reading_row (reading, n, identity) select ${id}, row_number() over (), id from (${select})`,
          );
          const [counted] = yield* db.all<{ readonly total: number; readonly matched: number }>(
            shape.kind === 'threads'
              ? sql`select count(*) as total, count(*) as matched from reading_member where reading = ${id}`
              : shape.kind === 'groups'
                ? sql`select count(*) as total, coalesce(max(json_extract(answer, '$.matched')), 0) as matched from reading_row where reading = ${id}`
                : sql`select count(*) as total, count(*) as matched from reading_row where reading = ${id}`,
          );
          const total = counted?.total ?? 0;
          const [population] =
            shape.kind === 'threads' ? [{ threads: total }] : yield* db.all<{ readonly threads: number }>(populated(scope));
          const answer = {
            id,
            question,
            expires: now + horizon(),
            matched: counted?.matched ?? 0,
            total,
            threads: population?.threads ?? 0,
          };
          yield* db.run(
            sql`insert into reading (id, question, expires, matched, total, threads) values (${id}, ${question}, ${answer.expires}, ${answer.matched}, ${answer.total}, ${answer.threads})`,
          );
          return answer;
        }),
      )
      .pipe(Effect.mapError((cause) => new ActivityUnreadable({ reason: cause.message })));
    if (held === null || held.expires <= now)
      return yield* new ActivityUnreadable({ reason: 'This activity reading expired; open the question again.' });
    if (held.question !== question) return yield* new ActivityUnreadable({ reason: 'This cursor names another activity question.' });
    return { ...held, now };
  });
  const limitOf = (limit: number) => Math.min(PAGE_ROWS, Math.max(1, limit));

  return ActivityRecord.of({
    members: Effect.fnUntraced(function* (reading, threads) {
      if (threads.length > PAGE_ROWS)
        return yield* new ActivityUnreadable({ reason: `Activity membership accepts at most ${PAGE_ROWS} threads per page.` });
      const expires = (yield* Clock.currentTimeMillis) + horizon();
      if (threads.length > 0)
        yield* write(sql`insert or ignore into reading_member (reading, thread, expires)
        values ${sql.join(
          threads.map((thread) => sql`(${reading}, ${thread}, ${expires})`),
          sql`, `,
        )}`);
    }),
    rows: Effect.fnUntraced(function* (query) {
      const freshness = yield* fresh;
      const limit = limitOf(query.limit);
      const order =
        query.order === undefined ? sql`a.opened_at, a.id` : sql`${rank(term(query.order.by), query.order.dir)}, a.thread, a.id`;
      const held = yield* retain(
        query,
        { kind: 'rows', paths: query.paths, order: query.order },
        sql`select a.id from activity a where ${scoped(query)} order by ${order}`,
      );
      const found = yield* all<Projected>(sql`with page as (
        select r.n, a.id, a.opened_at, ${projected(query.paths)} as row from reading_row r left join activity a on a.id = r.identity
        where r.reading = ${held.id} and r.n > ${query.offset ?? 0} order by r.n limit ${limit + 1}
      ), sized as (select *, length(cast(row as blob)) as bytes from page), bounded as (
        select *, sum(coalesce(bytes, 4) + 64) over (order by n) as used from sized
      ) select id, opened_at, n, bytes, case when bytes <= ${PAGE_BYTES} then row end as row from bounded
        where used <= ${PAGE_BYTES} or n = ${1 + (query.offset ?? 0)} order by n`);
      if ((found[0]?.bytes ?? 0) > PAGE_BYTES)
        return yield* new ActivityUnreadable({ reason: 'This activity row exceeds the answer envelope; project narrower fields.' });
      const shown = found.slice(0, limit);
      const unavailable = shown.filter((row) => row.id === null).map((row) => `Activity at place ${row.n} is no longer retained.`);
      return {
        rows: shown.flatMap((row) =>
          row.id === null || row.opened_at === null || row.row === null
            ? []
            : [{ key: { openedAt: row.opened_at, id: row.id }, values: unprojected(row.row) }],
        ),
        more: (shown.at(-1)?.n ?? query.offset ?? 0) < held.total,
        matched: held.matched,
        total: held.total,
        threads: held.threads,
        reading: held.id,
        next: shown.at(-1)?.n ?? query.offset ?? 0,
        unavailable,
        lost: yield* losses(query, freshness, held.now),
      };
    }, lane.withPermit),
    groups: Effect.fnUntraced(function* (query) {
      const freshness = yield* fresh;
      const limit = limitOf(query.limit);
      const held = yield* retain(
        query,
        { kind: 'groups', group: query.group, count: query.count, sum: query.sum, order: query.order },
        grouping(query, scoped(query)),
      );
      const found = yield* all<{ readonly n: number; readonly answer: string | null; readonly bytes: number }>(sql`with page as (
        select n, answer, length(cast(answer as blob)) as bytes from reading_row where reading = ${held.id} and n > ${query.offset} order by n limit ${limit + 1}
      ) select n, bytes, case when bytes <= ${PAGE_BYTES} then answer end as answer from (
        select *, sum(bytes + 64) over (order by n) as used from page
      ) where used <= ${PAGE_BYTES} or n = ${query.offset + 1} order by n`);
      if ((found[0]?.bytes ?? 0) > PAGE_BYTES)
        return yield* new ActivityUnreadable({ reason: 'This activity group exceeds the answer envelope; group by narrower values.' });
      const shown = found.slice(0, limit);
      const groups = shown.flatMap((entry) => {
        const row = JSON.parse(entry.answer!) as Grouped;
        if (query.group.length === 0 && row.count === 0) return [];
        const values = JSON.parse(row.by) as readonly unknown[];
        const types = JSON.parse(row.types) as readonly (string | null)[];
        const by: Record<string, unknown> = {};
        const absent: string[] = [];
        for (const [index, path] of query.group.entries()) {
          if (types[index] === null) absent.push(path);
          else by[path] = values[index];
        }
        const sum: Record<string, number> = {};
        const unknown: Record<string, number> = {};
        for (const [index, path] of query.sum.entries()) {
          if (Number(row[`n${index}`]) > 0) sum[path] = Number(row[`s${index}`]);
          if (Number(row[`u${index}`]) > 0) unknown[path] = Number(row[`u${index}`]);
        }
        return [{ by, absent, count: row.count, sum, unknown }];
      });
      return {
        groups,
        more: (shown.at(-1)?.n ?? query.offset) < held.total,
        matched: held.matched,
        total: held.total,
        threads: held.threads,
        reading: held.id,
        next: shown.at(-1)?.n ?? query.offset,
        lost: yield* losses(query, freshness, held.now),
      };
    }, lane.withPermit),
    threads: Effect.fnUntraced(function* (window) {
      yield* fresh;
      const limit = limitOf(window.limit);
      const scope = sql`project = ${window.project} and thread is not null
        ${window.since === undefined ? sql`` : sql`and opened_at >= ${window.since}`}
        ${window.before === undefined ? sql`` : sql`and opened_at < ${window.before}`}
        ${window.ids === undefined ? sql`` : sql`and thread in (select value from json_each(${JSON.stringify(window.ids)}))`}`;
      const held = yield* retain(
        {
          project: window.project,
          through: window.before ?? 0,
          where: [],
          reading: window.reading,
          resumed: window.reading === undefined ? undefined : (true as const),
        },
        { kind: 'threads', since: window.since, before: window.before, ids: window.ids },
        sql`select distinct thread as id from activity where ${scope} order by thread`,
      );
      const found = yield* all<{ readonly thread: string }>(
        sql`select thread from reading_member where reading = ${held.id}
        ${window.after === undefined ? sql`` : sql`and thread > ${window.after}`}
        order by thread limit ${limit + 1}`,
        'point',
      );
      const threads = found.slice(0, limit).map((row) => row.thread);
      return { threads, total: held.total, reading: held.id, after: found.length > limit ? threads.at(-1)! : null };
    }, lane.withPermit),
    activity: Effect.fnUntraced(function* (id) {
      yield* fresh;
      const [row] = yield* all<{ readonly row: string | null; readonly bytes: number }>(
        sql`select case when length(cast(row as blob)) <= ${PAGE_BYTES} then row end as row, length(cast(row as blob)) as bytes
        from (select ${projected(ACTIVITY_FIELDS)} as row from activity a where a.id = ${id})`,
        'point',
      );
      if (row === undefined) return null;
      if (row.row === null)
        return yield* new ActivityUnreadable({
          reason: 'This activity metadata exceeds the answer envelope; project narrower fields in read_thread.',
        });
      return unprojected(row.row);
    }, lane.withPermit),
    body: Effect.fnUntraced(function* (id, n, bytes, from, thread) {
      yield* fresh;
      const links = yield* all<{
        readonly activity: string;
        readonly n: number;
        readonly bucket: string;
        readonly state: string;
        readonly form: string;
      }>(
        sql`with recursive chain(activity, n, bucket, state, form, base_activity, base_n, depth) as (
          select b.activity, b.n, b.bucket, b.state, b.form, b.base_activity, b.base_n, 0
          from body b join activity a on a.id = b.activity where b.activity = ${id} and b.n = ${n}
          ${thread === undefined ? sql`` : sql`and a.thread = ${thread}`}
          union all select b.activity, b.n, b.bucket, b.state, b.form, b.base_activity, b.base_n, c.depth + 1
          from body b join chain c on b.activity = c.base_activity and b.n = c.base_n where c.depth < ${CHAIN_LINKS}
        ) select activity, n, bucket, state, form from chain order by depth desc`,
        'point',
      );
      const asked = links.at(-1);
      if (asked === undefined) return yield* new ActivityUnreadable({ reason: `Activity ${id} holds no body ${n}.` });
      const missing = links.find((link) => link.state !== 'written');
      if (missing !== undefined)
        return yield* new ActivityUnreadable({ reason: `Body ${missing.activity}.${missing.n} is ${missing.state}.` });
      if (asked.form !== 'value' && links[0]?.form !== 'full')
        return yield* new ActivityUnreadable({ reason: `Body ${id}.${n} lost the head of its chain.` });
      return yield* bodies
        .read(
          links.map((link) => ({ id: `${link.activity}.${link.n}`, bucket: link.bucket })),
          asked.form !== 'value',
          Math.min(bytes, PAGE_BYTES),
          from ?? 0,
        )
        .pipe(Effect.mapError((failure) => new ActivityUnreadable({ reason: failure.reason })));
    }, lane.withPermit),
  });
}

export function lostBetween(
  db: EffectSQLiteBunDatabase,
  freshness: ActivityFreshness,
  since: number,
  through: number,
): Effect.Effect<readonly ActivityLoss[], ActivityUnreadable> {
  const kept = readOnly(
    db.all<LossRow>(sql`select cause, max(unknown) as unknown, sum(facts) as facts, sum(bodies) as bodies, sum(bytes) as bytes from loss
      where at <= ${through} and until >= ${since} group by cause order by cause`),
  ).pipe(Effect.mapError((cause) => new ActivityUnreadable({ reason: cause.message })));
  return Effect.map(kept, (rows) => [
    ...rows.map((row) => ({
      scope: 'global' as const,
      unknown: row.unknown > 0,
      cause: row.cause,
      facts: row.facts,
      bodies: row.bodies,
      bytes: row.bytes,
    })),
    ...freshness.lost
      .filter((loss) => loss.at <= through && loss.until >= since)
      .map((loss) => ({
        scope: 'global' as const,
        unknown: loss.unknown === true,
        cause: loss.cause,
        facts: loss.facts,
        bodies: loss.bodies,
        bytes: loss.bytes,
      })),
  ]);
}

function populated(scope: ActivityScope): SQL {
  const named = sql`${scope.members === undefined ? sql`` : sql`and thread in (select thread from reading_member where reading = ${scope.members})`}
    ${scope.threads === undefined ? sql`` : sql`and thread in (select value from json_each(${JSON.stringify(scope.threads)}))`}`;
  const window = scope.window;
  if (window !== undefined) {
    return sql`select count(distinct thread) as threads from activity where project = ${window.project} and thread is not null
      ${window.since === undefined ? sql`` : sql`and opened_at >= ${window.since}`}
      ${window.before === undefined ? sql`` : sql`and opened_at < ${window.before}`} and opened_at <= ${scope.through} ${named}`;
  }
  if (scope.members !== undefined) return sql`select count(*) as threads from reading_member where reading = ${scope.members}`;
  if (scope.threads !== undefined) return sql`select count(distinct value) as threads from json_each(${JSON.stringify(scope.threads)})`;
  return sql`select count(distinct thread) as threads from activity where thread is not null and opened_at <= ${scope.through}
    ${scope.project === undefined ? sql`` : sql`and project = ${scope.project}`}`;
}

function grouping(query: ActivityGroupsQuery, scope: SQL): SQL {
  const groups = query.group.map(term);
  const sums = query.sum.map(term);
  const columns = [
    sql`json_array(${sql.join(
      groups.map((held) => held.json),
      sql`, `,
    )}) as by`,
    sql`json_array(${sql.join(
      groups.map((held) => held.type),
      sql`, `,
    )}) as types`,
    sql`count(*) as count`,
    sql`sum(count(*)) over () as matched`,
    ...sums.flatMap((held, index) => [
      sql`sum(case when ${held.type} = 'number' then ${held.value} end) as ${sql.raw(`s${index}`)}`,
      sql`count(case when ${held.type} = 'number' then 1 end) as ${sql.raw(`n${index}`)}`,
      sql`count(case when ${held.type} is null or ${held.type} <> 'number' then 1 end) as ${sql.raw(`u${index}`)}`,
    ]),
  ];
  const grouped =
    groups.length === 0
      ? sql``
      : sql`group by ${sql.join(
          groups.flatMap((held) => [held.type, held.json]),
          sql`, `,
        )}`;
  return sql`select ${sql.join(columns, sql`, `)} from activity a where ${scope} ${grouped} order by ${ordering(query, groups)}`;
}

function ordering(query: ActivityGroupsQuery, groups: readonly Term[]): SQL {
  const order = query.order;
  const natural =
    groups.length === 0
      ? sql`1`
      : sql.join(
          groups.map((held) => rank(held, 'asc')),
          sql`, `,
        );
  if (order === undefined) return natural;
  const direction = sql.raw(order.dir);
  if (order.by === 'count') return sql`count(*) ${direction}, ${natural}`;
  const summed = query.sum.indexOf(order.by);
  if (summed !== -1) return sql`${sql.raw(`n${summed}`)} = 0, ${sql.raw(`s${summed}`)} ${direction}, ${natural}`;
  const held = groups[query.group.indexOf(order.by)];
  if (held === undefined) return natural;
  return sql`${rank({ type: held.type, value: sql`min(${held.value})`, json: held.json }, order.dir)}, ${natural}`;
}
