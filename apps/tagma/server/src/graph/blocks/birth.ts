import { Clock, Effect } from 'effect';
import { Git } from '@runlith/git/Git';
import { CallerAim } from '../../platform/contract/service/place.js';
import { gitRefusal } from '../../platform/git/readings.js';
import { checkoutAt, standsAside } from '../../workspace/checkouts/git.js';
import { measuredRoot } from '../contract/service/serving.js';
import { Tasks } from '../contract/service/work.js';
import { type BlockCreateRefusal, Edges, type FarLink } from '../contract/service/blocks.js';
import { type BlockCreate } from '../contract/wire/creation.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { GraphStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { block } from '../store/tables.js';
import { assertRequiredSources } from '../sources/readers/place.js';
import { Sources } from '../contract/service/sources.js';
import { Act, type BlockWrite } from '../contract/service/acts.js';
import { mintBlockId } from '../contract/wire/identity.js';
import { blockName } from '../contract/wire/references.js';
import { hasTag, tagLabel } from '../contract/wire/tags/roles.js';
import { lifecycleOf } from '../contract/wire/tags/lifecycle.js';
import { AMENDMENT } from '../contract/wire/tags/amendment.js';
import { LEAF } from '../contract/wire/tags/leaf.js';
import { CONTAINER } from '../contract/wire/tags/container.js';
import type { TagTable } from '../contract/wire/tags/table.js';
import { type Tag, TAG_DECLARATION } from '../contract/wire/tags/declaration.js';
import { assertCatalog } from '../vocabulary/catalogs.js';
import { assertComposable, assertRequiredFields, validateFields } from '../vocabulary/declarationRules.js';
import { namedWrite } from '../vocabulary/naming.js';
import { Tags } from '../contract/service/vocabulary.js';
import { Catalogs } from '../contract/wire/catalogs.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { BlockProjection, BlockReferences } from '../contract/service/acts.js';
import { BlockRows } from '../acts/rows.js';
import {
  assertBarePayload,
  assertBareRefs,
  assertBodyCap,
  assertNotOperated,
  assertTagNode,
  boundaryRefusal,
  leafRefusal,
} from './guards.js';
import { MODULE } from '../contract/wire/tags/moduleContract.js';
import { fieldTargetGuard, vocabularyCloser } from '../vocabulary/carriers.js';
import { checkedLayer } from '../vocabulary/layerWrite.js';
import { writes } from '../../platform/contract/service/writes.js';
import { linking, placing, projecting, referencing } from '../store/actWrites.js';

const creating = writes('Blocks.create', [block], projecting, referencing, linking, placing);

export function resolveTags(
  shipped: Catalogs['Service'],
  table: TagTable,
  ids: readonly string[],
): Effect.Effect<Tag[], GateRefusal<'tag-undeclared'>> {
  const tags: Tag[] = [];
  for (const id of ids) {
    const tag = table.tagById(id);
    if (tag === null) {
      const declaredBy = shipped.declaring(id);
      const unread = table.unreadable.find((entry) => entry.id === id);
      const standing = `the tags this project declares: ${table
        .declaredTags()
        .map((declared) => `#${declared}`)
        .join(', ')}`;
      const switchOn =
        declaredBy.length === 0
          ? undefined
          : `#${id} is declared by the ${declaredBy.join(' and ')} catalog: switch it on with write_setting graph.catalogs, and its tags are installed here`;
      return new GateRefusal('tag-undeclared', `this project declares no #${id}`, [
        switchOn ?? standing,
        ...(switchOn === undefined ? [] : [standing]),
        ...(unread === undefined ? [] : [`${unread.name} stands here and could not be read: ${unread.reason}`]),
        `create_block with tags: ['${TAG_DECLARATION.id}'] declares a tag of your own, checked and gated like any other`,
      ]);
    }
    tags.push(tag);
  }
  return Effect.succeed(tags);
}

export function bornFields(tags: readonly Tag[], written: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const fields: Record<string, unknown> = { ...written };
  for (const tag of tags) {
    const lifecycle = lifecycleOf(tag);
    if (lifecycle !== null) fields[lifecycle.field] = lifecycle.initial;
  }
  return fields;
}

export const blockBirth = Effect.gen(function* () {
  const { db } = yield* GraphStore;
  const act = yield* Act;
  const blockProjection = yield* BlockProjection;
  const blockReferences = yield* BlockReferences;
  const blockRows = yield* BlockRows;
  const projects = yield* Projects;
  const git = yield* Git;
  const edges = yield* Edges;
  const sources = yield* Sources;
  const vocabulary = yield* Tags;
  const shipped = yield* Catalogs;
  const tasks = yield* Tasks;
  const assertFieldTargets = yield* fieldTargetGuard;
  const closeVocabulary = yield* vocabularyCloser;

  return Effect.fn('Blocks.create')(function* (
    input: BlockCreate & { readonly farEdges?: readonly FarLink[] },
  ): Effect.fn.Return<BlockWrite, StoreFailure | GateRefusal<BlockCreateRefusal>> {
    const now = new Date(yield* Clock.currentTimeMillis);
    const project = yield* projects.byId(input.projectId);
    const table = yield* vocabulary.of(input.projectId);
    const selected =
      input.tags === undefined && input.contract !== undefined ? [(yield* table.creationType(input.contract)).id] : (input.tags ?? []);
    const ids = selected.map((word) => table.identities.keyOf(word) ?? word);
    const tags = yield* resolveTags(shipped, table, ids);
    if (input.contract !== undefined && !table.supports({ tags: ids }, input.contract)) {
      return yield* new GateRefusal('creation-contract', `the selected types do not support ${input.contract}`, [
        'omit tags to select the installed creation default, or name types supporting the required contract',
      ]);
    }
    const born = { tags: ids, fields: yield* namedWrite(table.identities, tags, null, input.fields ?? {}) };
    if (table.supports(born, MODULE)) return yield* boundaryRefusal(`the new ${tagLabel(table.tagOf(born))}`, 'created');
    yield* assertComposable(tags);
    yield* assertNotOperated(table, tags, born.fields, 'at birth');
    const layered = hasTag(born, TAG_DECLARATION.id)
      ? yield* checkedLayer(db, input.projectId, table, born.fields)
      : { fields: born.fields, prompt: null };
    born.fields = layered.fields;
    yield* validateFields(tags, born.fields);
    yield* assertFieldTargets(table, input.projectId, tags, born.fields);
    const fields = bornFields(tags, born.fields);
    yield* assertRequiredFields(tags, fields);
    const amends = table.supports(born, AMENDMENT);
    if (amends && input.amendsId === undefined) {
      return yield* new GateRefusal('amends-missing', `${tagLabel(table.tagOf(born))} amends one node, named as it is filed`, [
        'name the block this amendment is about: it is born under it, with the amends edge',
      ]);
    }
    if (!amends && input.amendsId !== undefined) {
      return yield* new GateRefusal('amends-shape', `${tagLabel(table.tagOf(born))} supports no ${AMENDMENT}, so it amends nothing`, [
        'link_blocks with relates or discovered-from — a connection that is not an amendment',
      ]);
    }
    if (amends && (input.sources?.length ?? 0) > 0) {
      const cwd = (yield* CallerAim)?.cwd;
      if (cwd !== undefined) {
        const measured = yield* measuredRoot(project);
        if (standsAside(yield* Effect.mapError(checkoutAt(git, cwd), gitRefusal), project.repoKey, measured)) {
          return yield* new GateRefusal('tree-not-measured', `proposal sources name ${cwd}, and this graph measures ${measured}`, [
            `file the proposal from ${measured} — the checkout every source of this graph names`,
            'or aim the proposal at the branch you read: each checkout serves its own graph, measured where it stands',
          ]);
        }
      }
    }
    yield* assertBodyCap(tags, input.body ?? '');
    yield* assertBareRefs(layered.prompt ?? input.body ?? '');
    if (input.parentId !== undefined) {
      const parent = yield* blockRows.blockById(input.parentId);
      if (parent.projectId !== input.projectId) {
        return yield* new GateRefusal('cross-project-parent', 'parent belongs to another project', [
          `name a parent of project ${input.projectId}, or create the block in the parent's project`,
        ]);
      }
      if (!amends && table.supports(parent, LEAF)) return yield* leafRefusal(`${blockName(parent.uuid)}`);
    }
    const named = input.amendsId ?? input.parentId;
    const parentId = named ?? (yield* blockRows.rootBlockOf(input.projectId)).id;
    const uuid = input.uuid ?? mintBlockId();
    if (amends) yield* assertBarePayload(table, { uuid, tags: ids, fields });
    const future = { tags: ids, projectId: input.projectId, uuid };
    const near: { readonly kind: string; readonly to: number }[] = [];
    const far: FarLink[] = [...(input.farEdges ?? [])];
    for (const link of input.edges ?? []) {
      const to = yield* blockRows.blockById(link.to);
      if (to.projectId === input.projectId) {
        yield* edges.assertEdge(future, to, link.kind);
        near.push(link);
      } else far.push({ kind: link.kind, end: yield* edges.farBlockOf(to, link.kind) });
    }
    for (const link of far) yield* edges.assertFarEdge(future, link.end, link.kind);
    return yield* act.unit(
      creating,
      Effect.gen(function* () {
        const declaring = hasTag(born, TAG_DECLARATION.id);
        const before = declaring ? yield* vocabulary.of(input.projectId) : table;
        if (declaring) yield* assertTagNode(before, { fields, body: layered.prompt ?? input.body ?? '' }, null);
        const ord = yield* blockRows.nextOrd(parentId);
        const row = yield* db
          .insert(block)
          .values({
            uuid,
            projectId: input.projectId,
            parentId,
            ord,
            tags: ids,
            fields,
            title: input.title,
            body: layered.prompt ?? input.body ?? '',
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get();
        if (!row) return yield* Effect.die('block insert returned no row');
        yield* assertCatalog(db, row);
        yield* blockReferences.syncRefs(row.id, row.body, { projectId: row.projectId });
        yield* blockProjection.syncBorn(row, (input.sources ?? []).length === 0);
        if (declaring) yield* closeVocabulary(input.projectId, before, yield* vocabulary.of(input.projectId), null);
        yield* act.record('create', row, { kind: table.tagOf(born)?.id ?? null, chars: row.body.length }, now);
        for (const link of near) yield* blockRows.insertEdge(row.id, link.kind, link.to);
        for (const link of far) yield* blockRows.insertFarEdge(row.id, link.kind, link.end.target);
        if (input.amendsId !== undefined) yield* blockRows.insertEdge(row.id, 'amends', input.amendsId);
        for (const source of input.sources ?? []) yield* sources.place(row, source);
        yield* assertRequiredSources(
          tags,
          input.sources ?? [],
          `create_block with the source it stands over: what a node of this tag is about is the place it names`,
        );
        if (input.claim === true) return { ...(yield* tasks.claim({ id: row.id })), refsIn: [] };
        return yield* blockRows.written(row, false);
      }),
    );
  });
});
