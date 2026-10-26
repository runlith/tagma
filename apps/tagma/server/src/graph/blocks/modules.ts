import { Clock, Effect, Result, Schema } from 'effect';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { GraphStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { writes } from '../../platform/contract/service/writes.js';
import { block, edge, source } from '../store/tables.js';
import { linking, placing, projecting, referencing } from '../store/actWrites.js';
import { Act, BlockNames, BlockProjection, BlockReferences, type BlockRow } from '../contract/service/acts.js';
import type { Blocks, EnforceRefusal, EnforcementWrite, ModuleRefusal } from '../contract/service/blocks.js';
import { BlockRows } from '../acts/rows.js';
import { Tags } from '../contract/service/vocabulary.js';
import { Behaviours } from '../contract/service/behaviours.js';
import { Catalogs } from '../contract/wire/catalogs.js';
import { catalogUnblock } from '../vocabulary/available.js';
import { blockName } from '../contract/wire/references.js';
import { mintBlockId } from '../contract/wire/identity.js';
import type { TagTable } from '../contract/wire/tags/table.js';
import { IMPORTS, IMPORTS_TESTS, MODULE, RELATION_EDGES } from '../contract/wire/tags/moduleContract.js';
import {
  type CardRef,
  type ModuleCard,
  moduleEntriesSchema,
  moduleOrderSchema,
  type ModuleWrite,
  type Unreadable,
} from '../contract/wire/modules.js';
import { carriesContract } from '../vocabulary/projection.js';
import { assertRequiredFields, validateFields } from '../vocabulary/declarationRules.js';

const moduling = writes('Blocks.writeModules', [block, source, edge], projecting, referencing, placing, linking);

type Slots = { readonly id?: string; readonly entries?: string; readonly order?: string };

const slotsOf = (table: TagTable, row: { readonly tags: readonly string[] }): Slots =>
  (table.bindingTag(row, MODULE)?.contracts?.[MODULE]?.slots ?? {}) as Slots;

const readEntries = Schema.decodeUnknownResult(moduleEntriesSchema);
const readOrder = Schema.decodeUnknownResult(moduleOrderSchema);

const shape = (reason: string): GateRefusal<'module-shape'> =>
  new GateRefusal('module-shape', reason, ['set_module with the module named by its id, its root a directory of the working tree']);

export const blockModules = Effect.fnUntraced(function* (setEnforcement: Blocks['Service']['setEnforcement']) {
  const { db } = yield* GraphStore;
  const act = yield* Act;
  const names = yield* BlockNames;
  const projection = yield* BlockProjection;
  const references = yield* BlockReferences;
  const rows = yield* BlockRows;
  const vocabulary = yield* Tags;
  const catalogs = yield* Catalogs;
  const behaviours = yield* Behaviours;

  const moduleCards = Effect.fn('Blocks.moduleCards')(function* (projectId: number): Effect.fn.Return<readonly ModuleCard[], StoreFailure> {
    const table = yield* vocabulary.of(projectId);
    const cards = yield* db
      .select()
      .from(block)
      .where(and(eq(block.projectId, projectId), isNull(block.deletedAt), carriesContract(table, MODULE, block.id)));
    if (cards.length === 0) return [];
    const ids = cards.map((card) => card.id);
    const carried = new Set(ids);
    const placed = yield* db
      .select({ blockId: source.blockId, kind: source.kind, ref: source.ref })
      .from(source)
      .where(and(inArray(source.blockId, ids), inArray(source.kind, ['dir', 'file'])));
    const related = yield* db
      .select({ fromId: edge.fromId, toId: edge.toId, kind: edge.kind })
      .from(edge)
      .where(and(inArray(edge.fromId, ids), inArray(edge.kind, [...RELATION_EDGES])));
    const parents = new Map(
      (yield* db.select({ id: block.id, parentId: block.parentId }).from(block).where(eq(block.projectId, projectId))).map(
        (row) => [row.id, row.parentId] as const,
      ),
    );
    const moduleAbove = (id: number): number | null => {
      for (let at = parents.get(id) ?? null; at !== null; at = parents.get(at) ?? null) if (carried.has(at)) return at;
      return null;
    };
    const placedBy = Map.groupBy(placed, (one) => one.blockId);
    const relatedBy = Map.groupBy(related, (one) => one.fromId);
    return cards.map((card): ModuleCard => {
      const slots = slotsOf(table, card);
      const value = (slot: string | undefined) => (slot === undefined ? undefined : card.fields[slot]);
      const entries = value(slots.entries);
      const order = value(slots.order);
      const readE = entries === undefined ? undefined : readEntries(entries);
      const readO = order === undefined ? undefined : readOrder(order);
      const id = value(slots.id);
      const unreadable: Unreadable = {
        ...(readE !== undefined && Result.isFailure(readE) ? { entries: readE.failure.message } : {}),
        ...(readO !== undefined && Result.isFailure(readO) ? { order: readO.failure.message } : {}),
        ...(id !== undefined && typeof id !== 'string' ? { id: 'not a string' } : {}),
      };
      return {
        block: card.id,
        name: blockName(card.uuid),
        title: card.title,
        parent: moduleAbove(card.id),
        placedUnder: card.parentId,
        id: typeof id === 'string' ? id : undefined,
        roots: (placedBy.get(card.id) ?? []).filter((one) => one.kind === 'dir').map((one) => one.ref),
        cuts: (placedBy.get(card.id) ?? []).filter((one) => one.kind === 'file').map((one) => one.ref),
        entries: readE !== undefined && Result.isSuccess(readE) ? readE.success : undefined,
        order: readO !== undefined && Result.isSuccess(readO) ? readO.success : undefined,
        imports: (relatedBy.get(card.id) ?? []).filter((one) => one.kind === IMPORTS).map((one) => one.toId),
        importsTests: (relatedBy.get(card.id) ?? []).filter((one) => one.kind === IMPORTS_TESTS).map((one) => one.toId),
        unreadable: Object.keys(unreadable).length === 0 ? undefined : unreadable,
      };
    });
  });

  const writeModules = Effect.fn('Blocks.writeModules')(function* (
    projectId: number,
    plan: readonly ModuleWrite[],
    enforcements: readonly EnforcementWrite[],
  ): Effect.fn.Return<readonly number[], StoreFailure | GateRefusal<ModuleRefusal | EnforceRefusal>> {
    return yield* act.unit(
      moduling,
      Effect.gen(function* () {
        const table = yield* vocabulary.of(projectId);
        const now = new Date(yield* Clock.currentTimeMillis);
        const born = new Map<CardRef, number>();
        const targets: number[] = [];
        const written: number[] = [];
        for (const write of plan) {
          if (write.block !== undefined) {
            targets.push(write.block);
            continue;
          }
          const types = table.typesSupporting(MODULE);
          const type = types.length === 1 ? types[0] : undefined;
          if (type === undefined) {
            return yield* new GateRefusal(
              'tag-undeclared',
              `this project declares ${types.length === 0 ? 'no' : 'more than one'} type carrying ${MODULE}`,
              types.length === 0
                ? catalogUnblock(catalogs, behaviours, MODULE)
                : [`keep one type supporting ${MODULE} before creating a module`],
            );
          }
          if (write.title === undefined || write.parent === undefined)
            return yield* shape(`a new module \`${write.id}\` is created with its title and its parent`);
          const parent = yield* rows.blockById(write.parent);
          const tag = table.tagById(type);
          if (tag === null) return yield* shape(`#${type} is not readable here`);
          const fields = { ...(write.fields ?? {}) };
          yield* validateFields([tag], fields);
          const row = yield* db
            .insert(block)
            .values({
              uuid: mintBlockId(),
              projectId,
              parentId: parent.id,
              ord: yield* rows.nextOrd(parent.id),
              tags: [type],
              fields,
              title: write.title,
              body: write.body ?? '',
              createdAt: now,
              updatedAt: now,
            })
            .returning()
            .get();
          if (row === undefined) return yield* Effect.die('module card insert returned no row');
          yield* references.syncRefs(row.id, row.body, { projectId });
          yield* projection.syncBorn(row, true);
          yield* act.record('create', row, { kind: type, chars: row.body.length, module: write.id }, now);
          targets.push(row.id);
          if (write.handle !== undefined) born.set(write.handle, row.id);
        }
        const cardOf = (ref: CardRef): number => {
          const row = ref > 0 ? ref : born.get(ref);
          if (row === undefined) throw new RangeError(`the write names handle ${ref}, which no card of it was born under`);
          return row;
        };
        const opened = yield* names.namesOf(plan.flatMap((write) => (write.entries ?? []).flatMap((door) => (door.for ?? []).map(cardOf))));
        for (const [index, write] of plan.entries()) {
          const at = targets[index] as number;
          const current: BlockRow = yield* rows.blockById(at);
          if (write.remove === true) {
            const held = (yield* rows.childrenOf(at)).length;
            if (held > 0) return yield* shape(`\`${write.id}\` holds ${held} block(s); move or delete them before the module`);
            yield* db.delete(edge).where(and(or(eq(edge.fromId, at), eq(edge.toId, at)), inArray(edge.kind, [...RELATION_EDGES])));
            yield* db.update(block).set({ deletedAt: now }).where(eq(block.id, at));
            yield* projection.forgetVocabulary([at]);
            yield* act.record('delete', at, { ids: [at] }, now);
            written.push(at);
            continue;
          }
          const slots = slotsOf(table, current);
          const tag = table.bindingTag(current, MODULE);
          if (tag === null || slots.id === undefined) return yield* shape(`${blockName(current.uuid)} carries no module`);
          const doors =
            write.entries === undefined || write.entries === null
              ? write.entries
              : write.entries.map((door) => ({
                  at: door.at,
                  for: door.for?.map((ref) => opened.get(cardOf(ref)) as string),
                  role: door.role,
                }));
          const next: Record<string, unknown> = { ...current.fields, [slots.id]: write.id };
          const set = (slot: string | undefined, value: unknown) => {
            if (slot === undefined || value === undefined) return;
            if (value === null) delete next[slot];
            else next[slot] = value;
          };
          set(slots.entries, doors);
          set(slots.order, write.order);
          if (write.block !== undefined && write.fields !== undefined) Object.assign(next, write.fields);
          yield* validateFields(table.tagsOf(current), next);
          yield* assertRequiredFields(table.tagsOf(current), next);
          const moved = write.block !== undefined && write.parent !== undefined && write.parent !== current.parentId;
          const ord = moved ? yield* rows.nextOrd(write.parent as number) : current.ord;
          yield* db
            .update(block)
            .set({ fields: next, parentId: moved ? write.parent : undefined, ord: moved ? ord : undefined, updatedAt: now })
            .where(eq(block.id, at));
          yield* projection.syncTags(at);
          const was = Object.fromEntries(
            [...new Set([...Object.keys(next), ...Object.keys(current.fields)])].flatMap((name) =>
              JSON.stringify(current.fields[name]) === JSON.stringify(next[name]) ? [] : [[name, current.fields[name]] as const],
            ),
          );
          if (moved || Object.keys(was).length > 0) {
            yield* act.record('update', at, { structural: moved, wasFields: Object.keys(was).length === 0 ? undefined : was }, now);
          }
          if (write.root !== undefined || write.cuts !== undefined) {
            const standingSources = yield* db
              .select({ id: source.id, kind: source.kind, ref: source.ref })
              .from(source)
              .where(and(eq(source.blockId, at), inArray(source.kind, ['dir', 'file'])));
            const wanted = [
              ...(write.root === undefined
                ? standingSources.filter((one) => one.kind === 'dir').map((one) => ({ kind: 'dir' as const, ref: one.ref }))
                : [{ kind: 'dir' as const, ref: write.root }]),
              ...(write.cuts === undefined
                ? standingSources.filter((one) => one.kind === 'file').map((one) => ({ kind: 'file' as const, ref: one.ref }))
                : write.cuts.map((ref) => ({ kind: 'file' as const, ref }))),
            ];
            const keep = (kind: string, ref: string) => wanted.some((one) => one.kind === kind && one.ref === ref);
            const gone = standingSources.filter((one) => !keep(one.kind, one.ref));
            if (gone.length > 0)
              yield* db.delete(source).where(
                inArray(
                  source.id,
                  gone.map((one) => one.id),
                ),
              );
            for (const one of gone) yield* act.record('unanchor', at, { path: one.ref, symbol: null }, now);
            for (const one of wanted) {
              if (standingSources.some((held) => held.kind === one.kind && held.ref === one.ref)) continue;
              yield* db.insert(source).values({ blockId: at, kind: one.kind, ref: one.ref, symbol: null, createdAt: now });
              yield* act.record('anchor', at, { path: one.ref, kind: one.kind }, now);
            }
            yield* projection.syncSearch(at);
          }
          for (const [kind, refs] of [
            [IMPORTS, write.imports],
            [IMPORTS_TESTS, write.importsTests],
          ] as const) {
            if (refs === undefined) continue;
            const wanted = refs.map(cardOf);
            const held = (yield* db
              .select({ toId: edge.toId })
              .from(edge)
              .where(and(eq(edge.fromId, at), eq(edge.kind, kind)))).map((one) => one.toId);
            const dropped = held.filter((one) => !wanted.includes(one));
            if (dropped.length > 0)
              yield* db.delete(edge).where(and(eq(edge.fromId, at), eq(edge.kind, kind), inArray(edge.toId, dropped)));
            for (const toId of dropped) yield* act.record('unlink', at, { kind, toId }, now);
            for (const toId of wanted) if (!held.includes(toId)) yield* rows.insertEdge(at, kind, toId);
          }
          written.push(at);
        }
        for (const one of enforcements) yield* setEnforcement(one);
        return written;
      }),
    );
  });

  return { moduleCards, writeModules };
});
