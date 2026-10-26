import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Effect, Layer, Schema } from 'effect';
import { eq } from 'drizzle-orm';
import { ensureVocabulary } from '../../../../graph/serving/birth.js';
import { block } from '../../../../graph/store/tables.js';
import { Blocks } from '../../../../graph/contract/service/blocks.js';
import { BlockNames } from '../../../../graph/contract/service/acts.js';
import { InstalledCatalogs, Tags } from '../../../../graph/contract/service/vocabulary.js';
import { SHIPPED_CATALOGS } from '../../settings.js';
import { tagSchema } from '../../../../graph/contract/wire/tags/declaration.js';
import { EXPLANATION } from '../../../../graph/contract/wire/tags/explanation.js';
import { shippedTypeId } from '../../../../graph/contract/wire/tags/identity.js';
import { isEnabled } from '../../../../graph/contract/wire/tags/law.js';
import { blockName } from '../../../../graph/contract/wire/references.js';
import { softwareDevelopment } from '../../../../catalogs/contract/wire/softwareDevelopment.js';
import { demoGraphLayer, withDemo } from '../../graphFixture.js';
import { tagNodeFields } from '../../../../graph/vocabulary/declarationRules.js';
import base from './base.json';
import { TagIndex } from '../../../../graph/vocabulary/tagIndex.js';
import { BEHAVIOUR_REGISTRY } from '../../../manifest.js';
import { reachLeaves } from '../../../../graph/steps/reachLeaves.js';
import { provenanceLeaves } from '../../../../graph/steps/provenanceLeaves.js';

const softwareDevelopmentIn = Effect.fnUntraced(function* (projectId: number) {
  const catalog = (yield* (yield* InstalledCatalogs).read(projectId)).find((entry) => entry.id === softwareDevelopment.id);
  if (catalog === undefined) return yield* Effect.die('software-development is not installed');
  return catalog;
});

const declarationOf = Effect.fn('catalogFixture.declaration')(function* (projectId: number, id: string) {
  const name = (yield* (yield* Tags).of(projectId)).identities.typeOf(id)?.declaration;
  if (name === undefined || name === null) return yield* Effect.die(`#${id} is not declared`);
  return yield* (yield* Blocks).blockById(yield* (yield* BlockNames).idOfName(name));
});

const PRIOR_TEXT = 'rules in the global graph bind across projects.';
const REACH_TEXT =
  'rules in the global graph bind every project, and one whose reach is `code` binds only the projects that work on code — set it on a rule about code, leave it unset on one about how an agent works.';

const reached = (tag: Readonly<Record<string, unknown>>) => ({
  ...tag,
  fields: { ...(tag.fields as Readonly<Record<string, unknown>>), reach: { type: 'schema', name: 'projectReach' } },
  roles: { ...(tag.roles as Readonly<Record<string, unknown>>), reach: 'reach' },
  prompt: typeof tag.prompt === 'string' ? tag.prompt.replace(PRIOR_TEXT, REACH_TEXT) : tag.prompt,
});

layer(demoGraphLayer().pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })('catalogs', (it) => {
  it.effect('installation keeps project-authored guidance and both audiences receive the same live law', () =>
    withDemo(({ graph, projectId, table, nameOf }) =>
      Effect.gen(function* () {
        const catalog = yield* softwareDevelopmentIn(projectId);
        const id = yield* graph.blockNames.idOfName(catalog.name);
        const guidance = 'This project uses its own documented process.';
        yield* graph.blocks.update({ id, body: guidance });
        yield* ensureVocabulary('machine');
        const reread = yield* softwareDevelopmentIn(projectId);
        expect(reread.name).toBe(catalog.name);
        expect(reread.guidance).toBe(guidance);
        expect(reread.tags).toEqual(catalog.tags);
        const rule = yield* graph.blocks.create({ projectId, tags: ['rule'], title: 'Preserve authored data' });
        const graphSet = yield* graph.orientation.instructions({ projectId, audience: 'graph' });
        expect(graphSet.entries.find((entry) => entry.kind === 'catalog' && entry.source === catalog.name)?.text).toContain(guidance);
        const executorSet = yield* graph.orientation.instructions({ projectId, audience: 'executor' });
        expect(executorSet.entries).toEqual(graphSet.entries.filter((entry) => entry.kind === 'law'));
        const name = yield* nameOf(rule.id);
        expect(executorSet.entries.some((entry) => entry.source === name)).toBe(true);
        yield* graph.blocks.update({ id: rule.id, title: 'Preserve authored data, always' });
        const retitled = yield* graph.orientation.instructions({ projectId, audience: 'executor' });
        expect(retitled.entries.find((entry) => entry.source === name)?.revision).not.toBe(
          executorSet.entries.find((entry) => entry.source === name)?.revision,
        );
        expect(graphSet.entries.filter((entry) => entry.kind === 'tag').map((entry) => entry.source)).toEqual(
          (yield* table()).tags.map((tag) => `#${tag.id}`),
        );
      }),
    ),
  );

  it.effect('a graph step upgrades the installed declaration and release base together before installation', () =>
    withDemo(({ graph, projectId }) =>
      Effect.gen(function* () {
        const catalog = yield* softwareDevelopmentIn(projectId);
        if (catalog.release === undefined) return yield* Effect.die('catalog has no release');
        const idea = yield* declarationOf(projectId, 'idea');
        const shipped = softwareDevelopment.tags.find((tag) => tag.id === 'idea');
        if (shipped === undefined) return yield* Effect.die('idea is not shipped');
        const catalogNode = yield* graph.blocks.blockById(yield* graph.blockNames.idOfName(catalog.name));
        const prior = { ...shipped, edges: ['discovered-from', ...shipped.edges], prompt: 'Earlier catalog guidance.' };
        const { db } = graph.graphStore;
        yield* db
          .update(block)
          .set({ body: prior.prompt, fields: { ...idea.fields, edges: prior.edges } })
          .where(eq(block.id, idea.id));
        yield* db
          .update(block)
          .set({
            fields: {
              ...catalogNode.fields,
              release: {
                ...catalog.release,
                revision: 'earlier-catalog',
                tags: catalog.release.tags.map((tag) => (tag.id === 'idea' ? prior : tag)),
              },
            },
          })
          .where(eq(block.id, catalogNode.id));
        yield* provenanceLeaves(yield* graph.projects.byId(projectId));
        yield* graph.tags.forget(projectId);
        yield* ensureVocabulary('machine');
        expect((yield* graph.blocks.blockById(idea.id)).body).toBe(shipped.prompt);
        expect(yield* (yield* InstalledCatalogs).findings(projectId)).toEqual([]);
      }),
    ),
  );

  it.effect('catalog writes validate identity and membership while reads preserve order and refuse corrupt targets', () =>
    withDemo(({ graph, projectId, refusal, nameOf }) =>
      Effect.gen(function* () {
        const catalogs = yield* InstalledCatalogs;
        const before = yield* catalogs.read(projectId);
        const catalog = before.find((entry) => entry.id === softwareDevelopment.id);
        if (catalog === undefined || catalog.tags[0] === undefined) return yield* Effect.die('catalog members are missing');
        expect(
          (yield* refusal(graph.blocks.create({ projectId, tags: ['catalog'], title: 'duplicate', fields: { id: catalog.id, tags: [] } })))
            .code,
        ).toBe('field-invalid');
        const ordinary = yield* graph.blocks.create({ projectId, title: 'ordinary catalog target' });
        expect(
          (yield* refusal(
            graph.blocks.create({
              projectId,
              tags: ['catalog'],
              title: 'invalid membership',
              fields: { id: 'invalid', tags: [yield* nameOf(ordinary.id)] },
            }),
          )).code,
        ).toBe('field-target');
        const id = yield* graph.blockNames.idOfName(catalog.name);
        const node = yield* graph.blocks.blockById(id);
        expect((yield* refusal(graph.blocks.update({ id, fields: { release: catalog.release } }))).code).toBe('operation-only');
        expect(yield* graph.blocks.blockById(id)).toEqual(node);
        expect(yield* catalogs.read(projectId)).toEqual(before);
        const member = yield* graph.blocks.blockById(yield* graph.blockNames.idOfName(catalog.tags[0]));
        const { db } = graph.graphStore;
        yield* db
          .update(block)
          .set({ fields: { ...node.fields, tags: [member.uuid.replaceAll('-', '').toUpperCase(), ...catalog.tags.slice(1)] } })
          .where(eq(block.id, id));
        expect(yield* catalogs.read(projectId)).toEqual(before);
        yield* db
          .update(block)
          .set({ deletedAt: new Date(1000) })
          .where(eq(block.id, member.id));
        expect((yield* refusal(catalogs.read(projectId))).code).toBe('deleted');
        yield* db.update(block).set({ deletedAt: null }).where(eq(block.id, member.id));
        yield* db
          .update(block)
          .set({ fields: { ...node.fields, tags: [yield* nameOf(ordinary.id)] } })
          .where(eq(block.id, id));
        expect((yield* refusal(catalogs.read(projectId))).code).toBe('field-target');
      }),
    ),
  );

  it.effect('hand-made declarations without a release base remain authored copies outside the installed release', () =>
    withDemo(({ graph, fixture, table }) =>
      Effect.gen(function* () {
        yield* graph.settings.write({ scope: 'user', key: SHIPPED_CATALOGS.key.id, value: [] });
        const rootPath = yield* fixture.directory('catalog-upgrade');
        const project = yield* graph.projectLifecycle.create({ name: 'catalog-upgrade', rootPath });
        const system = yield* table(project.id);
        const decoded = yield* Schema.decodeUnknownEffect(Schema.Array(tagSchema))(
          base.find((catalog) => catalog.id === 'code-project')?.tags,
        );
        const tags = decoded.filter((tag) => (tag.id === 'rule' || tag.id === 'task') && system.tagById(tag.id) === null);
        expect(tags.map((tag) => tag.id).sort()).toEqual(['rule', 'task']);
        const copies = [];
        for (const tag of tags) {
          const copy = yield* graph.blocks.create({
            projectId: project.id,
            tags: ['tag'],
            title: `#${tag.id}`,
            body: tag.id === 'task' ? 'Project-authored task guidance.' : tag.prompt,
            fields: tagNodeFields(tag),
          });
          copies.push(yield* graph.blocks.blockById(copy.id));
        }
        yield* graph.settings.write({
          scope: 'project',
          projectId: project.id,
          key: SHIPPED_CATALOGS.key.id,
          value: [softwareDevelopment.id],
        });
        const catalog = yield* softwareDevelopmentIn(project.id);
        const findings = yield* (yield* InstalledCatalogs).findings(project.id);
        expect(new Set(findings.map((finding) => [finding.kind, finding.name].join(' ')))).toEqual(
          new Set(copies.map((copy) => `migration-conflict ${blockName(copy.uuid)}`)),
        );
        expect(catalog.release?.tags.filter((tag) => tag.id === 'rule' || tag.id === 'task')).toEqual([]);
        const members = yield* graph.blockNames.idsOfNames(catalog.tags);
        for (const copy of copies) {
          expect([...members.values()]).not.toContain(copy.id);
          expect(yield* graph.blocks.blockById(copy.id)).toEqual(copy);
        }
        yield* ensureVocabulary('machine');
        expect(yield* softwareDevelopmentIn(project.id)).toEqual(catalog);
      }),
    ),
  );

  it.effect('a project combines code explanations with knowledge records in one installation', () =>
    withDemo(({ graph, fixture, table }) =>
      Effect.gen(function* () {
        const rootPath = yield* fixture.directory('explained-notebook');
        const project = yield* graph.projectLifecycle.create({
          name: 'explained-notebook',
          rootPath,
          catalogs: [softwareDevelopment.id, 'knowledge'],
        });
        const installed = yield* table(project.id);
        expect(installed.identities.typeOf('explanation')?.id).toBe(shippedTypeId(softwareDevelopment.id, 'explanation'));
        expect(installed.identities.typeOf('decision')?.id).toBe(shippedTypeId('knowledge', 'decision'));
        const explanation = yield* graph.blocks.create({
          projectId: project.id,
          tags: ['explanation'],
          title: 'why the cursor only moves forward',
        });
        const note = yield* graph.blocks.create({ projectId: project.id, title: 'a thought' });
        expect(installed.supports(explanation, EXPLANATION)).toBe(true);
        expect(installed.supports(note, EXPLANATION)).toBe(false);
        expect(yield* (yield* InstalledCatalogs).findings(project.id)).toEqual([]);
      }),
    ),
  );

  it.effect('a catalog member refuses to fall alone and can be deleted after its catalog falls', () =>
    withDemo(({ graph, projectId, refusal }) =>
      Effect.gen(function* () {
        const catalog = yield* softwareDevelopmentIn(projectId);
        const idea = yield* declarationOf(projectId, 'idea');
        const refused = yield* refusal(graph.trash.delete({ id: idea.id }));
        expect(refused.code).toBe('catalog-member');
        expect(refused.reason).toContain(catalog.name);
        expect(yield* graph.blocks.blockById(idea.id)).toEqual(idea);
        expect(yield* softwareDevelopmentIn(projectId)).toEqual(catalog);
        const showsIdea = () =>
          Effect.map(graph.orientation.instructions({ projectId, audience: 'graph' }), (set) =>
            set.entries.some((entry) => entry.source === '#idea'),
          );
        expect(yield* showsIdea()).toBe(true);
        yield* graph.trash.delete({ id: yield* graph.blockNames.idOfName(catalog.name) });
        yield* graph.trash.delete({ id: idea.id });
        expect((yield* (yield* InstalledCatalogs).read(projectId)).filter((entry) => entry.id === softwareDevelopment.id)).toEqual([]);
        expect(yield* showsIdea()).toBe(false);
      }),
    ),
  );

  it.effect('an installed rule gains enforcement in place while its standing rule keeps its complete stored state', () =>
    withDemo(({ graph, projectId, table }) =>
      Effect.gen(function* () {
        const catalog = yield* softwareDevelopmentIn(projectId);
        if (catalog.release === undefined) return yield* Effect.die('catalog has no release');
        const shipped = softwareDevelopment.tags.find((tag) => tag.id === 'rule');
        if (shipped === undefined) return yield* Effect.die('rule is not shipped');
        const ruleNode = yield* declarationOf(projectId, 'rule');
        const catalogNode = yield* graph.blocks.blockById(yield* graph.blockNames.idOfName(catalog.name));
        const previous = {
          ...shipped,
          fields: { enabled: 'boolean' as const },
          roles: { law: 'enabled' },
          prompt: 'The previous release of #rule.',
        };
        const { db } = graph.graphStore;
        yield* db
          .update(block)
          .set({ fields: tagNodeFields(previous), body: previous.prompt })
          .where(eq(block.id, ruleNode.id));
        yield* db
          .update(block)
          .set({
            fields: {
              ...catalogNode.fields,
              release: {
                ...catalog.release,
                revision: 'previous',
                tags: catalog.release.tags.map((tag) => (tag.id === 'rule' ? previous : tag)),
              },
            },
          })
          .where(eq(block.id, catalogNode.id));
        yield* graph.tags.forget(projectId);
        expect((yield* table()).lawProjectionOf('rule')?.enforcement).toBeNull();
        const standing = yield* graph.blocks.create({ projectId, tags: ['rule'], title: 'Written under the previous release' });
        const before = yield* graph.blocks.blockById(standing.id);
        yield* ensureVocabulary('machine');
        const upgraded = yield* table();
        expect(upgraded.tagById('rule')).toEqual(new TagIndex(softwareDevelopment.tags, BEHAVIOUR_REGISTRY).tagById('rule'));
        const reinstalled = yield* softwareDevelopmentIn(projectId);
        expect(yield* (yield* InstalledCatalogs).findings(projectId)).toEqual([]);
        expect(reinstalled.tags).toEqual(catalog.tags);
        const row = yield* graph.blocks.blockById(standing.id);
        expect(row).toEqual(before);
        expect(isEnabled(upgraded.lawProjection(row), row)).toBe(true);
      }),
    ),
  );

  it.effect('body declaration migration preserves the authored guidance and enforces its explicit cap idempotently', () =>
    withDemo(({ graph, projectId, refusal }) =>
      Effect.gen(function* () {
        const current = yield* graph.blocks.create({
          projectId,
          tags: ['tag'],
          title: 'Payload',
          body: 'An authored payload contract.',
          fields: { id: 'payload', body: { shape: 'content', cap: 8 } },
        });
        yield* graph.graphStore.db
          .update(block)
          .set({ fields: { ...current.fields, body: { shape: 'content', cap: 8, why: 100 } } })
          .where(eq(block.id, current.id));
        yield* ensureVocabulary('machine');
        const migrated = yield* graph.blocks.blockById(current.id);
        expect(migrated.body).toBe(current.body);
        expect(migrated.fields.body).toEqual({ shape: 'content', cap: 8 });
        expect(
          (yield* refusal(graph.blocks.create({ projectId, tags: ['payload'], title: 'Beyond its contract', body: '123456789' }))).code,
        ).toBe('body-capped');
        yield* ensureVocabulary('machine');
        expect(yield* graph.blocks.blockById(current.id)).toEqual(migrated);
      }),
    ),
  );

  for (const recorded of [true, false]) {
    it.effect(
      `a reach declaration and its carrier migrate idempotently${recorded ? ' with its release base' : ' after losing its release base'}`,
      () =>
        withDemo(({ graph, projectId, table }) =>
          Effect.gen(function* () {
            const catalog = yield* softwareDevelopmentIn(projectId);
            if (catalog.release === undefined) return yield* Effect.die('catalog has no release');
            const ruleNode = yield* declarationOf(projectId, 'rule');
            const listing = yield* graph.blocks.blockById(yield* graph.blockNames.idOfName(catalog.name));
            const written = yield* graph.blocks.create({ projectId, tags: ['rule'], title: 'Written with a reach' });
            const release = catalog.release;
            const tags = release.tags.flatMap<Readonly<Record<string, unknown>>>((tag) =>
              tag.id !== 'rule' ? [tag] : recorded ? [reached(tag)] : [],
            );
            const { db } = graph.graphStore;
            yield* db
              .update(block)
              .set({ fields: { ...listing.fields, release: { ...release, tags } } })
              .where(eq(block.id, listing.id));
            yield* db
              .update(block)
              .set({
                fields: { ...reached(ruleNode.fields), identity: { shipped: { library: softwareDevelopment.id, export: 'rule' } } },
                body: ruleNode.body.replace(PRIOR_TEXT, REACH_TEXT),
              })
              .where(eq(block.id, ruleNode.id));
            yield* db
              .update(block)
              .set({ fields: { reach: 'code' } })
              .where(eq(block.id, written.id));
            yield* graph.tags.forget(projectId);
            expect((yield* table()).tagById('rule')).toBeNull();
            const project = yield* graph.projects.byId(projectId);
            yield* reachLeaves(project);
            const once = yield* db.select().from(block).where(eq(block.projectId, projectId));
            yield* reachLeaves(project);
            expect(yield* db.select().from(block).where(eq(block.projectId, projectId))).toEqual(once);
            yield* graph.tags.forget(projectId);
            yield* ensureVocabulary('machine');
            const upgraded = yield* table();
            expect(upgraded.tagById('rule')).toEqual(new TagIndex(softwareDevelopment.tags, BEHAVIOUR_REGISTRY).tagById('rule'));
            expect(yield* (yield* InstalledCatalogs).findings(projectId)).toEqual([]);
            const row = yield* graph.blocks.blockById(written.id);
            expect(row.fields).toEqual({});
            expect(isEnabled(upgraded.lawProjection(row), row)).toBe(true);
          }),
        ),
    );
  }
});
