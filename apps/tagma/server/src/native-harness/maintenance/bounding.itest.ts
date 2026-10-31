import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import { Effect, Layer, type Schema } from 'effect';
import { WIRE_ENTRY_MAX_BYTES } from '@runlith/agent/protocol/cap';
import type { ThreadRow } from '@runlith/agent/thread/rows';
import type { ThreadTranscriptEntry } from '@runlith/agent/transcript/rows';
import type { ThreadMessageEntry, ThreadToolEntry } from '@runlith/agent/transcript/entries';
import { entryOf, ThreadEntryKinds, makeThreadEntryReader, type ThreadEntryReader } from '@runlith/agent/transcript/kinds';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { unitsLayer } from '../../platform/store/units.js';
import { seededStoreLayer } from '../../platform/store/open.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { threadEntry } from '../../threads/store/kernel.js';
import { fixtureHome } from '../../platform/testing/roots.js';
import { makeEntryBounding } from './bounding.js';
import { toolOutputStore } from '../tools/outputStore.js';
import { makeSqliteThreadJournal } from '../../threads/journal/log.js';
import { makeThreadRecords } from '../../thread-record/layer.js';
import { threadFolder } from '../testing/fold.js';
import { retainedToolValue } from '../contract/wire/toolResult.js';
import { ToolOutputs } from '../contract/service/toolOutputs.js';
import { CORE_KINDS, threadStore } from '../testing/doubles.js';

const fileRoot = mkdtempSync(join(fixtureHome(), 'entry-bounding-'));

const machine = Layer.orDie(
  unitsLayer(MachineUnits, MachineStore).pipe(Layer.provideMerge(seededStoreLayer(MachineStore, fixtureMigrations, {}, sharedPool))),
);

const boundingOver = (outputs: ReturnType<typeof toolOutputStore>, kinds: ThreadEntryReader) =>
  makeEntryBounding.pipe(Effect.provideService(ToolOutputs, { store: outputs }), Effect.provideService(ThreadEntryKinds, kinds));

const stand = Effect.fnUntraced(function* (root: string, kinds: ThreadEntryReader = CORE_KINDS) {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const outputs = toolOutputStore(root);
  const threads = yield* threadStore(yield* makeThreadRecords, CORE_KINDS);
  return {
    db,
    units,
    threads,
    fold: yield* threadFolder(threads),
    events: yield* makeSqliteThreadJournal,
    outputs,
    bounding: yield* boundingOver(outputs, kinds),
    root,
  };
});

type Stand = Effect.Success<ReturnType<typeof stand>>;

const wide = (at: number): Schema.Json => ({ status: 'ok', text: `${at}`.repeat(WIRE_ENTRY_MAX_BYTES) });

const toolOf = entryOf('tool');

const outputOf = (entry: ThreadTranscriptEntry | undefined): unknown =>
  entry !== undefined && toolOf(entry) ? entry.toolOutput : undefined;

const toolEntry = (at: number, output: Schema.Json): ThreadToolEntry => ({
  type: 'tool',
  id: `entry-${at}`,
  runId: 'run-1',
  toolName: 'read_thread',
  toolCallId: `call-${at}`,
  toolState: 'output-available',
  toolInput: { threadId: 'other' },
  toolOutput: output,
});

const said = (at: number): ThreadMessageEntry => ({
  type: 'message',
  id: `entry-${at}`,
  runId: 'run-1',
  role: 'assistant',
  text: `line ${at}`,
});

const carry = Effect.fnUntraced(function* (on: Stand, thread: ThreadRow, entries: readonly ThreadTranscriptEntry[]) {
  yield* on.threads.transaction((tx) =>
    Effect.forEach(entries, (entry, at) =>
      on.events.append({ threadId: thread.id, id: `event-${thread.id}-${at}`, kind: entry.type, payload: { entry } }, tx),
    ),
  );
  yield* on.fold(thread.id, (row) => Effect.succeed({ history: [...row.history] }));
});

const entriesOf = (on: Stand, threadId: string) =>
  on.db.select({ entry: threadEntry.entry }).from(threadEntry).where(eq(threadEntry.threadId, threadId));

const overCeiling = (on: Stand, threadId: string) =>
  on.db
    .select({ entryId: threadEntry.entryId })
    .from(threadEntry)
    .where(and(eq(threadEntry.threadId, threadId), sql`length(${threadEntry.entry}) > ${WIRE_ENTRY_MAX_BYTES}`));

const eventEntry = Effect.fnUntraced(function* (on: Stand, threadId: string, entryId: string) {
  const head = yield* on.events.headPosition(threadId);
  const records = yield* on.events.recordsAsOf(threadId, { head, afterPosition: 0, limit: head });
  for (const record of records) {
    const entry = (record.payload as { entry?: ThreadTranscriptEntry }).entry;
    if (entry?.id === entryId) return entry;
  }
  return undefined;
});

it.live('a value past the row ceiling moves whole into its file and the row and its event keep the pointer', () =>
  Effect.gen(function* () {
    const on = yield* stand(join(fileRoot, 'moved'));
    const thread = yield* on.threads.insert({ ownerId: 'owner', agentId: 'agent' });
    const values = [wide(1), wide(2), wide(3)] as const;
    yield* carry(on, thread, [
      toolEntry(0, values[0]),
      said(1),
      toolEntry(2, values[1]),
      toolEntry(3, { status: 'ok', rows: 2 }),
      toolEntry(4, values[2]),
    ]);
    expect(yield* overCeiling(on, thread.id)).toHaveLength(3);

    const report = yield* on.bounding.pass();

    const moved = values.reduce<number>((sum, value) => sum + Buffer.byteLength(JSON.stringify(value), 'utf8'), 0);
    expect(report.rows).toBe(3);
    expect(yield* overCeiling(on, thread.id)).toEqual([]);
    expect(report.threads).toEqual([{ threadId: thread.id, rows: 3, bytes: moved }]);
    expect(report.bytesRemoved).toBe(moved);
    expect(report.bytesWritten).toBe(moved);
    expect(readdirSync(join(on.root, thread.id))).toHaveLength(3);

    const held = new Map<string, Schema.Json>([
      ['entry-0', values[0]],
      ['entry-2', values[1]],
      ['entry-4', values[2]],
    ]);
    const rows = yield* entriesOf(on, thread.id);
    const bounded = rows.filter((row) => retainedToolValue(outputOf(row.entry)) !== null);
    expect(bounded.map((row) => row.entry.id).sort()).toEqual(['entry-0', 'entry-2', 'entry-4']);
    for (const row of bounded) {
      const pointer = retainedToolValue(outputOf(row.entry));
      if (pointer === null) return yield* Effect.die(new Error('the row lost its pointer between two reads'));
      expect(yield* on.outputs.retained(thread.id, pointer.outputId)).toEqual({ value: held.get(row.entry.id) ?? null });
    }

    for (const row of bounded) {
      expect(yield* eventEntry(on, thread.id, row.entry.id)).toEqual(row.entry);
    }
    expect(report.events).toBe(0);

    const small = rows.find((row) => row.entry.id === 'entry-3');
    expect(outputOf(small?.entry)).toEqual({ status: 'ok', rows: 2 });
    expect(rows.find((row) => row.entry.id === 'entry-1')?.entry).toEqual(said(1));
  }).pipe(Effect.provide(machine)),
);

it.live('an unmarked resident thread is bounded through its current-form reader without advancing its form mark', () =>
  Effect.gen(function* () {
    const kinds = makeThreadEntryReader({
      products: [],
      steps: [
        {
          name: '20261010210000_tool_name',
          samples: { entry: { type: 'tool', toolName: 'read_thread' } },
          entry: (entry) => (entry.type === 'tool' && entry.toolName === 'read_thread' ? { ...entry, toolName: 'read_current' } : null),
        },
      ],
    });
    const on = yield* stand(join(fileRoot, 'forms'), kinds);
    const thread = yield* on.threads.insert({ ownerId: 'owner', agentId: 'agent' });
    const value = wide(1);
    yield* carry(on, thread, [toolEntry(0, value)]);
    expect((yield* on.bounding.pass()).rows).toBe(1);
    const row = (yield* entriesOf(on, thread.id))[0]!.entry;
    expect(toolOf(row) && row.toolName).toBe('read_current');
    const pointer = retainedToolValue(outputOf(row));
    if (pointer === null) return yield* Effect.die(new Error('the bounded entry has no retained output'));
    expect(yield* on.outputs.retained(thread.id, pointer.outputId)).toEqual({ value });
    expect(yield* on.db.all(sql`select step from thread_rollout_form where thread_id = ${thread.id}`)).toEqual([{ step: null }]);
  }).pipe(Effect.provide(machine)),
);

it.live('the model reaches a moved value again through the tool that pages it', () =>
  Effect.gen(function* () {
    const on = yield* stand(join(fileRoot, 'paged'));
    const thread = yield* on.threads.insert({ ownerId: 'owner', agentId: 'agent' });
    const value = wide(7);
    yield* carry(on, thread, [toolEntry(0, value)]);

    yield* on.bounding.pass();

    const rows = yield* entriesOf(on, thread.id);
    const pointer = retainedToolValue(outputOf(rows[0]?.entry));
    if (pointer === null) return yield* Effect.die(new Error('the row kept no pointer'));
    const tool = on.outputs.scope({ threadId: thread.id, ownerId: 'owner', runId: null }).tools.read_tool_output;
    const paged = yield* (tool?.execute as (input: unknown, call: unknown) => Effect.Effect<unknown>)(
      { outputId: pointer.outputId, offset: 0 },
      {
        toolCallId: 'call-read',
        messages: [],
        caller: { agentId: 'agent', ownerId: 'owner', thread: { threadId: thread.id, runId: 'run-1', bindings: {} } },
      },
    );
    expect(String(paged)).toContain('"status":"ok"');
    expect(String(paged)).toContain(`of ${Buffer.byteLength(JSON.stringify(value), 'utf8')}`);
  }).pipe(Effect.provide(machine)),
);

it.live('a second pass over the same rows moves nothing', () =>
  Effect.gen(function* () {
    const on = yield* stand(join(fileRoot, 'again'));
    const thread = yield* on.threads.insert({ ownerId: 'owner', agentId: 'agent' });
    yield* carry(on, thread, [toolEntry(0, wide(4)), toolEntry(1, wide(5))]);

    const first = yield* on.bounding.pass();
    const second = yield* on.bounding.pass();

    expect(first.rows).toBe(2);
    expect(second).toMatchObject({ rows: 0, events: 0, bytesRemoved: 0, bytesWritten: 0, left: 0 });
    expect(readdirSync(join(on.root, thread.id))).toHaveLength(2);
  }).pipe(Effect.provide(machine)),
);

it.live('a value that cannot land in its file is counted, left whole, and the rest of the pass moves', () =>
  Effect.gen(function* () {
    const on = yield* stand(join(fileRoot, 'blocked'));
    const blocked = yield* on.threads.insert({ ownerId: 'owner', agentId: 'agent' });
    const moving = yield* on.threads.insert({ ownerId: 'owner', agentId: 'agent' });
    mkdirSync(on.root, { recursive: true });
    writeFileSync(join(on.root, blocked.id), 'this is a file, so no folder can be made at its name');
    const value = wide(9);
    yield* carry(on, blocked, [toolEntry(0, value)]);
    yield* carry(on, moving, [toolEntry(0, wide(10))]);

    const report = yield* on.bounding.pass();

    expect(report.refused).toBe(1);
    expect(report.rows).toBe(1);
    expect(report.bytesRemoved).toBe(report.bytesWritten);
    const rows = yield* entriesOf(on, blocked.id);
    expect(outputOf(rows[0]?.entry)).toEqual(value);
    expect(outputOf(yield* eventEntry(on, blocked.id, 'entry-0'))).toEqual(value);
    const carried = yield* entriesOf(on, moving.id);
    expect(retainedToolValue(outputOf(carried[0]?.entry))).not.toBeNull();
  }).pipe(Effect.provide(machine)),
);

it.live('only a row this door moves takes the write permit, and a value that escapes six-fold is one', () =>
  Effect.gen(function* () {
    const on = yield* stand(join(fileRoot, 'permits'));
    const thread = yield* on.threads.insert({ ownerId: 'owner', agentId: 'agent' });
    let taken = 0;
    const permits: MachineUnits['Service'] = {
      read: (work) => on.units.read(work),
      markReadOnly: (effect) => on.units.markReadOnly(effect),
      markWrite: (effect) => on.units.markWrite(effect),
      write: (operation, work) => {
        taken += 1;
        return on.units.write(operation, work);
      },
      program: (operation, identity, work) => on.units.program(operation, identity, work),
    };
    const bounding = yield* boundingOver(on.outputs, CORE_KINDS).pipe(Effect.provideService(MachineUnits, permits));
    const escaping = '\u0001'.repeat(WIRE_ENTRY_MAX_BYTES / 4);
    expect(escaping.length).toBeLessThan(WIRE_ENTRY_MAX_BYTES);
    expect(JSON.stringify(escaping).length).toBeGreaterThan(WIRE_ENTRY_MAX_BYTES);
    const pointed = {
      truncated: true,
      outputId: '0'.repeat(32),
      byteLength: 1,
      lineCount: 1,
      format: 'json',
      preview: 'p'.repeat(WIRE_ENTRY_MAX_BYTES),
    };
    yield* carry(on, thread, [
      toolEntry(0, wide(11)),
      { ...said(1), text: 'x'.repeat(WIRE_ENTRY_MAX_BYTES) },
      toolEntry(2, escaping),
      toolEntry(3, pointed),
    ]);
    expect(yield* overCeiling(on, thread.id)).toHaveLength(4);

    const report = yield* bounding.pass();

    expect(report).toMatchObject({ rows: 2, left: 1, refused: 0 });
    expect(taken).toBe(3);
    const rows = yield* entriesOf(on, thread.id);
    const pointer = retainedToolValue(outputOf(rows.find((row) => row.entry.id === 'entry-2')?.entry));
    if (pointer === null) return yield* Effect.die(new Error('the escaping value stayed in its row'));
    expect(yield* on.outputs.retained(thread.id, pointer.outputId)).toEqual({ value: escaping });
  }).pipe(Effect.provide(machine)),
);
