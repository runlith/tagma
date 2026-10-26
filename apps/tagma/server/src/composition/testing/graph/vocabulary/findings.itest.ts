import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Context, Effect } from 'effect';
import { eq } from 'drizzle-orm';
import { demoGraphLayer, withDemo } from '../../graphFixture.js';
import { block } from '../../../../graph/store/tables.js';
import { releaseFindingsLeave } from '../../../../graph/steps/releaseFindingsLeave.js';
import { catalogAgentLeaves } from '../../../../graph/steps/catalogAgentLeaves.js';
import { briefsLeave } from '../../../../graph/steps/briefsLeave.js';
import { SHIPPED_CATALOGS } from '../../settings.js';
import { BEHAVIOUR_REGISTRY } from '../../../manifest.js';
import { softwareDevelopment } from '../../../../catalogs/contract/wire/softwareDevelopment.js';
import { ensureVocabulary } from '../../../../graph/serving/birth.js';
import { catalogFindings } from '../../../../graph/vocabulary/candidate.js';
import { installedOf, vocabularyRows } from '../../../../graph/vocabulary/installed.js';
import { InstalledCatalogs, Tags } from '../../../../graph/contract/service/vocabulary.js';
import { Catalogs } from '../../../../graph/contract/wire/catalogs.js';
import { type Catalog, sectioned } from '../../../../graph/contract/wire/tags/declaration.js';
import { SECTION_JOIN } from '../../../../graph/vocabulary/compiler.js';
import { catalogWriter } from '../../../../graph/vocabulary/install.js';

const TASK = softwareDevelopment.tags.find((tag) => tag.id === 'task')!;

const shipping = (catalog: Catalog) =>
  Catalogs.of({ ...SHIPPED_CATALOGS, byId: (id) => (id === catalog.id ? catalog : SHIPPED_CATALOGS.byId(id)) });

const nodes = Effect.fnUntraced(function* (projectId: number) {
  const listing = (yield* (yield* InstalledCatalogs).read(projectId)).find((catalog) => catalog.id === softwareDevelopment.id);
  const task = (yield* (yield* Tags).of(projectId)).identities.typeOf('task')?.declaration;
  if (listing === undefined || task === undefined || task === null) return yield* Effect.die('software-development is not installed');
  return { catalog: listing.name, task };
});

layer(demoGraphLayer(), { excludeTestServices: true })('catalog findings', (it) => {
  it.effect('a part written after the shipped text of a type becomes its project layer, and the next shipped text reaches it', () =>
    withDemo(({ graph, projectId, table, context }) =>
      Effect.gen(function* () {
        const { task } = yield* nodes(projectId);
        const id = yield* graph.blockNames.idOfName(task);
        yield* graph.blocks.update({ id, body: `${TASK.prompt}${SECTION_JOIN}Cite the file.` });
        expect((yield* graph.blocks.blockById(id)).fields.layer).toMatchObject({
          edits: [{ section: 'project', edit: 'append', text: 'Cite the file.' }],
        });
        expect(yield* (yield* InstalledCatalogs).findings(projectId)).toEqual([]);
        const reworded: Catalog = {
          ...softwareDevelopment,
          tags: softwareDevelopment.tags.map((tag) => (tag.id === 'task' ? sectioned({ ...tag, prompt: 'A task, reworded.' }) : tag)),
        };
        yield* (yield* catalogWriter(Context.add(context, Catalogs, shipping(reworded)), projectId))([softwareDevelopment.id]);
        expect((yield* table()).tagById('task')?.prompt).toBe(`A task, reworded.${SECTION_JOIN}Cite the file.`);
      }),
    ),
  );

  it.effect('a type rewritten outside its project section is kept with a finding until its body is the shipped text and a tail', () =>
    withDemo(({ graph, projectId, table }) =>
      Effect.gen(function* () {
        const { task } = yield* nodes(projectId);
        const id = yield* graph.blockNames.idOfName(task);
        yield* graph.blocks.update({ id, body: 'Our own task text.' });
        expect((yield* table()).tagById('task')?.prompt).toBe('Our own task text.');
        yield* ensureVocabulary('machine');
        expect((yield* table()).tagById('task')?.prompt).toBe('Our own task text.');
        const findings = yield* (yield* InstalledCatalogs).findings(projectId);
        expect(findings.map((finding) => [finding.kind, finding.name])).toEqual([['migration-conflict', task]]);
        const instructions = yield* graph.orientation.instructions({ projectId, audience: 'graph' });
        expect(instructions.entries.map((entry) => entry.source)).toContain(`migration-conflict ${task}`);
        yield* graph.blocks.update({ id, body: `${TASK.prompt}${SECTION_JOIN}Our own part.` });
        expect((yield* graph.blocks.blockById(id)).fields.layer).toMatchObject({ edits: [{ section: 'project', text: 'Our own part.' }] });
        expect(yield* (yield* InstalledCatalogs).findings(projectId)).toEqual([]);
        expect(
          (yield* graph.orientation.instructions({ projectId, audience: 'graph' })).entries.map((entry) => entry.source),
        ).not.toContain(`migration-conflict ${task}`);
      }),
    ),
  );

  it.effect(
    'catalog guidance takes a project tail as its layer, keeps a rewrite as a finding, and reports a fork the shipped text left',
    () =>
      withDemo(({ graph, projectId, context }) =>
        Effect.gen(function* () {
          const { catalog } = yield* nodes(projectId);
          const id = yield* graph.blockNames.idOfName(catalog);
          const findings = () => Effect.flatMap(InstalledCatalogs, (installed) => installed.findings(projectId));
          yield* graph.blocks.update({ id, body: 'Our own process.' });
          expect((yield* findings()).map((finding) => [finding.kind, finding.name])).toEqual([['migration-conflict', catalog]]);
          yield* graph.blocks.update({ id, body: `${softwareDevelopment.guidance}${SECTION_JOIN}Ours.` });
          expect(yield* findings()).toEqual([]);
          const reworded: Catalog = { ...softwareDevelopment, guidance: 'The catalog, reworded.' };
          yield* (yield* catalogWriter(Context.add(context, Catalogs, shipping(reworded)), projectId))([softwareDevelopment.id]);
          expect((yield* graph.blocks.blockById(id)).body).toBe(`The catalog, reworded.${SECTION_JOIN}Ours.`);
          yield* graph.blocks.update({ id, body: 'Forked.', fields: { fork: { at: 'an earlier revision' } } });
          yield* ensureVocabulary('machine');
          expect((yield* graph.blocks.blockById(id)).body).toBe('Forked.');
          expect((yield* findings()).map((finding) => [finding.kind, finding.name])).toEqual([['fork', catalog]]);
        }),
      ),
  );

  it.effect('a refused automatic upgrade stands in the graph instructions, and other findings of its catalog stay visible beside it', () =>
    withDemo(({ graph, projectId, table }) =>
      Effect.gen(function* () {
        const { catalog, task } = yield* nodes(projectId);
        const taskId = yield* graph.blockNames.idOfName(task);
        const catalogId = yield* graph.blockNames.idOfName(catalog);
        yield* graph.orientation.instructions({ projectId, audience: 'graph' });
        yield* graph.blocks.update({ id: taskId, body: `${TASK.prompt}${SECTION_JOIN}Cite the file.` });
        yield* graph.blocks.update({ id: catalogId, body: 'Our own process.' });
        const closed: Catalog = {
          ...softwareDevelopment,
          guidance: 'The catalog, reworded.',
          tags: softwareDevelopment.tags.map((tag) =>
            tag.id === 'task'
              ? {
                  ...tag,
                  sections: [
                    { key: 'task', text: tag.prompt },
                    { key: 'project', text: '' },
                  ],
                }
              : tag,
          ),
        };
        yield* ensureVocabulary('machine').pipe(Effect.provideService(Catalogs, shipping(closed)));
        expect((yield* table()).tagById('task')?.prompt).toBe(`${TASK.prompt}${SECTION_JOIN}Cite the file.`);
        const instructions = yield* graph.orientation.instructions({ projectId, audience: 'graph' });
        expect(instructions.entries.find((one) => one.source === `upgrade-blocked ${catalog}`)?.text).toContain('layer-forbidden');
        expect(instructions.entries.map((one) => one.source)).toContain(`migration-conflict ${catalog}`);
        const judged = catalogFindings(
          yield* table(),
          installedOf(yield* vocabularyRows(graph.graphStore.db, projectId)),
          shipping(closed),
          BEHAVIOUR_REGISTRY,
        );
        expect(judged.map((finding) => [finding.kind, finding.name])).toEqual([
          ['upgrade-blocked', catalog],
          ['upgrade-blocked', task],
          ['migration-conflict', catalog],
        ]);
      }),
    ),
  );

  it.effect(
    'a copy kept over an older base takes the current shipped text with a tail as its layer, and later shipped text reaches it',
    () =>
      withDemo(({ graph, projectId, table, context }) =>
        Effect.gen(function* () {
          const { task } = yield* nodes(projectId);
          const id = yield* graph.blockNames.idOfName(task);
          const withTask = (prompt: string): Catalog => ({
            ...softwareDevelopment,
            tags: softwareDevelopment.tags.map((tag) => (tag.id === 'task' ? sectioned({ ...tag, prompt }) : tag)),
          });
          const install = (catalog: Catalog) =>
            Effect.flatMap(catalogWriter(Context.add(context, Catalogs, shipping(catalog)), projectId), (write) =>
              write([softwareDevelopment.id]),
            );
          yield* install(withTask('An older task.'));
          yield* graph.blocks.update({ id, body: 'Our own task text.' });
          yield* ensureVocabulary('machine');
          expect((yield* (yield* InstalledCatalogs).findings(projectId)).map((finding) => [finding.kind, finding.name])).toEqual([
            ['migration-conflict', task],
          ]);
          yield* graph.blocks.update({ id, body: `${TASK.prompt}${SECTION_JOIN}Our part.` });
          expect(yield* (yield* InstalledCatalogs).findings(projectId)).toEqual([]);
          yield* install(withTask('A task, reworded.'));
          expect((yield* table()).tagById('task')?.prompt).toBe(`A task, reworded.${SECTION_JOIN}Our part.`);
        }),
      ),
  );

  it.effect('the graph step drops stored release conflicts and forks once, leaving the rest of the release', () =>
    withDemo(({ graph, projectId }) =>
      Effect.gen(function* () {
        const { catalog } = yield* nodes(projectId);
        const id = yield* graph.blockNames.idOfName(catalog);
        const row = yield* graph.blocks.blockById(id);
        const release = row.fields.release as Readonly<Record<string, unknown>>;
        const { db } = graph.graphStore;
        yield* db
          .update(block)
          .set({
            fields: { ...row.fields, release: { ...release, conflicts: ['#task: kept'], forks: [{ type: 'task', at: 'a', now: 'b' }] } },
          })
          .where(eq(block.id, id));
        const project = yield* graph.projects.byId(projectId);
        yield* releaseFindingsLeave(project);
        const once = yield* graph.blocks.blockById(id);
        expect(once.fields.release).toEqual(release);
        yield* releaseFindingsLeave(project);
        expect(yield* graph.blocks.blockById(id)).toEqual(once);
      }),
    ),
  );

  it.effect('the graph step drops a stored catalog agent from the own and the released profile once, leaving the rest', () =>
    withDemo(({ graph, projectId }) =>
      Effect.gen(function* () {
        const { catalog } = yield* nodes(projectId);
        const id = yield* graph.blockNames.idOfName(catalog);
        const row = yield* graph.blocks.blockById(id);
        const release = row.fields.release as Readonly<Record<string, unknown>>;
        const own = { checks: { code: true } };
        const { db } = graph.graphStore;
        yield* db
          .update(block)
          .set({
            fields: {
              ...row.fields,
              profile: { ...own, agent: 'rules' },
              release: { ...release, profile: { ...(release.profile as object), agent: 'developer' } },
            },
          })
          .where(eq(block.id, id));
        const project = yield* graph.projects.byId(projectId);
        yield* catalogAgentLeaves(project);
        const once = yield* graph.blocks.blockById(id);
        expect(once.fields).toEqual({ ...row.fields, profile: own, release });
        yield* catalogAgentLeaves(project);
        expect(yield* graph.blocks.blockById(id)).toEqual(once);
      }),
    ),
  );

  it.effect('catalog profiles migrate their own and released documents without losing the retained configuration', () =>
    withDemo(({ graph, projectId }) =>
      Effect.gen(function* () {
        const { catalog } = yield* nodes(projectId);
        const id = yield* graph.blockNames.idOfName(catalog);
        const row = yield* graph.blocks.blockById(id);
        const release = row.fields.release as Readonly<Record<string, unknown>>;
        const own = { checks: { code: false }, batch: [] };
        yield* graph.graphStore.db
          .update(block)
          .set({
            fields: {
              ...row.fields,
              profile: { ...own, brief: { sections: [] } },
              release: { ...release, profile: { ...(release.profile as object), brief: { sections: [] } } },
            },
          })
          .where(eq(block.id, id));
        yield* briefsLeave(yield* graph.projects.byId(projectId));
        expect((yield* graph.blocks.blockById(id)).fields).toEqual({ ...row.fields, profile: own, release });
      }),
    ),
  );

  it.effect('a layered type whose structure was edited is kept with a finding, and an upgrade does not erase the edit', () =>
    withDemo(({ graph, projectId, table, context }) =>
      Effect.gen(function* () {
        const { task } = yield* nodes(projectId);
        const id = yield* graph.blockNames.idOfName(task);
        yield* graph.blocks.update({ id, body: `${TASK.prompt}${SECTION_JOIN}Cite the file.` });
        yield* graph.blocks.update({ id, fields: { fields: { ...TASK.fields, estimate: 'number' } } });
        expect((yield* (yield* InstalledCatalogs).findings(projectId)).map((finding) => [finding.kind, finding.name])).toEqual([
          ['migration-conflict', task],
        ]);
        const reworded: Catalog = {
          ...softwareDevelopment,
          tags: softwareDevelopment.tags.map((tag) => (tag.id === 'task' ? sectioned({ ...tag, prompt: 'A task, reworded.' }) : tag)),
        };
        yield* (yield* catalogWriter(Context.add(context, Catalogs, shipping(reworded)), projectId))([softwareDevelopment.id]);
        expect((yield* table()).tagById('task')?.fields.estimate).toBe('number');
      }),
    ),
  );
});
