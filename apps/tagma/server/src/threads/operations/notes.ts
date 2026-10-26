import { Effect } from 'effect';
import { body, pair } from '../../platform/contract/service/body.js';
import { threadIdOf } from '../../platform/contract/wire/actor.js';
import type { Caller } from '../../platform/contract/wire/caller.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { CurrentProject } from '../../projects/contract/service/caller.js';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import { NotesReach, OperatorNotes, type NoteReader } from '../contract/service/notes.js';
import { NOTE_OPERATIONS as OPS } from '../contract/wire/operations/notes.js';

const readerOf = Effect.fnUntraced(function* (threadId: string | undefined, caller: Caller) {
  const { project } = yield* yield* CurrentProject;
  const records = yield* ThreadRecords;
  if (threadId === undefined) {
    const own = threadIdOf(caller.actor);
    const home = own === null ? undefined : yield* records.projectOf(own);
    return { projectId: project.id, threadId: home === project.id ? own : null } satisfies NoteReader;
  }
  const home = yield* records.projectOf(threadId);
  if (home === undefined) {
    return yield* new GateRefusal('not-found', `No thread ${threadId} stands in this project.`, ["read the project's thread list"]);
  }
  if (home !== project.id) {
    return yield* new GateRefusal('foreign-project', `Thread ${threadId} stands in project ${home}.`, [`call again in project ${home}`]);
  }
  return { projectId: project.id, threadId } satisfies NoteReader;
});

export const NOTE_PAIRS = {
  read_operator_notes: pair(
    OPS.read_operator_notes,
    body(OPS.read_operator_notes, {
      execute: Effect.fnUntraced(function* (input, _prepared, caller) {
        const reader = yield* readerOf(input.threadId, caller);
        const { set } = yield* (yield* OperatorNotes).standing(reader);
        const withheld = reader.threadId === null ? null : yield* (yield* NotesReach).withheld(reader.threadId);
        return { status: 'ok' as const, ...set, withheld };
      }),
    }),
  ),
  write_operator_note: pair(
    OPS.write_operator_note,
    body(OPS.write_operator_note, {
      execute: Effect.fnUntraced(function* (input, _prepared, caller) {
        const reader = yield* readerOf(input.threadId, caller);
        const set = yield* (yield* OperatorNotes).write({ scope: input.scope, reader }, input.id, input.text ?? null);
        return { status: 'written' as const, ...set };
      }),
    }),
  ),
  switch_operator_notes: pair(
    OPS.switch_operator_notes,
    body(OPS.switch_operator_notes, {
      execute: Effect.fnUntraced(function* (input, _prepared, caller) {
        const reader = yield* readerOf(input.threadId, caller);
        const set = yield* (yield* OperatorNotes).switch({ scope: input.scope, reader }, input.id, input.on);
        return { status: 'switched' as const, ...set };
      }),
    }),
  ),
};
