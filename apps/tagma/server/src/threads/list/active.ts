import { randomUUID } from 'node:crypto';
import { ActivityRecord } from '@runlith/activity/store/record';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import { and, inArray, sql } from 'drizzle-orm';
import { Effect } from 'effect';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits, type Unit } from '../../platform/contract/service/units.js';
import { recordFacts } from '../../thread-record/facts.js';
import { thread } from '../store/kernel.js';
import { ThreadInputRefused } from '../contract/service/failure.js';
import { ThreadListing } from '../contract/service/listing.js';
import { type ListHomes, selected, type ThreadSelection } from './select.js';

const HELD = 256;
const PAGE = 50;
type Held = { readonly total: number | null };
const stale = () =>
  new ThreadInputRefused('cursor-stale', 'This thread selection is no longer held.', ['open the thread listing again without a cursor']);

export const makeThreadSelections = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const activity = yield* ActivityRecord;
  const listing = yield* ThreadListing;
  yield* units.write('ThreadWindows.prepare', (unit) =>
    Effect.gen(function* () {
      yield* unit.run(
        db.run(sql`create temp table if not exists thread_selection (
        id text primary key, owner text not null, project integer not null, total integer
      )`),
      );
      yield* unit.run(
        db.run(sql`create temp table if not exists thread_selection_member (
        reading text not null, thread text not null, order_at integer not null, position integer, primary key (reading, thread)
      )`),
      );
      yield* unit.run(
        db.run(sql`create index if not exists temp.thread_selection_order
        on thread_selection_member (reading, order_at desc, thread desc)`),
      );
      yield* unit.run(
        db.run(sql`create unique index if not exists temp.thread_selection_position
        on thread_selection_member (reading, position)`),
      );
    }),
  );

  const holding = Effect.fnUntraced(function* (unit: Unit<'machine'>, owner: string, project: number, reading: string) {
    const [held] = yield* unit.run(
      db.all<Held>(sql`
      select total from temp.thread_selection where id = ${reading} and owner = ${owner} and project = ${project}`),
    );
    if (held === undefined) return yield* stale();
    return held;
  });
  const release = (reading: string) =>
    units.write('ThreadWindows.release', (unit) =>
      Effect.gen(function* () {
        yield* unit.run(db.run(sql`delete from temp.thread_selection_member where reading = ${reading}`));
        yield* unit.run(db.run(sql`delete from temp.thread_selection where id = ${reading}`));
      }),
    );

  const pin = Effect.fn('ThreadWindows.pin')(function* (owner: string, homes: ListHomes, selection: ThreadSelection) {
    const reading = randomUUID();
    const project = homes.id;
    const clock = selection.view === 'archived' ? recordFacts.archivedAt : recordFacts.readerOrderAt;
    const insert = (ids?: readonly string[]) =>
      units.write('ThreadWindows.select', (unit) =>
        Effect.gen(function* () {
          yield* holding(unit, owner, project, reading);
          yield* unit.run(
            db.run(sql`insert into temp.thread_selection_member (reading, thread, order_at)
          select ${reading}, ${recordFacts.id}, ${clock} from ${recordFacts}
          left join ${thread} on ${thread.id} = ${recordFacts.id}
          where ${and(selected(owner, homes.projects, selection, listing.listed()), ids === undefined ? undefined : inArray(recordFacts.id, [...ids]))}`),
          );
        }),
      );
    return yield* Effect.gen(function* () {
      yield* units.write('ThreadWindows.open', (unit) =>
        Effect.gen(function* () {
          const evicted = sql`select id from temp.thread_selection order by rowid desc limit -1 offset ${HELD - 1}`;
          yield* unit.run(db.run(sql`delete from temp.thread_selection_member where reading in (${evicted})`));
          yield* unit.run(db.run(sql`delete from temp.thread_selection where id in (${evicted})`));
          yield* unit.run(db.run(sql`insert into temp.thread_selection (id, owner, project) values (${reading}, ${owner}, ${project})`));
        }),
      );
      if (selection.active === undefined) yield* insert();
      else {
        for (const home of homes.projects) {
          let after: string | undefined;
          let held: string | undefined;
          do {
            const page = yield* activity
              .threads({
                project: home,
                limit: PAGE,
                ids: selection.ids,
                since: selection.active.since?.getTime(),
                before: selection.active.before?.getTime(),
                after,
                reading: held,
              })
              .pipe(Effect.mapError((cause) => new ThreadStorageFailed({ call: 'activity.threads', cause })));
            if (page.threads.length > 0) yield* insert(page.threads);
            after = page.after ?? undefined;
            held = page.reading;
          } while (after !== undefined);
        }
      }
      yield* units.write('ThreadWindows.seal', (unit) =>
        Effect.gen(function* () {
          yield* holding(unit, owner, project, reading);
          yield* unit.run(
            db.run(sql`with ranked as (
          select thread, row_number() over (order by order_at desc, thread desc) as position
          from temp.thread_selection_member where reading = ${reading}
        ) update temp.thread_selection_member as member set position = ranked.position from ranked
          where member.reading = ${reading} and member.thread = ranked.thread`),
          );
          yield* unit.run(
            db.run(sql`update temp.thread_selection set total = (
          select count(*) from temp.thread_selection_member where reading = ${reading}
        ) where id = ${reading}`),
          );
        }),
      );
      return reading;
    }).pipe(Effect.onError(() => release(reading).pipe(Effect.orDie)));
  });

  const page = Effect.fn('ThreadWindows.page')(function* (owner: string, listId: number, reading: string, after: number, limit: number) {
    return yield* units.write('ThreadWindows.page', (unit) =>
      Effect.gen(function* () {
        const held = yield* holding(unit, owner, listId, reading);
        if (held.total === null) return yield* stale();
        const found = yield* unit.run(
          db.all<{ readonly thread: string }>(sql`
        select thread from temp.thread_selection_member where reading = ${reading} and position > ${after}
        order by position limit ${limit}`),
        );
        return { reading, total: held.total, ids: found.map((row) => row.thread) };
      }),
    );
  });
  return { pin, page };
});
