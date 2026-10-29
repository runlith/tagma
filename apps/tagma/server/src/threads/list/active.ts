import { randomUUID } from 'node:crypto';
import { ActivityRecord } from '@runlith/activity/store/record';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import { and, inArray, sql } from 'drizzle-orm';
import { Effect } from 'effect';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { recordFacts } from '../../thread-record/facts.js';
import { thread } from '../store/kernel.js';
import { ThreadInputRefused } from '../contract/service/failure.js';
import { selected, type ThreadSelection } from './select.js';

const HELD = 256;
const PAGE = 50;

export const makeThreadSelections = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const activity = yield* ActivityRecord;
  yield* units.write('ThreadWindows.prepare', (unit) =>
    Effect.gen(function* () {
      yield* unit.run(
        db.run(sql`create temp table if not exists thread_selection (
        id text primary key, owner text not null, project integer not null, total integer
      )`),
      );
      yield* unit.run(
        db.run(sql`create temp table if not exists thread_selection_member (
        reading text not null, thread text not null, order_at integer not null, primary key (reading, thread)
      )`),
      );
      yield* unit.run(
        db.run(sql`create index if not exists temp.thread_selection_order
        on thread_selection_member (reading, order_at desc, thread desc)`),
      );
    }),
  );

  const pin = Effect.fn('ThreadWindows.pin')(function* (owner: string, project: number, selection: ThreadSelection) {
    const reading = randomUUID();
    const clock = selection.view === 'archived' ? recordFacts.archivedAt : recordFacts.readerOrderAt;
    const insert = (ids?: readonly string[]) =>
      units.write('ThreadWindows.select', (unit) =>
        unit.run(
          db.run(sql`insert into temp.thread_selection_member (reading, thread, order_at)
          select ${reading}, ${recordFacts.id}, ${clock} from ${recordFacts}
          left join ${thread} on ${thread.id} = ${recordFacts.id}
          where ${and(selected(owner, project, selection), ids === undefined ? undefined : inArray(recordFacts.id, [...ids]))}`),
        ),
      );
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
      let after: string | undefined;
      let held: string | undefined;
      do {
        const page = yield* activity
          .threads({
            project,
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
    yield* units.write('ThreadWindows.seal', (unit) =>
      unit.run(
        db.run(sql`update temp.thread_selection set total = (
        select count(*) from temp.thread_selection_member where reading = ${reading}
      ) where id = ${reading}`),
      ),
    );
    return reading;
  });

  const page = Effect.fn('ThreadWindows.page')(function* (owner: string, project: number, reading: string, offset: number, limit: number) {
    return yield* units.write('ThreadWindows.page', (unit) =>
      Effect.gen(function* () {
        const [held] = yield* unit.run(
          db.all<{ readonly total: number | null }>(sql`
          select total from temp.thread_selection where id = ${reading} and owner = ${owner} and project = ${project}`),
        );
        if (held === undefined || held.total === null)
          return yield* new ThreadInputRefused('cursor-stale', 'This thread selection is no longer held.', [
            'open the thread listing again without a cursor',
          ]);
        const found = yield* unit.run(
          db.all<{ readonly thread: string }>(sql`
          select thread from temp.thread_selection_member where reading = ${reading}
          order by order_at desc, thread desc limit ${limit} offset ${offset}`),
        );
        return { reading, total: held.total, ids: found.map((row) => row.thread) };
      }),
    );
  });
  return { pin, page };
});
