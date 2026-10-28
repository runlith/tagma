import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect } from 'effect';
import { demoGraphLayer, withDemo } from '../../graphFixture.js';

layer(demoGraphLayer(), { excludeTestServices: true })('knowledge records', (it) => {
  it.effect('meetings name people, sources identify evidence and replaced decisions lead to the current choice', () =>
    withDemo(({ graph, fixture, refusal, nameOf }) =>
      Effect.gen(function* () {
        const project = yield* graph.projectLifecycle.create({
          name: 'knowledge',
          rootPath: yield* fixture.directory('knowledge'),
          catalogs: ['knowledge'],
        });
        const projectId = project.id;
        const root = (yield* graph.blocks.rootBlockOf(projectId)).id;
        const person = yield* graph.blocks.create({ projectId, parentId: root, tags: ['person'], title: 'Ada' });
        const attendee = yield* nameOf(person.id);
        const held = '2026-10-20T10:00:00Z';
        const meeting = yield* graph.blocks.create({
          projectId,
          parentId: root,
          tags: ['meeting'],
          title: 'Planning',
          fields: { held, attendees: [attendee] },
        });
        expect(meeting.fields).toEqual({ held, attendees: [attendee] });
        expect((yield* refusal(graph.blocks.create({ projectId, parentId: root, tags: ['meeting'], title: 'Undated' }))).code).toBe(
          'field-required',
        );
        expect(
          (yield* refusal(graph.blocks.update({ id: meeting.id, fields: { held, attendees: [yield* nameOf(meeting.id)] } }))).code,
        ).toBe('field-target');
        expect((yield* graph.blocks.blockById(meeting.id)).fields).toEqual(meeting.fields);
        expect((yield* refusal(graph.blocks.create({ projectId, parentId: root, tags: ['source'], title: 'Unlocated' }))).code).toBe(
          'field-required',
        );
        const location = 'library/field-study.pdf';
        const source = yield* graph.blocks.create({
          projectId,
          parentId: root,
          tags: ['source'],
          title: 'Field study',
          fields: { location },
        });
        expect(source.fields.location).toBe(location);
        const old = yield* graph.blocks.create({
          projectId,
          parentId: root,
          tags: ['decision'],
          title: 'Keep the old schedule',
          edges: [{ kind: 'relates', to: meeting.id }],
        });
        const current = yield* graph.blocks.create({
          projectId,
          parentId: root,
          tags: ['decision'],
          title: 'Adopt the new schedule',
          body: 'The field study covers the changed conditions.',
          edges: [{ kind: 'relates', to: source.id }],
        });
        expect((yield* graph.edges.of(projectId)).filter((edge) => edge.fromId === old.id).map((edge) => [edge.kind, edge.toId])).toEqual([
          ['relates', meeting.id],
        ]);
        yield* graph.standing.supersede({ oldId: old.id, withId: current.id });
        expect(yield* graph.standing.successorOf(old.id)).toBe(current.id);
        const choices = yield* graph.ranking.search({ projectId, query: '', tag: 'decision', limit: 2 });
        expect(choices.items.map((row) => row.name)).toEqual([yield* nameOf(current.id)]);
      }),
    ),
  );
});
