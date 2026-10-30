import { Clock, Effect } from 'effect';
import type { DeliveryRefusal, EnforcementWrite, EnforceRefusal, SwitchRefusal } from '../contract/service/blocks.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { eq } from 'drizzle-orm';
import { GraphStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { block, source } from '../store/tables.js';
import { Act, type BlockRecord, type BlockRow } from '../contract/service/acts.js';
import { blockName } from '../contract/wire/references.js';
import { anchorsOf } from '../contract/wire/sources.js';
import { tagLabel } from '../contract/wire/tags/roles.js';
import { DELIVERIES, type Delivery, declaredDeliveries, isEnabled, statedDelivery } from '../contract/wire/tags/law.js';
import type { TagTable } from '../contract/wire/tags/table.js';
import { validateFields } from '../vocabulary/declarationRules.js';
import { Tags } from '../contract/service/vocabulary.js';
import { BlockProjection } from '../contract/service/acts.js';
import { BlockRows } from '../acts/rows.js';
import { writes } from '../../platform/contract/service/writes.js';
import { projecting } from '../store/actWrites.js';

const switching = writes('Blocks.setEnabled', [block], projecting);
const delivering = writes('Blocks.setDelivery', [block], projecting);
const enforcing = writes('Blocks.setEnforcement', [block], projecting);

export const blockLaw = Effect.gen(function* () {
  const { db } = yield* GraphStore;
  const act = yield* Act;
  const blockProjection = yield* BlockProjection;
  const blockRows = yield* BlockRows;
  const vocabulary = yield* Tags;

  const notLaw = (table: TagTable, current: BlockRow) =>
    new GateRefusal(
      'not-rule',
      `${blockName(current.uuid)} is ${tagLabel(table.tagOf(current))}, and only a node whose body reaches every thread binds anybody`,
      ['a spec is edited in place or replaced by `supersede_block`, work ends with `finish_block` or `close_block`'],
    );

  const setEnabled = Effect.fn('Blocks.setEnabled')(function* (input: {
    id: number;
    enabled: boolean;
  }): Effect.fn.Return<BlockRecord, StoreFailure | GateRefusal<SwitchRefusal>> {
    const current = yield* blockRows.blockById(input.id);
    const table = yield* vocabulary.of(current.projectId);
    const law = table.lawProjection(current);
    if (law === null) return yield* notLaw(table, current);
    const switchName = law.enabled.field;
    if (isEnabled(law, current) === input.enabled) return yield* blockRows.recordOf(current);
    const now = new Date(yield* Clock.currentTimeMillis);
    return yield* act.unit(
      switching,
      Effect.gen(function* () {
        const fresh = yield* blockRows.blockById(input.id);
        const { [switchName]: _off, ...rest } = fresh.fields;
        const row = yield* db
          .update(block)
          .set({ fields: input.enabled ? rest : { ...rest, [switchName]: false }, updatedAt: now })
          .where(eq(block.id, input.id))
          .returning()
          .get();
        if (!row) return yield* Effect.die('block enable returned no row');
        yield* blockProjection.syncTags(row.id);
        yield* act.record(input.enabled ? 'enable' : 'disable', row.id, {}, now);
        return yield* blockRows.recordOf(row);
      }),
    );
  });

  const setDelivery = Effect.fn('Blocks.setDelivery')(function* (input: {
    id: number;
    delivery: Delivery | null;
  }): Effect.fn.Return<BlockRecord, StoreFailure | GateRefusal<DeliveryRefusal>> {
    const current = yield* blockRows.blockById(input.id);
    const table = yield* vocabulary.of(current.projectId);
    const law = table.lawProjection(current);
    if (law === null) return yield* notLaw(table, current);
    const field = law.delivery?.field;
    if (field === undefined) {
      return yield* new GateRefusal(
        'delivery-undeclared',
        `${blockName(current.uuid)} is ${tagLabel(table.tagOf(current))}, whose declaration binds no delivery field`,
        [
          `declare a delivery field on #${law.type} with {type: "enum", values: [...]} among "${DELIVERIES.join('", "')}" and bind roles.delivery to it`,
        ],
      );
    }
    const declared = declaredDeliveries(table.tagById(law.type), law);
    if (input.delivery !== null && !declared.includes(input.delivery)) {
      return yield* new GateRefusal(
        'field-invalid',
        `#${law.type} declares the deliveries ${declared.join(', ')}, and ${input.delivery} is not among them`,
        [
          `set_rule_delivery with one of ${declared.join(', ')}, or null to deliver by sources`,
          `add "${input.delivery}" to the values of #${law.type}.fields.${field} with update_block`,
        ],
      );
    }
    if (statedDelivery(law, current) === input.delivery) return yield* blockRows.recordOf(current);
    const now = new Date(yield* Clock.currentTimeMillis);
    return yield* act.unit(
      delivering,
      Effect.gen(function* () {
        const fresh = yield* blockRows.blockById(input.id);
        const { [field]: _stated, ...rest } = fresh.fields;
        const row = yield* db
          .update(block)
          .set({ fields: input.delivery === null ? rest : { ...rest, [field]: input.delivery }, updatedAt: now })
          .where(eq(block.id, input.id))
          .returning()
          .get();
        if (!row) return yield* Effect.die('block delivery returned no row');
        yield* blockProjection.syncTags(row.id);
        yield* act.record('update', row.id, { wasFields: { [field]: fresh.fields[field] } }, now);
        return yield* blockRows.recordOf(row);
      }),
    );
  });

  const setEnforcement = Effect.fn('Blocks.setEnforcement')(function* (
    input: EnforcementWrite,
  ): Effect.fn.Return<BlockRecord, StoreFailure | GateRefusal<EnforceRefusal>> {
    const now = new Date(yield* Clock.currentTimeMillis);
    return yield* act.unit(
      enforcing,
      Effect.gen(function* () {
        const current = yield* blockRows.blockById(input.id);
        const table = yield* vocabulary.of(current.projectId);
        const law = table.lawProjection(current);
        const tag = law === null ? null : table.tagById(law.type);
        const name = law?.enforcement?.field ?? null;
        if (law === null || tag === null || name === null) {
          return yield* new GateRefusal(
            'not-enforced',
            `${blockName(current.uuid)} is ${tagLabel(table.tagOf(current))}, which binds no enforcement`,
            ['enforce a node whose tag binds core/enforced'],
          );
        }
        const moved =
          JSON.stringify(current.fields[name]) !== JSON.stringify(input.stood)
            ? 'its enforcement changed'
            : input.document === null
              ? null
              : JSON.stringify(anchorsOf(yield* db.select().from(source).where(eq(source.blockId, current.id)))) !==
                  JSON.stringify(input.anchors)
                ? 'its sources changed, and with them the code it measures'
                : !isEnabled(law, current)
                  ? 'its law was switched off'
                  : (yield* blockRows.isSuperseded(current.id))
                    ? 'it was replaced'
                    : null;
        if (moved !== null) {
          return yield* new GateRefusal(
            'enforcement-stale',
            `${blockName(current.uuid)} is not the rule that was measured: ${moved} after prepare`,
            ['enforce_rule again: prepare reads the rule and measures its reach anew'],
          );
        }
        const { [name]: _stood, ...rest } = current.fields;
        if (input.document !== null) yield* validateFields([tag], { [name]: input.document });
        const row = yield* db
          .update(block)
          .set({ fields: input.document === null ? rest : { ...rest, [name]: input.document }, updatedAt: now })
          .where(eq(block.id, input.id))
          .returning()
          .get();
        if (!row) return yield* Effect.die('block enforcement returned no row');
        yield* blockProjection.syncTags(row.id);
        yield* act.record(input.op ?? 'enforce', row.id, input.journal, now);
        return yield* blockRows.recordOf(row);
      }),
    );
  });

  return { setEnabled, setDelivery, setEnforcement };
});
