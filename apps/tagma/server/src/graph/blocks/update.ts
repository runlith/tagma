import { Clock, Effect, Layer, Result } from 'effect';
import type { Git } from '@runlith/git/Git';
import { Tasks } from '../contract/service/work.js';
import { type BlockUpdate, type BlockUpdateRefusal, Blocks, Edges, type RetagRefusal } from '../contract/service/blocks.js';
import { Catalogs } from '../contract/wire/catalogs.js';
import { Behaviours } from '../contract/service/behaviours.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { and, eq, isNull } from 'drizzle-orm';
import { GraphStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { WriterRegister } from '../../platform/contract/service/writers.js';
import { block } from '../store/tables.js';
import { bodyDelta } from './bodyDiff.js';
import { Sources } from '../contract/service/sources.js';
import { Act, type BlockRow, type BlockWrite } from '../contract/service/acts.js';
import { checkTransition } from '../work/lifecycle.js';
import { moveOwners } from '../contract/wire/tags/actions.js';
import { blockName } from '../contract/wire/references.js';
import { hasTag, tagLabel } from '../contract/wire/tags/roles.js';
import { CATALOG_DECLARATION, type Tag, TAG_DECLARATION } from '../contract/wire/tags/declaration.js';
import type { TagTable } from '../contract/wire/tags/table.js';
import { assertCatalog } from '../vocabulary/catalogs.js';
import { assertRequiredFields, declarationId, declaringTag, validateFields } from '../vocabulary/declarationRules.js';
import { fieldKeysOf, namedWrite } from '../vocabulary/naming.js';
import { advanceLaw, lawShapingTypes } from '../store/lawRevision.js';
import { assertCarried, blockRetag, retagBase } from './retag.js';
import { Tags } from '../contract/service/vocabulary.js';
import { ActState } from '../contract/service/transaction.js';
import { assertStanding } from '../work/retirement.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { BlockNames, BlockProjection, BlockReferences } from '../contract/service/acts.js';
import { BlockRows } from '../acts/rows.js';
import { assertBareRefs, assertBodyCap, assertNoBoundary, assertNotOperated, assertTagNode, leafRefusal } from './guards.js';
import { checkedText } from '../vocabulary/layerWrite.js';
import { fieldTargetGuard, vocabularyCloser } from '../vocabulary/carriers.js';
import { blockBirth } from './birth.js';
import { blockArrival } from './arrival.js';
import { blockEdit } from './edit.js';
import { blockLaw } from './law.js';
import { blockModules } from './modules.js';
import { writes } from '../../platform/contract/service/writes.js';
import { projecting, referencing } from '../store/actWrites.js';
import { LIFECYCLE, lifecycleOf } from '../contract/wire/tags/lifecycle.js';
import { AMENDMENT } from '../contract/wire/tags/amendment.js';
import { LEAF } from '../contract/wire/tags/leaf.js';

const updating = writes('Blocks.update', [block], projecting, referencing);

const droppedFields = (
  table: TagTable,
  typeKeys: readonly string[],
  node: BlockRow,
  tags: readonly Tag[],
  nulls: readonly string[],
): Effect.Effect<readonly string[], GateRefusal<'field-invalid'>> => {
  if (nulls.length === 0) return Effect.succeed([]);
  const keyed = fieldKeysOf(table.identities, typeKeys, Object.fromEntries(nulls.map((name) => [name, null])));
  if (Result.isFailure(keyed)) {
    return new GateRefusal('field-invalid', `"${keyed.failure.name}" names more than one field (${keyed.failure.keys.join(', ')})`, [
      `name the field by its key: ${keyed.failure.keys.join(' or ')}`,
    ]);
  }
  const names = Object.keys(keyed.success);
  const unknown = names.find((name) => node.fields[name] === undefined && declaringTag(tags, name) === null);
  if (unknown === undefined) return Effect.succeed(names);
  return new GateRefusal('field-invalid', `${blockName(node.uuid)} carries no "${unknown}" and no tag of it declares one`, [
    'null drops a value the block carries; name a field it carries or its tags declare',
  ]);
};

export const blockUpdate = Effect.gen(function* () {
  const { db } = yield* GraphStore;
  const act = yield* Act;
  const blockNames = yield* BlockNames;
  const blockProjection = yield* BlockProjection;
  const blockReferences = yield* BlockReferences;
  const blockRows = yield* BlockRows;
  const vocabulary = yield* Tags;
  const shipped = yield* Catalogs;
  const assertFieldTargets = yield* fieldTargetGuard;
  const closeVocabulary = yield* vocabularyCloser;
  const { plan: retagPlan, settle: settleRetag } = yield* blockRetag;

  const assertNoTreeCycle = Effect.fn('Blocks.assertNoTreeCycle')(function* (
    id: number,
    newParentId: number,
  ): Effect.fn.Return<void, StoreFailure | GateRefusal<'tree-cycle' | 'not-found' | 'deleted'>> {
    let cursor: number | null = newParentId;
    while (cursor !== null) {
      if (cursor === id) {
        return yield* new GateRefusal('tree-cycle', 'a block cannot be moved under its own descendant', [
          'move the descendant out from under it first, then move this block beneath it',
        ]);
      }
      const above: BlockRow = yield* blockRows.blockById(cursor);
      cursor = above.parentId;
    }
  });

  const write = Effect.fn('Blocks.update')(function* (
    input: BlockUpdate,
  ): Effect.fn.Return<BlockWrite, StoreFailure | GateRefusal<BlockUpdateRefusal | RetagRefusal>> {
    const asked = input;
    const current = yield* blockRows.blockById(input.id);
    const table = yield* vocabulary.of(current.projectId);
    const tag = table.tagOf(current);
    if (input.tags !== undefined && tag === null && current.parentId === null) {
      return yield* new GateRefusal('project-root', 'the project root carries no tag', [
        'the root IS the project: tag a block under it, or create one with the tags it needs',
      ]);
    }
    const retag = input.tags === undefined ? null : yield* retagPlan(table, current, input.tags);
    const node = retag === null ? current : { ...current, tags: [...retag.ids], fields: retagBase(table, current, retag) };
    const tags = table.tagsOf(node);
    const statusTag = table.bindingTag(node, LIFECYCLE);
    const statusField = (statusTag === null ? undefined : lifecycleOf(statusTag)?.field) ?? null;
    const standingStatus = table.statusOf(node);
    if (input.status !== undefined && input.status !== standingStatus) {
      const actions = table.actionsOn(node);
      const owners = statusField === null ? [] : moveOwners(actions, statusField, standingStatus, input.status);
      if (owners.length > 0) {
        return yield* new GateRefusal('status-operation', `"${input.status}" is set by its own operation, not by update`, [
          `${owners.map((owner) => owner.op).join(' or ')} on ${blockName(current.uuid)}`,
          `the moves of ${tagLabel(statusTag)} that operations make: ${actions.moves
            .map((move) => `${move.from === undefined ? '' : `${move.from.join(' | ')} → `}${move.to} — ${move.op}`)
            .join(', ')}`,
        ]);
      }
      const verdict = checkTransition(actions, statusTag, standingStatus, input.status);
      if (!verdict.ok) return yield* new GateRefusal(verdict.code, verdict.reason, verdict.unblock);
    }
    const parentId = input.parentId === null ? (yield* blockRows.rootBlockOf(current.projectId)).id : input.parentId;
    input = { ...input, parentId };
    if (parentId !== undefined) {
      if (tag === null && current.parentId === null) {
        return yield* new GateRefusal('project-root', 'the project root is not moved under another block', [
          "the root IS the project: re-pointing the checkout it stands for is the registry's act, not a move in the tree",
        ]);
      }
      const parent = yield* blockRows.blockById(parentId);
      if (parent.projectId !== current.projectId) {
        return yield* new GateRefusal('cross-project-parent', 'parent belongs to another project', [
          `name a parent of project ${current.projectId}: a block never leaves its own graph`,
        ]);
      }
      if (!table.supports(current, AMENDMENT) && table.supports(parent, LEAF)) {
        return yield* leafRefusal(`${blockName(parent.uuid)}`);
      }
      yield* assertNoTreeCycle(input.id, parentId);
      if (parentId !== current.parentId)
        yield* assertNoBoundary(table, [current, ...(yield* blockRows.collectDescendants(current.id))], 'moved');
    }
    if (retag !== null) yield* assertBodyCap(tags, input.body ?? current.body);
    else if (input.body !== undefined) yield* assertBodyCap(tags, input.body, current.body);

    if (
      (input.title !== undefined && input.title !== current.title) ||
      (input.body !== undefined && input.body !== current.body) ||
      input.fields !== undefined
    ) {
      yield* assertStanding(blockRows, blockNames, input.id, 'have its text rewritten');
    }

    const written = input.fields ?? {};
    const nulls = Object.keys(written).filter((name) => written[name] === null);
    if (nulls.length > 0 && (hasTag(current, TAG_DECLARATION.id) || hasTag(current, CATALOG_DECLARATION.id))) {
      return yield* new GateRefusal('field-invalid', `${blockName(current.uuid)} is a declaration, and null drops none of its parts`, [
        `write the part's new value: a declaration's parts and identity change through their own checked values`,
      ]);
    }
    const valued = nulls.length === 0 ? input.fields : Object.fromEntries(Object.entries(written).filter(([, value]) => value !== null));
    const named = valued === undefined ? undefined : yield* namedWrite(table.identities, tags, node.fields, valued);
    const dropping = yield* droppedFields(table, [...new Set([...current.tags, ...node.tags])], node, tags, nulls);
    const drops = retag === null ? Object.fromEntries(dropping.map((name) => [name, null])) : {};
    if (named !== undefined) yield* assertNotOperated(table, tags, { ...named, ...drops }, 'by update');
    const texted =
      hasTag(current, TAG_DECLARATION.id) || hasTag(current, CATALOG_DECLARATION.id)
        ? yield* checkedText(db, current.projectId, table, shipped, current, named, input.body)
        : null;
    const cleared = [...(texted?.cleared ?? []), ...dropping];
    const moved =
      texted === null || (named === undefined && Object.keys(texted.fields).length === 0 && texted.cleared.length === 0)
        ? named
        : texted.fields;
    if (texted !== null && texted.body !== null) input = { ...input, body: texted.body };
    if (input.body !== undefined && input.body !== current.body) yield* assertBareRefs(input.body);
    if (moved !== undefined) {
      yield* validateFields(tags, moved);
      yield* assertFieldTargets(table, current.projectId, tags, moved);
    }
    const kept = (fields: Readonly<Record<string, unknown>>): Record<string, unknown> =>
      Object.fromEntries(Object.entries(fields).filter(([name]) => !cleared.includes(name)));
    const nextFields = moved === undefined && retag === null ? current.fields : kept({ ...node.fields, ...moved });
    if (retag !== null) {
      yield* assertCarried(table, blockName(current.uuid), retag, nextFields, current.fields);
      yield* validateFields(tags, nextFields);
      yield* assertFieldTargets(table, current.projectId, tags, nextFields);
    }
    if (moved !== undefined || retag !== null) yield* assertRequiredFields(tags, nextFields);
    const declaring =
      hasTag(current, TAG_DECLARATION.id) && (moved !== undefined || (input.body !== undefined && input.body !== current.body));
    const nextStatus =
      input.status ?? (retag === null ? undefined : (table.statusOf({ tags: node.tags, fields: nextFields }) ?? undefined));
    const statusFields = new Set(
      nextStatus === undefined
        ? []
        : [statusField, ...table.tagsOf(current).flatMap((one) => lifecycleOf(one)?.field ?? [])].filter((name) => name !== null),
    );
    const touched =
      retag !== null
        ? [...new Set([...Object.keys(current.fields), ...Object.keys(nextFields)])].filter((name) => !statusFields.has(name))
        : moved === undefined
          ? undefined
          : [...Object.keys(moved), ...cleared];
    const replacedFields =
      touched === undefined
        ? undefined
        : Object.fromEntries(
            touched.flatMap((name) =>
              JSON.stringify(current.fields[name]) === JSON.stringify(nextFields[name]) ? [] : [[name, current.fields[name]] as const],
            ),
          );
    const shapedLaw = retag !== null && retag.was.some((one) => lawShapingTypes(table).includes(one.id));

    const reparenting = input.parentId !== undefined && input.parentId !== current.parentId;
    const renamed = input.title !== undefined && input.title !== current.title;
    const rewritten = input.body !== undefined && input.body !== current.body;

    const now = new Date(yield* Clock.currentTimeMillis);
    const ord = input.ord ?? (reparenting && input.parentId != null ? yield* blockRows.nextOrd(input.parentId) : current.ord);
    return yield* act.unit(
      updating,
      Effect.gen(function* () {
        const writesFields = retag !== null || input.status !== undefined || moved !== undefined;
        const fresh = writesFields ? yield* blockRows.blockById(input.id) : current;
        const stale =
          JSON.stringify(fresh.tags) !== JSON.stringify(current.tags) ||
          (retag !== null && (JSON.stringify(fresh.fields) !== JSON.stringify(current.fields) || fresh.body !== current.body));
        if (stale) return yield* write(asked);
        if (retag !== null) yield* settleRetag(table, fresh, retag);
        const standing = kept({ ...(retag === null ? fresh.fields : retagBase(table, fresh, retag)), ...moved });
        const stated = declaring ? declarationId(fresh) : null;
        const before = stated === null ? table : yield* vocabulary.of(current.projectId);
        const declaredAs =
          stated === null
            ? null
            : yield* assertTagNode(
                before,
                { fields: standing, body: input.body ?? fresh.body },
                { id: stated, name: blockName(current.uuid) },
              );
        const row = yield* db
          .update(block)
          .set({
            title: input.title,
            body: input.body,
            parentId: input.parentId,
            ord: (input.parentId !== undefined && input.parentId !== current.parentId) || input.ord !== undefined ? ord : undefined,
            tags: retag === null ? undefined : [...retag.ids],
            fields: !writesFields
              ? undefined
              : input.status === undefined || statusField === null
                ? standing
                : { ...standing, [statusField]: input.status },
            updatedAt: now,
          })
          .where(eq(block.id, input.id))
          .returning()
          .get();
        if (!row) return yield* Effect.die('block update returned no row');
        yield* assertCatalog(db, row);
        if (input.body !== undefined && input.body !== current.body) yield* blockReferences.syncRefs(row.id, row.body);
        if (renamed || rewritten) yield* blockProjection.syncSearch(row.id);
        if (writesFields) yield* blockProjection.syncTags(row.id);
        else if (input.body !== undefined) yield* blockProjection.forgetVocabulary([row.id]);
        if (shapedLaw) yield* advanceLaw(db, current.projectId);
        if (stated !== null && declaredAs !== null && moved !== undefined) {
          yield* closeVocabulary(
            current.projectId,
            before,
            yield* vocabulary.of(current.projectId),
            stated === declaredAs ? null : { was: stated, now: declaredAs },
          );
        }
        yield* act.record(
          'update',
          row,
          {
            status: nextStatus,
            wasStatus: nextStatus !== undefined && nextStatus !== table.statusOf(current) ? table.statusOf(current) : undefined,
            tags: retag === null ? undefined : retag.ids,
            wasTags: retag === null ? undefined : current.tags,
            title: input.title !== undefined && input.title !== current.title ? row.title : undefined,
            wasTitle: input.title !== undefined && input.title !== current.title ? current.title : undefined,
            structural: input.parentId !== undefined || input.ord !== undefined,
            wasFields: replacedFields === undefined || Object.keys(replacedFields).length === 0 ? undefined : replacedFields,
            chars: input.body !== undefined && input.body !== current.body ? row.body.length : undefined,
            wasChars: input.body !== undefined && input.body !== current.body ? current.body.length : undefined,
            delta: input.body !== undefined && input.body !== current.body ? bodyDelta(current.body, row.body) : undefined,
          },
          now,
        );
        return yield* blockRows.written(row, renamed || rewritten);
      }),
    );
  });

  return write as Blocks['Service']['update'];
});

export const blocksLayer: Layer.Layer<
  Blocks,
  never,
  | GraphStore
  | Act
  | BlockNames
  | BlockProjection
  | BlockReferences
  | BlockRows
  | Projects
  | Edges
  | Sources
  | WriterRegister
  | Tags
  | Catalogs
  | Behaviours
  | Tasks
  | Git
> = Layer.effect(
  Blocks,
  Effect.gen(function* () {
    const blockRows = yield* BlockRows;
    const update = yield* blockUpdate;
    const { setEnabled, setDelivery, setEnforcement } = yield* blockLaw;
    const { moduleCards, writeModules } = yield* blockModules(setEnforcement);
    return Blocks.of({
      ...blockRows,
      update,
      create: yield* blockBirth,
      arrive: yield* blockArrival,
      edit: yield* blockEdit(update),
      setEnabled,
      setDelivery,
      setEnforcement,
      moduleCards,
      writeModules,
    });
  }),
);
