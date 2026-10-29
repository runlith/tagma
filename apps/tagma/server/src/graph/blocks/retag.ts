import { Effect } from 'effect';
import { eq } from 'drizzle-orm';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { GraphStore } from '../../platform/contract/service/store.js';
import { source } from '../store/tables.js';
import { type BlockRow, BlockNames } from '../contract/service/acts.js';
import { Edges } from '../contract/service/blocks.js';
import { ActState } from '../contract/service/transaction.js';
import { BlockRows } from '../acts/rows.js';
import { assertRequiredSources, sourceKinds } from '../sources/readers/place.js';
import { LEAF } from '../contract/wire/tags/leaf.js';
import { Catalogs } from '../contract/wire/catalogs.js';
import type { TagTable } from '../contract/wire/tags/table.js';
import { CATALOG_DECLARATION, type Tag, TAG_DECLARATION } from '../contract/wire/tags/declaration.js';
import { hasTag, tagLabel, type Tagged } from '../contract/wire/tags/roles.js';
import { LIFECYCLE, lifecycleOf } from '../contract/wire/tags/lifecycle.js';
import { HOLDER, HOLDER_SLOT } from '../contract/wire/tags/holder.js';
import { MODULE } from '../contract/wire/tags/moduleContract.js';
import { blockName } from '../contract/wire/references.js';
import { assertComposable } from '../vocabulary/declarationRules.js';
import { assertStanding } from '../work/retirement.js';
import { boundaryRefusal } from './guards.js';
import { bornFields, resolveTags } from './birth.js';

export type Retag = { readonly ids: readonly string[]; readonly tags: readonly Tag[]; readonly was: readonly Tag[] };

export const retagLabel = (tags: readonly Tag[]): string => (tags.length === 0 ? tagLabel(null) : tags.map(tagLabel).join(' '));

export function assertSettled(table: TagTable, row: Tagged & { readonly uuid: string }): Effect.Effect<void, GateRefusal<'retag-status'>> {
  const tag = table.bindingTag(row, LIFECYCLE);
  const life = tag === null ? null : lifecycleOf(tag);
  const status = table.statusOf(row);
  const holder = table.holderOf(row);
  const moved = life !== null && status !== null && status !== life.initial;
  if (!moved && holder === null) return Effect.void;
  const name = blockName(row.uuid);
  const initial = life === null ? '' : ` "${life.initial}"`;
  const standing = [...(moved ? [`at "${status}"`] : []), ...(holder === null ? [] : [`held by session ${holder}`])].join(', ');
  return new GateRefusal(
    'retag-status',
    `${name} stands ${standing}, and a tag change starts a node over from its initial word${initial}`,
    [
      holder !== null || status === life?.claimed
        ? `release_block on ${name} — it stands at${initial} again with no holder`
        : `update_block on ${name} with status${initial} — reopen it, then change its tags`,
      'or leave it as it ended and create the node the new tags describe: an ending is history',
    ],
  );
}

export function retagBase(table: TagTable, row: Tagged, retag: Retag): Record<string, unknown> {
  const statusTag = table.bindingTag(row, LIFECYCLE);
  const owned = new Set([
    ...(statusTag === null ? [] : [lifecycleOf(statusTag)?.field]),
    table.bindingTag(row, HOLDER)?.contracts?.[HOLDER]?.slots[HOLDER_SLOT],
  ]);
  return bornFields(retag.tags, Object.fromEntries(Object.entries(row.fields).filter(([field]) => !owned.has(field))));
}

export function assertCarried(
  table: TagTable,
  name: string,
  retag: Retag,
  fields: Readonly<Record<string, unknown>>,
  standing: Readonly<Record<string, unknown>>,
): Effect.Effect<void, GateRefusal<'field-invalid' | 'operation-only'>> {
  const declared = new Set(retag.tags.flatMap((tag) => Object.keys(tag.fields)));
  const enforced = table.lawProjection({ tags: retag.was.map((tag) => tag.id) })?.enforcement?.field;
  if (
    enforced !== undefined &&
    standing[enforced] !== undefined &&
    table.lawProjection({ tags: retag.ids })?.enforcement?.field !== enforced
  ) {
    return new GateRefusal('operation-only', `${name} is enforced, and ${retagLabel(retag.tags)} would not enforce it`, [
      `enforce_rule on ${name} with strictness off first — the only road by which enforcement leaves a rule`,
      `or name tags whose law keeps ${enforced} as its enforcement`,
    ]);
  }
  const operatedBefore = new Set(retag.was.flatMap((tag) => table.actionsOf(tag.id).slots.map((slot) => slot.field)));
  for (const tag of retag.tags) {
    const taken = table.actionsOf(tag.id).slots.find((slot) => fields[slot.field] !== undefined && !operatedBefore.has(slot.field));
    if (taken === undefined) continue;
    return new GateRefusal(
      'operation-only',
      `${name} carries a value in "${taken.field}", which ${tagLabel(tag)} lets only ${taken.ops.join(' and ')} write`,
      [`name it as null in fields to drop it with the change: {"${taken.field}": null}`, `then ${taken.ops.join(' or ')} writes it`],
    );
  }
  const stray = Object.keys(fields).filter((field) => !declared.has(field));
  if (stray.length === 0) return Effect.void;
  const operated = stray.flatMap((field) =>
    retag.was.flatMap((tag) =>
      table
        .actionsOf(tag.id)
        .slots.filter((slot) => slot.field === field)
        .map((slot) => `${field}, written by ${slot.ops.join(' and ')}`),
    ),
  );
  return new GateRefusal(
    'field-invalid',
    `${retagLabel(retag.tags)} declares no ${stray.map((field) => `"${field}"`).join(', ')}, and ${name} carries a value in each`,
    [
      `name each as null in fields to drop its value with the change: ${JSON.stringify(Object.fromEntries(stray.map((field) => [field, null])))}`,
      ...(operated.length === 0 ? [] : [`dropping ends what its operation recorded: ${operated.join('; ')}`]),
      'or name tags that declare them',
    ],
  );
}

export const blockRetag = Effect.gen(function* () {
  const { db } = yield* GraphStore;
  const shipped = yield* Catalogs;
  const rows = yield* BlockRows;
  const names = yield* BlockNames;
  const edges = yield* Edges;

  const settle = Effect.fn('Blocks.retag.settle')(function* (table: TagTable, fresh: BlockRow, retag: Retag) {
    yield* ActState;
    const name = blockName(fresh.uuid);
    yield* assertStanding(rows, names, fresh.id, 'change its tags');
    yield* assertSettled(table, fresh);
    yield* edges.assertRetagged(fresh, retag.ids);
    const carried = yield* db.select({ kind: source.kind }).from(source).where(eq(source.blockId, fresh.id));
    const declared = new Set(sourceKinds(table, { tags: retag.ids }));
    const undeclared = carried.find((one) => !declared.has(one.kind));
    if (undeclared !== undefined) {
      return yield* new GateRefusal(
        'not-measurable',
        `${retagLabel(retag.tags)} declares no "${undeclared.kind}" source, and ${name} stands over one`,
        [
          `unanchor_block on ${name} for each ${undeclared.kind} source first, then change the tags`,
          'or name tags that declare it — read_tags lists their source kinds — or [] to keep it as a note',
        ],
      );
    }
    yield* assertRequiredSources(retag.tags, carried, `anchor_block on ${name} over the place it stands over first, then change the tags`);
    if (table.supports({ tags: retag.ids }, LEAF)) {
      const children = yield* rows.childrenOf(fresh.id);
      if (children.length > 0) {
        return yield* new GateRefusal('leaf', `${retagLabel(retag.tags)} holds no children, and ${name} holds ${children.length}`, [
          `update_block each child of ${name} with another parentId first, then change the tags`,
        ]);
      }
    }
  });

  const plan = Effect.fn('Blocks.retag')(function* (table: TagTable, current: BlockRow, words: readonly string[]) {
    const ids = words.map((word) => table.identities.keyOf(word) ?? word);
    if (ids.length === current.tags.length && ids.every((id, at) => id === current.tags[at])) return null;
    const tags = yield* resolveTags(shipped, table, ids);
    yield* assertComposable(tags);
    const name = blockName(current.uuid);
    const future = { tags: ids };
    if (table.supports(current, MODULE) || table.supports(future, MODULE)) return yield* boundaryRefusal(name, 'retagged');
    const declaration = [TAG_DECLARATION.id, CATALOG_DECLARATION.id].find((id) => hasTag(current, id) || hasTag(future, id));
    if (declaration !== undefined) {
      return yield* new GateRefusal(
        'operation-only',
        `${name} would ${hasTag(current, declaration) ? 'stop' : 'start'} declaring vocabulary as a #${declaration}, and a declaration is born as one`,
        [`create_block with tags ['${declaration}'] for a new declaration`, 'supersede_block or delete_block to retire one that stands'],
      );
    }
    yield* assertStanding(rows, names, current.id, 'change its tags');
    yield* assertSettled(table, current);
    return { ids, tags, was: table.tagsOf(current) } satisfies Retag;
  });

  return { plan, settle };
});
