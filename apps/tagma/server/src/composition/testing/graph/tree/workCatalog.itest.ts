import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { and, eq, inArray } from 'drizzle-orm';
import { Effect } from 'effect';
import { DEFAULT_CATALOGS, tagsOfCatalogs } from '../../../../catalogs/contract/wire/registry.js';
import { InstalledCatalogs } from '../../../../graph/contract/service/vocabulary.js';
import { CORE_LIBRARY, fieldIdOf, shippedTypeId } from '../../../../graph/contract/wire/tags/identity.js';
import { isEnabled } from '../../../../graph/contract/wire/tags/law.js';
import { SECTION_JOIN } from '../../../../graph/contract/wire/tags/sections.js';
import { ensureVocabulary } from '../../../../graph/serving/birth.js';
import { block, blockTag } from '../../../../graph/store/tables.js';
import { workCatalog } from '../../../../graph/steps/workCatalog.js';
import { TagIndex } from '../../../../graph/vocabulary/tagIndex.js';
import { BEHAVIOUR_REGISTRY } from '../../composed.js';
import { demoGraphLayer, withDemo } from '../../graphFixture.js';

type Raw = Record<string, unknown>;

type Stored = {
  readonly id: number;
  readonly title: string;
  readonly body: string;
  readonly tags: readonly string[];
  readonly fields: Raw;
};

const stored = (rows: readonly Stored[]) => rows.map(({ id, title, body, tags, fields }) => ({ id, title, body, tags, fields }));

const WAS = 'software-development';
const WORK = 'work';
const EARLIER = 'An earlier task.';

const olderText = (text: string): string =>
  text
    .replaceAll(`shipped:${WORK}/`, `shipped:${WAS}/`)
    .replaceAll(shippedTypeId(CORE_LIBRARY, 'rule'), shippedTypeId(WAS, 'rule'))
    .replaceAll(`"library":"${WORK}"`, `"library":"${WAS}"`)
    .replaceAll(`"library":"${CORE_LIBRARY}","export":"rule"`, `"library":"${WAS}","export":"rule"`);

const older = (value: unknown): Raw => JSON.parse(olderText(JSON.stringify(value))) as Raw;

const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? [...value] : []);

layer(demoGraphLayer(), { excludeTestServices: true })('work catalog', (it) => {
  it.effect('a graph typing the general tags by software-development moves them to core and work once, keeping every carrier', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, projectId, root } = demo;
        const { db } = graph.graphStore;
        const declared = Effect.fnUntraced(function* (id: string) {
          const name = (yield* demo.table()).identities.typeOf(id)?.declaration;
          if (name === undefined || name === null) return yield* Effect.die(`#${id} is not declared`);
          return yield* graph.blocks.blockById(yield* graph.blockNames.idOfName(name));
        });
        const ruleType = yield* declared('rule');
        yield* graph.blocks.update({ id: ruleType.id, body: `${ruleType.body}${SECTION_JOIN}Ours.` });
        const rule = yield* graph.blocks.create({ projectId, parentId: root, tags: ['rule'], title: 'Name files by meaning' });
        const task = yield* graph.blocks.create({ projectId, parentId: root, tags: ['task'], title: 'open work' });
        yield* db
          .update(block)
          .set({ fields: { enabled: false, delivery: 'prompt' } })
          .where(eq(block.id, rule.id));
        const status = fieldIdOf(shippedTypeId(WORK, 'task'), 'status');
        const sort = { by: 'created', order: 'asc' } as const;
        const view = yield* graph.blocks.create({
          projectId,
          parentId: root,
          contract: 'core/selection',
          title: 'open work',
          fields: { query: { tags: [shippedTypeId(WORK, 'task')], fields: { [status]: 'open' }, sort } },
        });
        const carriers = [rule.id, task.id, view.id];
        const carried = Effect.map(db.select().from(block).where(inArray(block.id, carriers)).orderBy(block.id), stored);
        const before = yield* carried;

        const standing = yield* db.select().from(block).where(eq(block.projectId, projectId));
        const listing = (id: string) => standing.find((row) => row.tags.includes('catalog') && row.fields.id === id)!;
        const [core, work, was] = [listing(CORE_LIBRARY), listing(WORK), listing(WAS)];
        const taskType = yield* declared('task');
        const ruleMember = listOf(core.fields.tags).find((name) => ruleType.uuid.replaceAll('-', '').endsWith(String(name)));
        const releaseOf = (row: typeof core) => row.fields.release as Raw;
        const earlierTask = (tag: unknown): unknown =>
          (tag as Raw).id === 'task'
            ? {
                ...(tag as Raw),
                prompt: EARLIER,
                sections: [
                  { key: 'task', text: EARLIER },
                  { key: 'project', text: '', edits: ['append'] },
                ],
              }
            : tag;
        for (const row of standing) {
          let fields = older(row.fields);
          let body = row.body;
          if (row.id === core.id) {
            fields = {
              ...fields,
              tags: listOf(fields.tags).filter((name) => name !== ruleMember),
              release: { ...releaseOf(row), tags: listOf(releaseOf(row).tags).filter((tag) => (tag as Raw).id !== 'rule') },
            };
          }
          if (row.id === was.id) {
            fields = {
              ...fields,
              tags: [...listOf(fields.tags), ...listOf(work.fields.tags), ruleMember],
              release: older({
                ...releaseOf(row),
                revision: 'before the work catalog',
                tags: [
                  ...listOf(releaseOf(row).tags),
                  ...listOf(releaseOf(work).tags).map(earlierTask),
                  listOf(releaseOf(core).tags).find((tag) => (tag as Raw).id === 'rule'),
                ],
              }),
            };
          }
          if (row.id === taskType.id) {
            fields = {
              ...fields,
              sections: [
                { key: 'task', text: EARLIER },
                { key: 'project', text: '', edits: ['append'] },
              ],
            };
            body = EARLIER;
          }
          const deletedAt = row.id === work.id ? new Date(1000) : row.deletedAt;
          yield* db.update(block).set({ fields, body, deletedAt }).where(eq(block.id, row.id));
        }
        const mine = standing.map((row) => row.id);
        for (const row of yield* db.select().from(blockTag).where(inArray(blockTag.blockId, mine))) {
          if (row.typeId === null) continue;
          yield* db
            .update(blockTag)
            .set({ typeId: olderText(row.typeId) })
            .where(and(eq(blockTag.blockId, row.blockId), eq(blockTag.tag, row.tag)));
        }
        yield* graph.tags.forget(projectId);
        const earlier = yield* demo.table();
        expect(earlier.identities.typeOf('task')?.id).toBe(shippedTypeId(WAS, 'task'));
        expect(earlier.identities.typeOf('rule')?.id).toBe(shippedTypeId(WAS, 'rule'));
        const selected = () => Effect.map(graph.reading.show(view.id, 0), (page) => (page.results?.items ?? []).map((row) => row.name));
        expect(yield* selected()).toEqual([yield* demo.nameOf(task.id)]);

        const project = yield* graph.projects.byId(projectId);
        yield* workCatalog(project);
        const once = yield* db.select().from(block).where(eq(block.projectId, projectId)).orderBy(block.id);
        yield* workCatalog(project);
        expect(yield* db.select().from(block).where(eq(block.projectId, projectId)).orderBy(block.id)).toEqual(once);

        const moved = yield* demo.table();
        expect(moved.unreadable).toEqual([]);
        expect(moved.identities.typeOf('task')?.id).toBe(shippedTypeId(WORK, 'task'));
        expect(moved.identities.typeOf('rule')?.id).toBe(shippedTypeId(CORE_LIBRARY, 'rule'));
        expect(yield* carried).toEqual(before);
        expect(yield* selected()).toEqual([yield* demo.nameOf(task.id)]);
        expect(
          yield* db.select({ tag: blockTag.tag, typeId: blockTag.typeId }).from(blockTag).where(eq(blockTag.blockId, task.id)),
        ).toEqual([{ tag: 'task', typeId: shippedTypeId(WORK, 'task') }]);

        yield* ensureVocabulary('machine');
        const installed = yield* demo.table();
        expect(yield* (yield* InstalledCatalogs).findings(projectId)).toEqual([]);
        expect(installed.tagById('task')).toEqual(new TagIndex(tagsOfCatalogs(DEFAULT_CATALOGS), BEHAVIOUR_REGISTRY).tagById('task'));
        expect(installed.tagById('rule')?.sections?.map((section) => [section.key, section.key === 'project' ? section.text : ''])).toEqual(
          [
            ['rule', ''],
            [WAS, ''],
            ['project', 'Ours.'],
          ],
        );
        expect(yield* carried).toEqual(before);
        const ruleRow = yield* graph.blocks.blockById(rule.id);
        expect(isEnabled(installed.lawProjection(ruleRow), ruleRow)).toBe(false);
      }),
    ),
  );
});
