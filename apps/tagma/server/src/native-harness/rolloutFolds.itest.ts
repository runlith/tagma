import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect, Layer } from 'effect';
import { sql } from 'drizzle-orm';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { ThreadEntryKinds, makeThreadEntryReader } from '@runlith/agent/transcript/kinds';
import { fixtureMigrations } from '../composition/testing/migrations.js';
import { MachineStore } from '../platform/contract/service/store.js';
import { MachineUnits } from '../platform/contract/service/units.js';
import { unitsLayer } from '../platform/store/units.js';
import { seededStoreLayer } from '../platform/store/open.js';
import { rolloutForms } from '../threads/testing/doubles.js';
import { nativeFolds } from './rolloutFolds.js';

const machine = Layer.orDie(
  unitsLayer(MachineUnits, MachineStore).pipe(Layer.provideMerge(seededStoreLayer(MachineStore, fixtureMigrations, {}, sharedPool))),
);

const TEXT_CONTENT = '20261010170000_text_content';

const onTheLoop = makeThreadEntryReader({
  products: [],
  steps: [
    {
      name: TEXT_CONTENT,
      samples: { message: { role: 'user', content: 'before' } },
      message: () => {
        throw new Error('a journal line was formed on the server loop');
      },
    },
  ],
  worker: () => new Worker(new URL('./testing/formed.worker.ts', import.meta.url), { type: 'module' }),
});

const scratch = Effect.acquireRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), 'rollout-stage-'))),
  (root) => Effect.sync(() => rmSync(root, { recursive: true, force: true })),
);

layer(machine)('native rollout folds', (it) => {
  it.effect('a lagging rollout is formed by the reader worker, never by the reader on the server loop', () =>
    Effect.gen(function* () {
      const id = 'staged';
      const path = join(yield* scratch, `${id}.jsonl`);
      const event = { position: 1, id: `${id}:event`, kind: 'message', payload: { messages: [{ role: 'user', content: 'law' }] } };
      const bytes = `${JSON.stringify({ kind: 'meta', meta: { record: { id } } })}\n${JSON.stringify({ kind: 'event', row: event })}\n`;
      writeFileSync(path, bytes);
      const { db } = yield* MachineStore;
      yield* db.run(
        sql`insert into thread (id, origin, spawn_root_id, principal_id, agent_id, reader_order_at, created_at) values (${id}, 'unscoped', ${id}, 'p', 'a', 0, 0)`,
      );
      yield* db.run(
        sql`insert into thread_rollout_cursor (thread_id, next_byte_offset, next_position, rested_at) values (${id}, ${Buffer.byteLength(bytes)}, 2, 0)`,
      );
      const forms = yield* rolloutForms((_threadId, work) => work, onTheLoop, nativeFolds.stage);
      yield* forms.formedHere(id, path);
      const [, line] = readFileSync(path, 'utf8').split('\n');
      expect(JSON.parse(line!).row.payload.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'law' }] }]);
      expect(yield* db.all(sql`select step from thread_rollout_form where thread_id = ${id}`)).toEqual([{ step: TEXT_CONTENT }]);
    }),
  );

  it.effect('a rollout is planned for the store by the reader worker and handed over unit by unit', () =>
    Effect.gen(function* () {
      const path = join(yield* scratch, 'carried.jsonl');
      const event = { position: 1, id: 'told', kind: 'message', payload: { messages: [{ role: 'user', content: 'law' }] } };
      writeFileSync(path, `${JSON.stringify({ thread: { id: 'carried' } })}\n${JSON.stringify({ kind: 'event', row: event })}\n`);
      const plan = yield* nativeFolds
        .carry(
          { path, packed: `${path}.zst`, transcript: `${path}.entries` },
          { threadId: 'carried', native: false, standing: [], sources: null },
        )
        .pipe(Effect.provideService(ThreadEntryKinds, onTheLoop));
      if (plan.kind !== 'planned') return yield* Effect.die(plan);
      expect(plan.units).toBe(1);
      const [row] = yield* plan.take(0);
      expect((row?.row.payload as { readonly messages: unknown }).messages).toEqual([
        { role: 'user', content: [{ type: 'text', text: 'law' }] },
      ]);
    }),
  );
});
