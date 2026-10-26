import { and, eq } from 'drizzle-orm';
import { Clock, Effect, Semaphore } from 'effect';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import { BuiltinNotes, OperatorNotes, type NotePlace, type NoteReader, type Standing } from '../contract/service/notes.js';
import { NOTE_TEXT_LIMIT, NOTES_BUDGET, type NoteScope } from '../contract/wire/notes.js';
import { type Layers, type NoteRow, resolve, scopeKey } from './resolve.js';
import { operatorNote } from './table.js';

const WRITTEN = writes('OperatorNotes.write', [operatorNote]);

type Change = { readonly put: NoteRow } | { readonly gone: NoteRow };

const placeOf = (scope: NoteScope, key: string) => `${scope}/${key}`;
const changed = (change: Change): NoteRow => ('put' in change ? change.put : change.gone);

const stored = (row: NoteRow, projectId: number | null) => ({
  scopeKind: row.scope,
  scopeKey: row.key,
  projectId: row.scope === 'project' ? projectId : null,
  threadId: row.scope === 'thread' ? row.key : null,
  noteId: row.noteId,
  text: row.text,
  switch: row.switch,
  writtenAt: new Date(row.writtenAt),
});

export const makeOperatorNotes = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const records = yield* ThreadRecords;
  const { notes: builtins } = yield* BuiltinNotes;
  const builtinIds = new Set(builtins.map((note) => note.id));
  const rows = new Map<string, Map<string, NoteRow>>();
  const standings = new Map<number, Map<string, Standing>>();
  const writing = yield* Semaphore.make(1);

  const remember = (row: NoteRow) => {
    const place = placeOf(row.scope, row.key);
    let held = rows.get(place);
    if (held === undefined) rows.set(place, (held = new Map()));
    held.set(row.noteId, row);
  };
  const forget = (row: NoteRow) => {
    const place = placeOf(row.scope, row.key);
    const held = rows.get(place);
    held?.delete(row.noteId);
    if (held?.size === 0) rows.delete(place);
  };
  const stale = (scope: NoteScope, key: string) => {
    if (scope === 'user') standings.clear();
    else if (scope === 'project') standings.delete(Number(key));
    else for (const held of standings.values()) held.delete(key);
  };
  const dropPlace = (scope: NoteScope, key: string) => {
    rows.delete(placeOf(scope, key));
    stale(scope, key);
  };

  for (const row of yield* units.read((unit) => unit.run(db.select().from(operatorNote)))) {
    remember({
      scope: row.scopeKind,
      key: row.scopeKey,
      noteId: row.noteId,
      text: row.text,
      switch: row.switch,
      writtenAt: row.writtenAt.getTime(),
    });
  }

  yield* Effect.acquireRelease(
    Effect.sync(() => records.removalRecorded(({ threadId }) => Effect.sync(() => dropPlace('thread', threadId)))),
    (dispose) => Effect.sync(dispose),
  );

  const layersOf = (reader: NoteReader, change?: Change): Layers => {
    const layer = (scope: NoteScope) => {
      const key = scopeKey(scope, reader);
      if (key === null) return undefined;
      const held = rows.get(placeOf(scope, key));
      if (change === undefined) return held;
      const row = changed(change);
      if (row.scope !== scope || row.key !== key) return held;
      const next = new Map(held);
      if ('put' in change) next.set(row.noteId, row);
      else next.delete(row.noteId);
      return next;
    };
    return { user: layer('user'), project: layer('project'), thread: layer('thread') };
  };

  const standingOf = (reader: NoteReader): Standing => {
    let project = standings.get(reader.projectId);
    if (project === undefined) standings.set(reader.projectId, (project = new Map()));
    const key = reader.threadId ?? '';
    const held = project.get(key);
    if (held !== undefined) return held;
    const fresh = resolve(builtins, layersOf(reader), reader);
    project.set(key, fresh);
    return fresh;
  };

  const keyOf = ({ scope, reader }: NotePlace) => {
    const key = scopeKey(scope, reader);
    return key === null
      ? Effect.fail(
          new GateRefusal('thread-required', 'A note of the thread scope needs a thread, and this call names none.', [
            'name the thread with `threadId`',
          ]),
        )
      : Effect.succeed(key);
  };

  const settle = Effect.fnUntraced(function* (place: NotePlace, change: Change) {
    const before = standingOf(place.reader).set;
    const after = resolve(builtins, layersOf(place.reader, change), place.reader).set;
    if (after.chars > NOTES_BUDGET && after.chars > before.chars) {
      return yield* new GateRefusal(
        'notes-over-budget',
        `The notes that would stand for this thread hold ${after.chars} characters, past the budget of ${NOTES_BUDGET}; they stand at ${before.chars} now.`,
        ['switch a note off or shorten one, then write again'],
      );
    }
    const row = changed(change);
    yield* units.write(WRITTEN, (unit) =>
      Effect.gen(function* () {
        if ('gone' in change) {
          yield* unit.run(
            db
              .delete(operatorNote)
              .where(and(eq(operatorNote.scopeKind, row.scope), eq(operatorNote.scopeKey, row.key), eq(operatorNote.noteId, row.noteId))),
          );
        } else {
          const values = stored(row, place.reader.projectId);
          yield* unit.run(
            db
              .insert(operatorNote)
              .values(values)
              .onConflictDoUpdate({
                target: [operatorNote.scopeKind, operatorNote.scopeKey, operatorNote.noteId],
                set: { text: values.text, switch: values.switch, writtenAt: values.writtenAt },
              }),
          );
        }
        yield* unit.afterCommit(
          Effect.sync(() => {
            if ('put' in change) remember(row);
            else forget(row);
            stale(row.scope, row.key);
          }),
        );
      }),
    );
    return standingOf(place.reader).set;
  });

  return OperatorNotes.of({
    standing: (reader) => Effect.sync(() => standingOf(reader)),
    write: Effect.fn('OperatorNotes.write')(
      function* (place, noteId, text) {
        if (text !== null && text.length > NOTE_TEXT_LIMIT) {
          return yield* new GateRefusal(
            'note-too-long',
            `A note holds at most ${NOTE_TEXT_LIMIT} characters; this one holds ${text.length}.`,
            ['shorten the text, or split it into two notes'],
          );
        }
        const key = yield* keyOf(place);
        const row = rows.get(placeOf(place.scope, key))?.get(noteId);
        if (text !== null) {
          const writtenAt = row?.text == null ? yield* Clock.currentTimeMillis : row.writtenAt;
          return yield* settle(place, { put: { scope: place.scope, key, noteId, text, switch: row?.switch ?? null, writtenAt } });
        }
        if (row?.text != null) return yield* settle(place, row.switch === null ? { gone: row } : { put: { ...row, text: null } });
        if (builtinIds.has(noteId)) {
          return yield* new GateRefusal('note-builtin', `${noteId} is a note the product ships, so it is never deleted.`, [
            `switch it off: switch_operator_notes with id ${noteId} and on: false`,
          ]);
        }
        return standingOf(place.reader).set;
      },
      (effect) => writing.withPermits(1)(effect),
    ),
    switch: Effect.fn('OperatorNotes.switch')(
      function* (place, noteId, on) {
        const key = yield* keyOf(place);
        const row = rows.get(placeOf(place.scope, key))?.get(noteId);
        if (on !== null) {
          const writtenAt = row?.writtenAt ?? (yield* Clock.currentTimeMillis);
          const state = on ? ('on' as const) : ('off' as const);
          return yield* settle(place, { put: { scope: place.scope, key, noteId, text: row?.text ?? null, switch: state, writtenAt } });
        }
        if (row === undefined || row.switch === null) return standingOf(place.reader).set;
        return yield* settle(place, row.text === null ? { gone: row } : { put: { ...row, switch: null } });
      },
      (effect) => writing.withPermits(1)(effect),
    ),
    forked: Effect.fnUntraced(function* (from, to, unit) {
      const copies = [...(rows.get(placeOf('thread', from))?.values() ?? [])].map((row) => ({ ...row, key: to }));
      if (copies.length === 0) return;
      yield* unit.run(db.insert(operatorNote).values(copies.map((row) => stored(row, null))));
      yield* unit.afterCommit(
        Effect.sync(() => {
          for (const row of copies) remember(row);
          stale('thread', to);
        }),
      );
    }),
  });
});
