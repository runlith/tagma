import { expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from '@runlith/effect-test';
import { heldPool } from '@runlith/sqlite-process/testing/pool';
import { Duration, Effect, Layer } from 'effect';
import { TestClock } from 'effect/testing';
import { activity, note } from '../Activity';
import { activityKind } from '../fact';
import { ActivityLog } from '../log';
import { MODEL_CALL } from '../modelCall';
import { ActivityStore, activityPreparationLayer, activityStoreLayer } from './ActivityStore';
import { ActivityRecord, type ActivityRowsQuery } from './record';
import type { Keeping } from './upkeep';

const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url));
const EVER = Number.MAX_SAFE_INTEGER;

const place = Effect.acquireRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), 'activity-store-'))),
  (root) => Effect.sync(() => rmSync(root, { recursive: true, force: true })),
);

const storeAt = (root: string, keeping: Keeping = { hours: 24, bodiesMaxBytes: 24 * 1024 }, pendingMax?: number) =>
  Layer.unwrap(
    Effect.map(heldPool, (processes) =>
      Layer.orDie(
        activityStoreLayer({
          database: join(root, 'activity.sqlite'),
          bodies: join(root, 'bodies'),
          migrations: MIGRATIONS,
          pendingMax,
          keeping: () => keeping,
          processes,
          projectsOf: (threads) => Effect.succeed(new Map(threads.map((thread) => [thread, thread === 'thread-a' ? 7 : null]))),
        }).pipe(Layer.provideMerge(TestClock.layer()), Layer.provide(activityPreparationLayer)),
      ),
    ),
  );

const store = (keeping?: Keeping, pendingMax?: number) => Layer.unwrap(Effect.map(place, (root) => storeAt(root, keeping, pendingMax)));

const pause = (ms: number) => TestClock.withLive(Effect.sleep(ms));

const recorded = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.flatMap(ActivityStore, (held) => Effect.andThen(effect.pipe(Effect.provideService(ActivityLog, held.log)), held.settled));

const rows = (query: Partial<ActivityRowsQuery> & Pick<ActivityRowsQuery, 'paths'>) =>
  Effect.flatMap(ActivityRecord, (record) => record.rows({ threads: ['thread-a'], through: EVER, where: [], limit: 50, ...query }));

const encoded = (document: unknown, kind = 'request') => ({
  kind,
  encoded: new TextEncoder().encode(JSON.stringify(document)),
  contentType: 'application/json',
  series: true as const,
});

const asked = (messages: readonly string[], response: unknown) =>
  recorded(
    activity(MODEL_CALL, { provider: 'subscription', model: 'opus', rung: 'high' }, note({ type: 'http-started' }), {
      thread: 'thread-a',
      bodies: [encoded({ model: 'opus', system: 's'.repeat(600), messages })],
      ended: () => ({
        result: { usage: { inputTokens: 10, outputTokens: 2 }, finish: 'stop' },
        bodies: [{ kind: 'response', encoded: new TextEncoder().encode(JSON.stringify(response)), contentType: 'application/json' }],
      }),
    }),
  );

it.live(
  'a model call reads back with its usage, notes and bodies, and the next request of its thread is kept as a delta that reads whole',
  () =>
    Effect.gen(function* () {
      yield* Effect.andThen(asked(['first'], { text: 'hi' }), TestClock.adjust(Duration.millis(1)));
      yield* asked(['first', 'second'], { text: 'x'.repeat(2000) });
      const read = yield* rows({ paths: ['id', 'kind', 'outcome', 'provider', 'usage.inputTokens', 'notes', 'bodies'] });
      const [first, second] = read.rows.map((row) => row.values);
      expect(second).toMatchObject({ kind: 'model-call', outcome: 'ok', provider: 'subscription', 'usage.inputTokens': 10 });
      expect(second!.notes).toMatchObject([{ type: 'http-started' }]);
      const bodies = (row: typeof first) =>
        row!.bodies as readonly { readonly kind: string; readonly state: string; readonly bytes: number; readonly size: number }[];
      expect(bodies(second).map(({ kind, state }) => [kind, state])).toEqual([
        ['request', 'written'],
        ['response', 'declined'],
      ]);
      expect(bodies(second)[0]!.bytes).toBeLessThan(bodies(first)[0]!.bytes / 4);
      expect(bodies(second)[0]!.size).toBeGreaterThan(bodies(first)[0]!.size);
      const request = yield* Effect.flatMap(ActivityRecord, (record) => record.body(String(second!.id), 1, 1 << 20));
      expect(JSON.parse(request.text)).toEqual({ model: 'opus', system: 's'.repeat(600), messages: ['first', 'second'] });
    }).pipe(Effect.provide(store())),
);

it.live('a body acknowledgement keeps its reserved slot through fact overflow and its successor reads whole', () =>
  Effect.gen(function* () {
    const held = yield* ActivityStore;
    for (const id of ['body-a', 'body-b'])
      held.log.record({
        _tag: 'Opened',
        id,
        at: 0,
        parent: null,
        thread: 'thread-a',
        run: null,
        project: null,
        kind: 'work',
        actor: { kind: 'operator' },
        trigger: null,
        attrs: {},
      });
    yield* held.settled;
    held.log.record({
      _tag: 'Bodied',
      activity: 'body-a',
      n: 1,
      at: 0,
      thread: 'thread-a',
      body: encoded({ system: 's'.repeat(600), messages: ['first'] }),
    });
    for (let item = 0; item < 2; item += 1) held.log.record({ _tag: 'Noted', activity: 'body-a', at: 0, note: { type: 'competing-fact' } });
    yield* held.settled;
    const first = yield* rows({ paths: ['id', 'bodies'] });
    expect(first.rows.find((row) => row.values.id === 'body-a')?.values.bodies).toMatchObject([{ state: 'written' }]);
    expect(first.lost).toContainEqual(expect.objectContaining({ cause: 'pending-full', facts: 1, bodies: 0 }));
    held.log.record({
      _tag: 'Bodied',
      activity: 'body-b',
      n: 1,
      at: 0,
      thread: 'thread-a',
      body: encoded({ system: 's'.repeat(600), messages: ['first', 'second'] }),
    });
    yield* held.settled;
    const next = yield* Effect.flatMap(ActivityRecord, (record) => record.body('body-b', 1, 50 * 1024));
    expect(JSON.parse(next.text)).toEqual({ system: 's'.repeat(600), messages: ['first', 'second'] });
    for (let item = 0; item < 2; item += 1) held.log.record({ _tag: 'Noted', activity: 'body-b', at: 0, note: { type: 'full' } });
    const refused = encoded({ system: 's'.repeat(600), messages: ['first', 'second', 'refused'] });
    held.log.record({ _tag: 'Bodied', activity: 'body-b', n: 2, at: 0, thread: 'thread-a', body: refused });
    yield* held.settled;
    const lost = yield* rows({ paths: ['id'] });
    expect(lost.lost).toContainEqual(
      expect.objectContaining({ cause: 'body-metadata-full', facts: 0, bodies: 1, bytes: refused.encoded.byteLength }),
    );
    held.log.record({
      _tag: 'Bodied',
      activity: 'body-b',
      n: 3,
      at: 0,
      thread: 'thread-a',
      body: encoded({ system: 's'.repeat(600), messages: ['first', 'second', 'kept'] }),
    });
    yield* held.settled;
    const retained = yield* Effect.flatMap(ActivityRecord, (record) => record.body('body-b', 3, 50 * 1024));
    expect(JSON.parse(retained.text).messages).toEqual(['first', 'second', 'kept']);
  }).pipe(Effect.provide(store({ hours: 24, bodiesMaxBytes: 24 * 4096 }, 2))),
);

it.live('a request past the chain reader horizon reads back whole', () =>
  Effect.gen(function* () {
    const messages: string[] = [];
    for (let turn = 0; turn < 66; turn += 1) {
      messages.push(`turn ${turn}`);
      yield* Effect.andThen(asked([...messages], { text: 'ok' }), TestClock.adjust(Duration.millis(1)));
    }
    const read = yield* rows({ paths: ['id'], order: { by: 'openedAt', dir: 'desc' }, limit: 1 });
    const request = yield* Effect.flatMap(ActivityRecord, (record) => record.body(String(read.rows[0]!.values.id), 1, 1 << 20));
    expect(JSON.parse(request.text).messages).toEqual(messages);
  }).pipe(Effect.provide(store({ hours: 24, bodiesMaxBytes: 24 * 4096 }))),
);

const TOOL = activityKind<{ readonly toolName: string }>('tool-call');

it.live('the record filters, groups and sums in its store, and names the facts it lost', () =>
  Effect.gen(function* () {
    const tool = (toolName: string, ms: number) =>
      recorded(activity(TOOL, { toolName }, Effect.andThen(TestClock.adjust(Duration.millis(ms)), Effect.void), { thread: 'thread-a' }));
    yield* Effect.all([tool('read', 5), tool('read', 1), tool('edit', 3)], { discard: true });
    yield* asked(['first'], { text: 'hi' });
    yield* Effect.flatMap(ActivityStore, (held) =>
      Effect.andThen(
        Effect.sync(() => held.log.record({ _tag: 'Noted', activity: { run: 'run-unknown' }, at: 1, note: { type: 'stray' } })),
        held.settled,
      ),
    );

    const grouped = yield* Effect.flatMap(ActivityRecord, (record) =>
      record.groups({
        threads: ['thread-a'],
        through: EVER,
        where: [],
        group: ['kind', 'attrs.toolName'],
        count: true,
        sum: ['usage.inputTokens'],
        order: { by: 'count', dir: 'desc' },
        offset: 0,
        limit: 10,
      }),
    );
    expect(grouped.groups.map(({ by, absent, count, sum, unknown }) => ({ by, absent, count, sum, unknown }))).toEqual([
      { by: { kind: 'tool-call', 'attrs.toolName': 'read' }, absent: [], count: 2, sum: {}, unknown: { 'usage.inputTokens': 2 } },
      { by: { kind: 'model-call' }, absent: ['attrs.toolName'], count: 1, sum: { 'usage.inputTokens': 10 }, unknown: {} },
      { by: { kind: 'tool-call', 'attrs.toolName': 'edit' }, absent: [], count: 1, sum: {}, unknown: { 'usage.inputTokens': 1 } },
    ]);
    expect(grouped.matched).toBe(4);
    expect(grouped.lost).toEqual([{ scope: 'global', unknown: false, cause: 'unattached', facts: 1, bodies: 0, bytes: 0 }]);

    const slow = yield* rows({
      paths: ['attrs.toolName', 'durationMs'],
      where: [
        { path: 'attrs.toolName', op: 'contains', value: 'EA' },
        { path: 'durationMs', op: 'gte', value: 2 },
      ],
      order: { by: 'durationMs', dir: 'desc' },
    });
    expect(slow.rows.map((row) => row.values)).toEqual([{ 'attrs.toolName': 'read', durationMs: 5 }]);
    expect(slow.matched).toBe(1);
  }).pipe(Effect.provide(store())),
);

it.live('work placed under a run and its children written in one batch form a tree under the run root', () =>
  Effect.gen(function* () {
    const TITLE = activityKind('title');
    yield* Effect.flatMap(ActivityStore, (held) =>
      Effect.andThen(
        Effect.sync(() =>
          held.log.record({
            _tag: 'Opened',
            id: 'run-1',
            at: 0,
            parent: null,
            thread: 'thread-a',
            run: 'run-1',
            project: null,
            kind: 'run',
            actor: { kind: 'thread', id: 'thread-a' },
            trigger: null,
            attrs: {},
          }),
        ),
        held.settled,
      ),
    );
    yield* TestClock.adjust(Duration.seconds(1));
    yield* recorded(
      activity(TITLE, {}, activity(MODEL_CALL, { provider: 'subscription', model: 'opus', rung: 'low' }, Effect.void), {
        thread: 'thread-a',
        run: 'run-1',
        parent: { run: 'run-1' },
      }),
    );
    const read = yield* rows({ paths: ['id', 'kind', 'parent'], order: { by: 'openedAt', dir: 'asc' } });
    const byKind = new Map(read.rows.map((row) => [row.values.kind, row.values]));
    expect(byKind.get('run')?.parent).toBeNull();
    expect(byKind.get('title')?.parent).toBe('run-1');
    expect(byKind.get('model-call')?.parent).toBe(byKind.get('title')?.id);
  }).pipe(Effect.provide(store())),
);

it.live('an activity left open by an earlier process is ended orphaned when its store opens again', () =>
  Effect.gen(function* () {
    const root = yield* place;
    yield* Effect.flatMap(ActivityStore, (held) =>
      Effect.andThen(
        Effect.sync(() =>
          held.log.record({
            _tag: 'Opened',
            id: 'run-1',
            at: 1_000,
            parent: null,
            thread: 'thread-a',
            run: 'run-1',
            project: null,
            kind: 'run',
            actor: { kind: 'thread', id: 'thread-a' },
            trigger: null,
            attrs: {},
          }),
        ),
        held.settled,
      ),
    ).pipe(Effect.provide(storeAt(root)));
    const read = yield* rows({ paths: ['id', 'outcome'] }).pipe(Effect.provide(storeAt(root)));
    expect(read.rows.map((row) => row.values)).toEqual([{ id: 'run-1', outcome: 'orphaned' }]);
  }),
);

it.live('a retained request keeps its required base when the retention cutoff crosses the middle of its hour', () =>
  Effect.gen(function* () {
    yield* asked(['base'], 'old');
    yield* TestClock.adjust(Duration.minutes(30));
    yield* asked(['base', 'retained'], 'kept');
    const latest = yield* rows({ paths: ['id'], order: { by: 'openedAt', dir: 'desc' }, limit: 1 });
    const id = String(latest.rows[0]!.values.id);
    yield* TestClock.adjust(Duration.minutes(50));
    for (let turn = 0; turn < 20; turn += 1) {
      const page = yield* rows({ paths: ['id'] });
      if (page.total === 1) break;
      yield* TestClock.adjust(Duration.minutes(5));
      yield* pause(10);
    }
    const page = yield* rows({ paths: ['id'] });
    expect(page.rows.map((row) => row.values.id)).toEqual([id]);
    const request = yield* Effect.flatMap(ActivityRecord, (record) => record.body(id, 1, 1 << 20));
    expect(JSON.parse(request.text).messages).toEqual(['base', 'retained']);
  }).pipe(Effect.provide(store({ hours: 1, bodiesMaxBytes: 4000 }))),
);

it.live('a write racing bucket eviction is either readable or explicitly evicted, never written with a missing file', () =>
  Effect.gen(function* () {
    yield* asked(['first'], 'x'.repeat(300));
    yield* asked(['first', 'second'], 'x'.repeat(300));
    yield* Effect.andThen(TestClock.adjust(Duration.minutes(5)), asked(['first', 'second', 'third'], 'x'.repeat(300)));
    for (let turn = 0; turn < 20; turn += 1) {
      const page = yield* rows({ paths: ['id', 'bodies'], order: { by: 'openedAt', dir: 'desc' } });
      if (page.lost.some((loss) => loss.cause === 'ceiling')) break;
      yield* TestClock.adjust(Duration.minutes(5));
      yield* pause(10);
    }
    const page = yield* rows({ paths: ['id', 'bodies'] });
    expect(page.lost.some((loss) => loss.cause === 'ceiling')).toBe(true);
    for (const row of page.rows) {
      const bodies = row.values.bodies as readonly { readonly n: number; readonly state: string }[];
      for (const body of bodies) {
        const read = yield* Effect.result(Effect.flatMap(ActivityRecord, (record) => record.body(String(row.values.id), body.n, 1 << 20)));
        if (body.state === 'written') expect(read._tag).toBe('Success');
        else {
          expect(body.state).toBe('evicted');
          expect(read._tag).toBe('Failure');
        }
      }
    }
  }).pipe(Effect.provide(store({ hours: 1, bodiesMaxBytes: 1200 }))),
);

it.live(
  'upkeep evicts the oldest body hour past the budget with a loss, a request after it is kept whole, and rows past their hours go',
  () =>
    Effect.gen(function* () {
      const record = <A>(read: (record: ActivityRecord['Service']) => Effect.Effect<A, unknown>) => Effect.flatMap(ActivityRecord, read);
      const everything = { threads: ['thread-a'], through: EVER, where: [] } as const;
      const until = Effect.fnUntraced(function* (check: Effect.Effect<boolean, unknown, ActivityRecord>) {
        for (let tries = 0; tries < 100; tries += 1) {
          if (yield* check) return;
          yield* TestClock.adjust(Duration.minutes(5));
          yield* pause(20);
        }
        return yield* Effect.die('The store did not reach the expected state.');
      });
      yield* asked(['a'.repeat(500)], 'x'.repeat(1_500));
      const first = (yield* record((held) => held.rows({ ...everything, paths: ['id'], limit: 1 }))).rows[0]!.values.id;
      yield* until(
        Effect.map(
          record((held) => held.groups({ ...everything, group: [], count: true, sum: [], offset: 0, limit: 1 })),
          (read) => read.lost.length > 0,
        ),
      );
      const evicted = yield* record((held) => held.groups({ ...everything, group: [], count: true, sum: [], offset: 0, limit: 1 }));
      expect(evicted.lost).toEqual([{ scope: 'global', unknown: false, cause: 'ceiling', facts: 0, bodies: 2, bytes: expect.any(Number) }]);

      yield* asked(['a'.repeat(500), 'c'], 'c');
      const last = (yield* record((held) => held.rows({ ...everything, paths: ['id'], limit: 2 }))).rows.find(
        (row) => row.values.id !== first,
      )!;
      const request = yield* record((held) => held.body(String(last.values.id), 1, 1 << 20));
      expect(JSON.parse(request.text).messages).toEqual(['a'.repeat(500), 'c']);

      yield* TestClock.adjust(Duration.hours(3));
      yield* until(
        Effect.map(
          record((held) => held.rows({ ...everything, paths: ['id'], limit: 1 })),
          (read) => read.rows.length === 0,
        ),
      );
    }).pipe(Effect.provide(store({ hours: 1, bodiesMaxBytes: 2_000 }))),
);

it.live('a continued reading the store has let go refuses instead of reopening over what remains', () =>
  Effect.gen(function* () {
    const page = (query: Partial<ActivityRowsQuery>) =>
      Effect.flatMap(ActivityRecord, (record) =>
        record.rows({ threads: ['thread-a'], through: EVER, where: [], paths: ['id'], limit: 1, ...query }),
      );
    yield* asked(['a'], 'one');
    yield* asked(['a', 'b'], 'two');
    const first = yield* page({ reading: 'held' });
    expect(first.more).toBe(true);
    yield* TestClock.adjust(Duration.hours(3));
    for (let tries = 0; (yield* page({})).total > 0; tries += 1) {
      if (tries > 100) return yield* Effect.die('The store did not let the hour go.');
      yield* TestClock.adjust(Duration.minutes(5));
      yield* pause(20);
    }
    const continued = yield* Effect.flip(page({ reading: 'held', resumed: true, offset: first.next }));
    expect(continued).toMatchObject({ _tag: 'ActivityUnreadable', reason: expect.stringContaining('expired') });
  }).pipe(Effect.provide(store({ hours: 1, bodiesMaxBytes: 24 * 1024 }))),
);
