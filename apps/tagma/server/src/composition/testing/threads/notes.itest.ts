import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Effect } from 'effect';
import { ProjectChanges } from '../../../projects/contract/service/changes.js';
import { Projects } from '../../../projects/contract/service/registry.js';
import { BuiltinNotes } from '../../../threads/contract/service/notes.js';
import { type Note, type NoteScope } from '../../../threads/contract/wire/notes.js';
import { noteRowsOf, notesOver } from '../../../threads/testing/notes.js';
import { threadStoreFixture } from '../threadStoreFixture.js';

const setup = Effect.gen(function* () {
  const fixture = yield* threadStoreFixture;
  const notes = yield* notesOver().pipe(
    Effect.provideService(BuiltinNotes, { notes: [{ id: 'stance', text: 'Built in.' }] }),
    Effect.provide(fixture.context),
  );
  const born = Effect.fnUntraced(function* () {
    return yield* fixture.units.write('notes.birth', (unit) =>
      Effect.gen(function* () {
        const row = yield* fixture.store.insert({ ownerId: 'operator', agentId: 'tagma' }, unit);
        yield* fixture.threads.rows.attachFacet({ threadId: row.id, projectId: fixture.projectId }, unit);
        return row.id;
      }),
    );
  });
  const reader = (threadId: string) => ({ projectId: fixture.projectId, threadId });
  const write = (threadId: string, scope: NoteScope, id: string, text: string | null) =>
    notes.write({ scope, reader: reader(threadId) }, id, text);
  const flip = (threadId: string, scope: NoteScope, id: string, on: boolean | null) =>
    notes.switch({ scope, reader: reader(threadId) }, id, on);
  return { fixture, notes, born, reader, write, flip };
});

const noteIn = (notes: readonly Note[], id: string) => notes.find((note) => note.id === id);

it.live('project and thread notes override the builtin set in scope and write order', () =>
  Effect.gen(function* () {
    const { notes, born, reader, write } = yield* setup;
    const threadId = yield* born();
    const fresh = (yield* notes.standing(reader(threadId))).set;
    expect(noteIn(fresh.notes, 'stance')).toMatchObject({ definedIn: 'builtin', on: true, decidedIn: null });
    yield* write(threadId, 'project', 'brief', 'Answer in one paragraph.');
    const read = (yield* notes.standing(reader(threadId))).set;
    expect(noteIn(read.notes, 'brief')).toMatchObject({ definedIn: 'project', on: true, text: 'Answer in one paragraph.' });
    expect(read.notes.map((note) => note.id).indexOf('stance')).toBeLessThan(read.notes.map((note) => note.id).indexOf('brief'));
    yield* write(threadId, 'project', 'later', 'Keep answers short.');
    const overridden = yield* write(threadId, 'thread', 'brief', 'Answer in two lines.');
    expect(noteIn(overridden.notes, 'brief')).toMatchObject({ definedIn: 'thread', text: 'Answer in two lines.' });
    const ids = overridden.notes.map((note) => note.id);
    expect(ids.indexOf('later')).toBeLessThan(ids.indexOf('brief'));
  }),
);

it.live('switches decide from the nearest scope out: own id before wildcard, and a lifted switch inherits again', () =>
  Effect.gen(function* () {
    const { born, write, flip } = yield* setup;
    const threadId = yield* born();
    yield* write(threadId, 'project', 'walk', 'Name the file you read.');
    yield* flip(threadId, 'project', 'walk', true);
    const allOff = yield* flip(threadId, 'thread', '*', false);
    expect(noteIn(allOff.notes, 'walk')).toMatchObject({ on: false, decidedIn: 'thread', decidedBy: '*' });
    expect(noteIn(allOff.notes, 'stance')).toMatchObject({ on: false, decidedIn: 'thread', decidedBy: '*' });
    const ownOn = yield* flip(threadId, 'thread', 'walk', true);
    expect(noteIn(ownOn.notes, 'walk')).toMatchObject({ on: true, decidedIn: 'thread', decidedBy: 'walk' });
    const lifted = yield* flip(threadId, 'thread', 'walk', null);
    expect(noteIn(lifted.notes, 'walk')).toMatchObject({ on: false, decidedBy: '*' });
    yield* flip(threadId, 'project', 'walk', false);
    const allOn = yield* flip(threadId, 'thread', '*', true);
    expect(noteIn(allOn.notes, 'walk')).toMatchObject({ on: true, decidedIn: 'thread', decidedBy: '*' });
    const inherited = yield* flip(threadId, 'thread', '*', null);
    expect(noteIn(inherited.notes, 'walk')).toMatchObject({ on: false, decidedIn: 'project', decidedBy: 'walk' });
    expect(noteIn(inherited.notes, 'stance')).toMatchObject({ on: true, decidedIn: null });
  }),
);

it.live('builtin deletion and notes past the text or set budgets refuse without changing the standing set', () =>
  Effect.gen(function* () {
    const { notes, born, reader, write } = yield* setup;
    const threadId = yield* born();
    expect(yield* Effect.flip(write(threadId, 'user', 'stance', null))).toMatchObject({ code: 'note-builtin' });
    expect(yield* Effect.flip(write(threadId, 'thread', 'long', 'x'.repeat(1_001)))).toMatchObject({ code: 'note-too-long' });
    const first = yield* write(threadId, 'thread', 'first', 'a'.repeat(1_000));
    expect(yield* Effect.flip(write(threadId, 'thread', 'second', 'b'.repeat(1_000)))).toMatchObject({
      code: 'notes-over-budget',
      reason: expect.stringContaining(String(first.chars + 1_000)),
    });
    const after = (yield* notes.standing(reader(threadId))).set;
    expect(after.chars).toBe(first.chars);
    expect(noteIn(after.notes, 'second')).toBeUndefined();
  }),
);

it.live('a fork copies thread notes; record removal clears its rows and cache while project removal retains its notes', () =>
  Effect.gen(function* () {
    const { fixture, notes, born, reader, write } = yield* setup;
    const source = yield* born();
    const fork = yield* born();
    yield* write(source, 'thread', 'focus', 'Stay on the parser.');
    yield* fixture.units.write('notes.fork', (unit) => notes.forked(source, fork, unit));
    expect(noteIn((yield* notes.standing(reader(fork))).set.notes, 'focus')).toMatchObject({ definedIn: 'thread', on: true });
    yield* fixture.units.write('notes.delete', (unit) => fixture.records.remove(unit, [fork]));
    expect(yield* noteRowsOf(fixture.db, fixture.units, fork)).toEqual([]);
    expect(noteIn((yield* notes.standing(reader(fork))).set.notes, 'focus')).toBeUndefined();
    expect(yield* noteRowsOf(fixture.db, fixture.units, source)).toHaveLength(1);
    const projects = Context.get(fixture.context, Projects);
    const changes = Context.get(fixture.context, ProjectChanges);
    const project = yield* projects.byId(fixture.projectId);
    const at = { projectId: fixture.projectId, threadId: null };
    yield* notes.write({ scope: 'project', reader: at }, 'kept', 'Stays with its project.');
    yield* fixture.units.write('notes.removeProject', (unit) =>
      Effect.andThen(projects.remove(unit, project), unit.afterCommit(changes.removed.publish({ projectId: fixture.projectId }))),
    );
    expect(yield* noteRowsOf(fixture.db, fixture.units, String(fixture.projectId))).toHaveLength(1);
    expect(noteIn((yield* notes.standing(at)).set.notes, 'kept')).toMatchObject({ definedIn: 'project', text: 'Stays with its project.' });
  }),
);
