import { afterAll, expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect, Layer, Result } from 'effect';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { sql } from 'drizzle-orm';
import { ThreadEntryKinds, makeThreadEntryReader, type ThreadEntryReader, type ThreadFormStep } from '@runlith/agent/transcript/kinds';
import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { unitsLayer } from '../../platform/store/units.js';
import { storeLayer } from '../../platform/store/open.js';
import { makeRolloutForms } from './rolloutForming.js';
import { stagedHere } from '../testing/doubles.js';

const root = mkdtempSync(join(tmpdir(), 'rollout-publication-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const machine = Layer.orDie(
  unitsLayer(MachineUnits, MachineStore).pipe(
    Layer.provideMerge(storeLayer(MachineStore, join(root, 'tagma.sqlite'), fixtureMigrations, { readers: 0 }, sharedPool)),
  ),
);
const step: ThreadFormStep = {
  name: '20260101000000_text',
  samples: { entry: { text: 'before' } },
  entry: (entry) => (entry.text === 'before' ? { ...entry, text: 'after' } : null),
};
const reader = makeThreadEntryReader({ products: [], steps: [step] });
const text = (id: string, body: string) =>
  `${JSON.stringify({ kind: 'meta', meta: { record: { id } } })}\n${JSON.stringify({
    kind: 'event',
    row: {
      position: 1,
      id: `${id}:event`,
      kind: 'message',
      payload: { entry: { type: 'message', id: `${id}:entry`, role: 'assistant', text: body } },
    },
  })}\n`;
const plant = Effect.fnUntraced(function* (id: string, bytes: number, publishing?: string) {
  const { db } = yield* MachineStore;
  yield* db.run(
    sql`insert into thread (id, origin, spawn_root_id, principal_id, agent_id, reader_order_at, created_at) values (${id}, 'unscoped', ${id}, 'p', 'a', 0, 0)`,
  );
  yield* db.run(
    sql`insert into thread_rollout_cursor (thread_id, next_byte_offset, next_position, rested_at) values (${id}, ${bytes}, 2, 0)`,
  );
  if (publishing !== undefined)
    yield* db.run(
      sql`insert into thread_rollout_form (thread_id, formed_at, publishing, step) values (${id}, 0, ${publishing}, ${step.name})`,
    );
});
const formed = (kinds: ThreadEntryReader, id: string, path: string) =>
  makeRolloutForms({ journal: (_id, work) => work, stage: stagedHere }).pipe(
    Effect.provideService(ThreadEntryKinds, kinds),
    Effect.flatMap((forms) => forms.formedHere(id, path)),
  );

layer(machine)('rollout publication', (it) => {
  it.effect('a baseline file without a mark is current when the step list is empty and is not rewritten', () =>
    Effect.gen(function* () {
      const id = 'baseline';
      const path = join(root, `${id}.jsonl`);
      const bytes = text(id, 'current');
      writeFileSync(path, bytes);
      yield* plant(id, Buffer.byteLength(bytes));
      yield* formed(makeThreadEntryReader({ products: [] }), id, path);
      expect(readFileSync(path, 'utf8')).toBe(bytes);
      const { db } = yield* MachineStore;
      expect(yield* db.all(sql`select step from thread_rollout_form where thread_id = ${id}`)).toEqual([]);
    }),
  );

  it.effect('a publication interrupted after rename settles the recorded cursor and mark once', () =>
    Effect.gen(function* () {
      const id = 'renamed';
      const path = join(root, `${id}.jsonl`);
      const bytes = text(id, 'after');
      writeFileSync(path, bytes);
      const publishing = JSON.stringify({
        sha256: createHash('sha256').update(bytes).digest('hex'),
        cursorBytes: Buffer.byteLength(bytes),
        refusalBytes: null,
      });
      yield* plant(id, 1, publishing);
      yield* formed(reader, id, path);
      yield* formed(reader, id, path);
      const { db } = yield* MachineStore;
      expect({
        cursor: yield* db.all(sql`select next_byte_offset as bytes, generation from thread_rollout_cursor where thread_id = ${id}`),
        mark: yield* db.all(sql`select publishing, step from thread_rollout_form where thread_id = ${id}`),
      }).toEqual({ cursor: [{ bytes: Buffer.byteLength(bytes), generation: 1 }], mark: [{ publishing: null, step: step.name }] });
      expect(readFileSync(path, 'utf8')).toBe(bytes);
    }),
  );

  it.effect('a read of a publication interrupted before rename at the folded base is refused, and the file stands as it did', () =>
    Effect.gen(function* () {
      const id = 'unrenamed-base';
      const path = join(root, `${id}.jsonl`);
      const before = text(id, 'before');
      writeFileSync(path, before);
      const publishing = JSON.stringify({
        sha256: createHash('sha256').update(text(id, 'after')).digest('hex'),
        cursorBytes: Buffer.byteLength(text(id, 'after')),
        refusalBytes: null,
      });
      yield* plant(id, Buffer.byteLength(before), publishing);
      const folded = makeThreadEntryReader({ products: [], base: { step: step.name, release: '0.2.0' } });
      const read = yield* makeRolloutForms({ journal: (_id, work) => work, stage: stagedHere }).pipe(
        Effect.provideService(ThreadEntryKinds, folded),
        Effect.flatMap((forms) => Effect.result(forms.readable(id, path))),
      );
      expect(Result.isFailure(read) && read.failure._tag === 'RolloutUnformable' && read.failure.older).toEqual({
        step: step.name,
        release: '0.2.0',
      });
      expect(readFileSync(path, 'utf8')).toBe(before);
    }),
  );

  it.effect('a publication interrupted before rename re-applies its steps to the standing file and moves the cursor', () =>
    Effect.gen(function* () {
      const id = 'unrenamed';
      const path = join(root, `${id}.jsonl`);
      const before = text(id, 'before');
      const after = text(id, 'after');
      writeFileSync(path, before);
      const publishing = JSON.stringify({
        sha256: createHash('sha256').update(after).digest('hex'),
        cursorBytes: Buffer.byteLength(after),
        refusalBytes: null,
      });
      yield* plant(id, Buffer.byteLength(before), publishing);
      yield* formed(reader, id, path);
      const { db } = yield* MachineStore;
      const state = {
        cursor: yield* db.all(sql`select next_byte_offset as bytes from thread_rollout_cursor where thread_id = ${id}`),
        mark: yield* db.all(sql`select publishing, step from thread_rollout_form where thread_id = ${id}`),
      };
      expect(readFileSync(path, 'utf8')).toBe(after);
      expect(state).toEqual({ cursor: [{ bytes: Buffer.byteLength(after) }], mark: [{ publishing: null, step: step.name }] });
    }),
  );
});
