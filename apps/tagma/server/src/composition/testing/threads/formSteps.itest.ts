import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { threadStoreFixture } from '../threadStoreFixture.js';
import { join } from 'node:path';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Effect, FileSystem, Layer, Result, Schema } from 'effect';
import { sql } from 'drizzle-orm';
import { ThreadEntryKinds, makeThreadEntryReader, type ThreadEntryReader, type ThreadFormStep } from '@runlith/agent/transcript/kinds';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { bornThread } from '../../../native-harness/testing/born.js';
import { nativeOnlyParts } from '../../../native-harness/testing/rollout.js';
import {
  compressRollout,
  evictThreadProjection,
  exportThreadRollout,
  formedThread,
  journalSteps,
  rehydrateThreadRecords,
  restedReads,
  rolloutForms,
  threadProjection,
} from '../../../threads/testing/doubles.js';

const dated: ThreadFormStep = {
  name: '20261010170000_message_when',
  samples: { entry: { type: 'message', when: 'then' } },
  entry: (entry) => {
    if (entry.type !== 'message' || entry.when === undefined) return null;
    const { when, ...rest } = entry;
    return { ...rest, occurredAt: when };
  },
};

const kinds = makeThreadEntryReader({ products: [], steps: journalSteps([[dated]]) });
const at = new Date('2026-10-01T10:00:00.000Z');

const setup = Effect.fnUntraced(function* () {
  const fixture = yield* threadStoreFixture;
  const runtime = Context.add(Context.merge(fixture.context, yield* Layer.build(BunFileSystem.layer)), ThreadEntryKinds, kinds);
  const home = yield* Context.get(runtime, FileSystem.FileSystem).makeTempDirectoryScoped({ prefix: 'form-steps-' });

  const raise = Effect.fnUntraced(function* (threadId: string, form: 'old' | 'current', dir = home) {
    const { db } = yield* Effect.provide(MachineStore, runtime);
    yield* Effect.provide(
      bornThread(
        db,
        {
          id: threadId,
          ownerId: 'owner',
          agentId: 'tagma',
          authority: { mode: 'trust', bypassFrom: null },
          profile: null,
          spawnRootId: threadId,
          cacheGroup: threadId,
          provider: 'openai-oauth',
          status: 'idle',
          createdAt: at,
          updatedAt: at,
        },
        { projectId: fixture.projectId, title: threadId },
      ),
      runtime,
    );
    const entry = JSON.stringify(message(`${threadId}:m`, form));
    yield* Effect.provide(
      db.run(
        sql`insert into thread_event (thread_id, position, id, kind, payload) values (${threadId}, 1, ${`${threadId}:e`}, 'message', json_object('entry', json(${entry})))`,
      ),
      runtime,
    );
    yield* Effect.provide(
      db.run(sql`insert into thread_log (thread_id, history_through, entries_through) values (${threadId}, 1, 1)`),
      runtime,
    );
    yield* Effect.provide(
      db.run(
        sql`insert into thread_entry (thread_id, ord, entry_id, type, entry) values (${threadId}, 0, ${`${threadId}:m`}, 'message', ${entry})`,
      ),
      runtime,
    );
    yield* Effect.provide(
      db.run(
        sql`insert into thread_run (id, thread_id, owner_id, status, created_at, started_at, heartbeat_at, updated_at, stream_tail)
          values (${`${threadId}:run`}, ${threadId}, 'owner', 'aborted', 0, 0, 0, 0, json_array(json(${entry})))`,
      ),
      runtime,
    );
    const path = join(dir, `${threadId}.jsonl`);
    yield* Effect.provide(exportThreadRollout({ threadId, path, parts: nativeOnlyParts }), runtime);
    yield* Effect.provide(db.run(sql`update thread_rollout_form set step = null where thread_id = ${threadId}`), runtime);
    yield* Effect.provide(
      Effect.flatMap(threadProjection(kinds), (projection) => projection.run({ threadId, path })),
      runtime,
    );
    return path;
  });
  const owner = (reader: ThreadEntryReader = kinds) =>
    Effect.provide(
      rolloutForms((_threadId, work) => work, reader),
      runtime,
    );
  const returned = Effect.fnUntraced(function* (forms: Effect.Success<ReturnType<typeof owner>>, threadId: string, path: string) {
    expect(
      yield* Effect.provide(evictThreadProjection({ threadId, path, parts: nativeOnlyParts, returning: true }), runtime),
    ).toMatchObject({
      outcome: 'evicted',
    });
    const formed = yield* Effect.provide(Effect.result(forms.formedHere(threadId, path)), runtime);
    if (Result.isSuccess(formed)) yield* Effect.provide(rehydrateThreadRecords({ threadId, path, parts: nativeOnlyParts }), runtime);
    return formed;
  });
  const stored = Effect.fnUntraced(function* (threadId: string) {
    const { db } = yield* Effect.provide(MachineStore, runtime);
    const [mark] = yield* Effect.provide(
      db.all<{ step: string | null }>(sql`select step from thread_rollout_form where thread_id = ${threadId}`),
      runtime,
    );
    const events = yield* Effect.provide(
      db.all<{ payload: string }>(sql`select payload from thread_event where thread_id = ${threadId}`),
      runtime,
    );
    const entries = yield* Effect.provide(
      db.all<{ entry: string }>(sql`select entry from thread_entry where thread_id = ${threadId}`),
      runtime,
    );
    const tails = yield* Effect.provide(
      db.all<{ tail: string }>(sql`select stream_tail as tail from thread_run where thread_id = ${threadId}`),
      runtime,
    );
    return {
      step: mark?.step ?? null,
      events: yield* Effect.forEach(events, (row) =>
        Effect.map(
          Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ entry: Schema.Unknown })))(row.payload),
          (payload) => payload.entry,
        ),
      ),
      entries: yield* Effect.forEach(entries, (row) => Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(row.entry)),
      tails: yield* Effect.forEach(tails, (row) => Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(row.tail)),
    };
  });
  return { runtime, raise, owner, returned, stored, home, projectId: fixture.projectId };
});

const message = (id: string, form: 'old' | 'current') =>
  form === 'old'
    ? { type: 'message', id, role: 'user', text: 'hello', when: 'then' }
    : { type: 'message', id, role: 'user', text: 'hello', occurredAt: 'then' };

const lineSchema = Schema.fromJsonString(
  Schema.Struct({
    kind: Schema.optional(Schema.String),
    row: Schema.optional(Schema.Struct({ payload: Schema.optional(Schema.Struct({ entry: Schema.optional(Schema.Unknown) })) })),
  }),
);
const fileEntries = Effect.fn('testing.formedFileEntries')(function* (path: string) {
  const files = yield* FileSystem.FileSystem;
  const text = yield* files.readFileString(path);
  const records = yield* Effect.forEach(text.split('\n').filter(Boolean), (line) => Schema.decodeUnknownEffect(lineSchema)(line));
  return records.flatMap((record) =>
    record.kind === 'event' && record.row?.payload?.entry !== undefined ? [record.row.payload.entry] : [],
  );
});

it.live(
  'a thread whose mark lags is brought whole to the current form through its file and its return; its neighbour keeps its mark and its bytes',
  Effect.fnUntraced(function* () {
    const { runtime, raise, owner, returned, stored } = yield* setup();
    const path = yield* raise('t-lagging', 'old');
    const neighbour = yield* raise('t-neighbour', 'old');
    const untouched = yield* Context.get(runtime, FileSystem.FileSystem).readFileString(neighbour);
    const forms = yield* owner();
    const { db } = yield* Effect.provide(MachineStore, runtime);
    const reached = () =>
      Effect.provide(
        db.all<{ id: string }>(sql`select thread_id as id from thread_log
          where thread_id in ('t-lagging', 't-neighbour') and ${formedThread(sql`thread_log.thread_id`, kinds.last)}`),
        runtime,
      );
    expect(yield* Effect.provide(forms.lags('t-lagging'), runtime)).toBe(true);
    expect(yield* reached()).toEqual([]);
    expect(Result.isSuccess(yield* returned(forms, 't-lagging', path))).toBe(true);
    const current = message('t-lagging:m', 'current');
    expect(yield* stored('t-lagging')).toEqual({ step: dated.name, events: [current], entries: [current], tails: [[current]] });
    expect(yield* Effect.provide(fileEntries(path), runtime)).toEqual([current]);
    expect(yield* Effect.provide(forms.lags('t-lagging'), runtime)).toBe(false);
    expect(yield* reached()).toEqual([{ id: 't-lagging' }]);
    const old = message('t-neighbour:m', 'old');
    expect(yield* stored('t-neighbour')).toEqual({ step: null, events: [old], entries: [old], tails: [[old]] });
    expect(yield* Context.get(runtime, FileSystem.FileSystem).readFileString(neighbour)).toBe(untouched);
  }),
);

it.live(
  'a read of an offloaded thread whose mark lags answers in the current form, opens its compressed file unshaped and only queues the shaping',
  Effect.fnUntraced(function* () {
    const { runtime, raise, stored, home, projectId } = yield* setup();
    const files = Context.get(runtime, FileSystem.FileSystem);
    const path = yield* raise('t-read', 'old', join(home, String(projectId)));
    expect(
      yield* Effect.provide(evictThreadProjection({ threadId: 't-read', path, parts: nativeOnlyParts, returning: true }), runtime),
    ).toMatchObject({ outcome: 'evicted' });
    const bytes = yield* files.readFileString(path);
    yield* Effect.provide(compressRollout(path), runtime);
    const queued: string[] = [];
    const reads = yield* Effect.provide(
      restedReads(kinds, home, (threadId) => queued.push(threadId)),
      runtime,
    );
    const events = yield* Effect.provide(reads.events('t-read', { afterPosition: 0, head: 1, limit: 10 }), runtime);
    expect(events?.map((row) => row.payload.entry)).toEqual([message('t-read:m', 'current')]);
    expect(yield* files.readFileString(path)).toBe(bytes);
    expect((yield* stored('t-read')).step).toBeNull();
    expect(queued).toEqual(['t-read']);
  }),
);

it.live(
  'a record written to an offloaded thread while its file is staged stops that cast, and the next cast leaves the record as written',
  Effect.fnUntraced(function* () {
    const { runtime, raise, owner, stored } = yield* setup();
    const files = Context.get(runtime, FileSystem.FileSystem);
    const path = yield* raise('t-written', 'old');
    expect(
      yield* Effect.provide(evictThreadProjection({ threadId: 't-written', path, parts: nativeOnlyParts, returning: true }), runtime),
    ).toMatchObject({ outcome: 'evicted' });
    const forms = yield* owner();
    const written = `${JSON.stringify({
      kind: 'event',
      row: {
        threadId: 't-written',
        position: 2,
        id: 't-written:e2',
        kind: 'message',
        payload: { entry: message('t-written:m2', 'current') },
      },
    })}\n`;
    const first = yield* Effect.provide(forms.staged('t-written', path), runtime);
    yield* files.writeFileString(path, written, { flag: 'a' });
    const standing = yield* files.readFileString(path);
    expect((yield* Effect.provide(first!.commit, runtime)).kind).toBe('moved');
    expect(yield* files.readFileString(path)).toBe(standing);
    expect((yield* stored('t-written')).step).toBeNull();
    const second = yield* Effect.provide(forms.staged('t-written', path), runtime);
    expect((yield* Effect.provide(second!.commit, runtime)).kind).toBe('formed');
    expect((yield* stored('t-written')).step).toBe(dated.name);
    expect((yield* files.readFileString(path)).endsWith(written)).toBe(true);
    expect(yield* Effect.provide(fileEntries(path), runtime)).toEqual([
      message('t-written:m', 'current'),
      message('t-written:m2', 'current'),
    ]);
    expect(yield* files.exists(`${path}.staging`)).toBe(false);
  }),
);

it.live(
  'forming the file of a thread whose rows stand in the database leaves its file and its mark as they stood',
  Effect.fnUntraced(function* () {
    const { runtime, raise, owner, returned, stored } = yield* setup();
    const path = yield* raise('t-resident', 'old');
    const bytes = yield* Context.get(runtime, FileSystem.FileSystem).readFileString(path);
    const forms = yield* owner();
    expect(Result.isSuccess(yield* Effect.provide(Effect.result(forms.formedHere('t-resident', path)), runtime))).toBe(true);
    expect(yield* Context.get(runtime, FileSystem.FileSystem).readFileString(path)).toBe(bytes);
    expect((yield* stored('t-resident')).step).toBeNull();
    expect(yield* Effect.provide(forms.lags('t-resident'), runtime)).toBe(true);
  }),
);

it.live(
  'a step over the file meta alone forms a resident thread in place: its meta lines and mark move, its events and rows stay, nothing rests it',
  Effect.fnUntraced(function* () {
    const { runtime, raise, owner, stored } = yield* setup();
    const path = yield* raise('t-meta', 'current');
    const { db } = yield* Effect.provide(MachineStore, runtime);
    yield* Effect.provide(db.run(sql`update thread_rollout_form set step = ${dated.name} where thread_id = 't-meta'`), runtime);
    const marked: ThreadFormStep = {
      name: '20261010180000_meta_marked',
      samples: { meta: { record: {} } },
      meta: (meta) => (meta.marked === undefined ? { ...meta, marked: true } : null),
    };
    const files = Context.get(runtime, FileSystem.FileSystem);
    const lines = (text: string) => text.split('\n').filter(Boolean);
    const before = lines(yield* files.readFileString(path));
    const rows = yield* stored('t-meta');
    const forms = yield* owner(makeThreadEntryReader({ products: [], steps: journalSteps([[dated, marked]]) }));
    expect(Result.isSuccess(yield* Effect.provide(Effect.result(forms.formedHere('t-meta', path)), runtime))).toBe(true);
    const after = lines(yield* files.readFileString(path));
    const events = (all: readonly string[]) => all.filter((line) => line.startsWith('{"kind":"event",'));
    expect(events(after)).toEqual(events(before));
    expect(after.filter((line) => !line.startsWith('{"kind":"event",')).every((line) => line.includes('"marked":true'))).toBe(true);
    expect(yield* stored('t-meta')).toEqual({ ...rows, step: marked.name });
    const [cursor] = yield* Effect.provide(
      db.all<{ rested: number | null }>(sql`select rested_at as rested from thread_rollout_cursor where thread_id = 't-meta'`),
      runtime,
    );
    expect(cursor?.rested ?? null).toBeNull();
  }),
);

it.live(
  'a thread below the folded base is refused naming the release that brings it there, and nothing records the refusal',
  Effect.fnUntraced(function* () {
    const { runtime, raise, owner, returned, stored } = yield* setup();
    const path = yield* raise('t-older', 'old');
    const folded = makeThreadEntryReader({ products: [], base: { step: dated.name, release: '0.2.0' } });
    const forms = yield* owner(folded);
    const formed = yield* returned(forms, 't-older', path);
    const read = yield* Effect.provide(Effect.result(forms.readable('t-older', path)), runtime);
    for (const refused of [formed, read])
      expect(Result.isFailure(refused) && refused.failure._tag === 'RolloutUnformable' && refused.failure.older).toEqual({
        step: dated.name,
        release: '0.2.0',
      });
    expect(folded.last).toBe(dated.name);
    const { db } = yield* Effect.provide(MachineStore, runtime);
    const [mark] = yield* Effect.provide(
      db.all<{ step: string | null; refusal: string | null }>(
        sql`select step, refusal from thread_rollout_form where thread_id = 't-older'`,
      ),
      runtime,
    );
    expect(mark?.refusal ?? null).toBeNull();
  }),
);

it.live(
  'a step refused on a record kept beside the journal refuses the whole forming, and the mark stays behind',
  Effect.fnUntraced(function* () {
    const { runtime, raise, owner, returned, stored } = yield* setup();
    const path = yield* raise('t-tail', 'current');
    const { db } = yield* Effect.provide(MachineStore, runtime);
    yield* Effect.provide(
      db.run(
        sql`update thread_run set stream_tail = json_array(json(${JSON.stringify({ type: 'reasoning', id: 't-tail:r', text: 'mulling' })})) where thread_id = 't-tail'`,
      ),
      runtime,
    );
    const rewording: ThreadFormStep = {
      name: '20261010170000_reasoning_text',
      samples: { entry: { type: 'reasoning', text: 'mulling' } },
      entry: (entry) => (entry.type === 'reasoning' && entry.text === 'mulling' ? { ...entry, text: 'thinking' } : null),
    };
    const formed = yield* returned(
      yield* owner(makeThreadEntryReader({ products: [], steps: journalSteps([[rewording]]) })),
      't-tail',
      path,
    );
    expect(Result.isFailure(formed) && formed.failure._tag).toBe('RolloutUnformable');
    const [mark] = yield* Effect.provide(
      db.all<{ step: string | null; refusal: string | null }>(
        sql`select step, refusal from thread_rollout_form where thread_id = 't-tail'`,
      ),
      runtime,
    );
    expect(mark?.step ?? null).toBeNull();
    expect(mark?.refusal).not.toBeNull();
  }),
);
