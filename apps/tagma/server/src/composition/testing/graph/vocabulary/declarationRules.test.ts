import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { softwareDevelopment } from '../../../../catalogs/contract/wire/softwareDevelopment.js';
import { coreLibrary } from '../../../../catalogs/contract/wire/coreLibrary.js';
import { knowledge } from '../../../../catalogs/contract/wire/knowledge.js';
import type { Catalog, Tag } from '../../../../graph/contract/wire/tags/declaration.js';
import { validateFields } from '../../../../graph/vocabulary/declarationRules.js';

function tagNamed(catalog: Catalog, id: string): Tag {
  const tag = catalog.tags.find((candidate) => candidate.id === id);
  if (tag === undefined) throw new Error(`the ${catalog.id} catalog declares no #${id}`);
  return tag;
}

const SLICE = { tags: ['task'], sort: { by: 'updated', order: 'desc' } } as const;

it.effect('catalog field grammars accept their values and identify the refused field', () =>
  Effect.gen(function* () {
    const task = tagNamed(softwareDevelopment, 'task');
    const view = tagNamed(coreLibrary, 'view');
    const meeting = tagNamed(knowledge, 'meeting');
    yield* validateFields([task], { status: 'open', holder: 12 });
    yield* validateFields([view], { query: SLICE });
    yield* validateFields([meeting], { held: '2026-09-19T10:00:00Z', attendees: ['5940aab8'] });
    const invalid: readonly [Tag, Record<string, unknown>, string][] = [
      [task, { status: 'flying' }, 'task.status'],
      [task, { holder: 'me' }, 'task.holder'],
      [view, { query: { ...SLICE, tags: [] } }, 'view.query'],
      [view, { query: { tags: ['task'] } }, 'view.query'],
      [meeting, { held: 'the third' }, 'meeting.held'],
      [meeting, { attendees: ['$person'] }, 'meeting.attendees'],
      [tagNamed(coreLibrary, 'proposal'), { ops: [] }, 'proposal.ops'],
    ];
    for (const [tag, fields, field] of invalid) {
      const refused = yield* validateFields([tag], fields).pipe(Effect.flip);
      expect(refused.code).toBe('field-invalid');
      expect(refused.reason).toContain(field);
    }
    const unknown = yield* validateFields([task], { total: 3 }).pipe(Effect.flip);
    expect(unknown.code).toBe('field-invalid');
    expect(unknown.reason).toContain('total');
    expect(unknown.unblock.join(' ')).toContain('status');
    expect(unknown.unblock.join(' ')).toContain('holder');
  }),
);

it.effect('a schema field refused for its shape names the form it accepts', () =>
  Effect.gen(function* () {
    const refused = yield* validateFields([tagNamed(coreLibrary, 'view')], { query: SLICE, layout: 'board by status' }).pipe(Effect.flip);
    expect(refused.code).toBe('field-invalid');
    expect(refused.unblock.join(' ')).toContain('{mode: "sections"|"board", by: "status"|"tag"|"parent"}');
  }),
);
