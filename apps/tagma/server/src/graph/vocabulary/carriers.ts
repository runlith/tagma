import { Effect } from 'effect';
import { and, eq, isNull } from 'drizzle-orm';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { GraphStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { block } from '../store/tables.js';
import { blockName } from '../contract/wire/references.js';
import type { Tag } from '../contract/wire/tags/declaration.js';
import { TAG_DECLARATION } from '../contract/wire/tags/declaration.js';
import type { TagTable } from '../contract/wire/tags/table.js';
import { BlockNames, BlockProjection, Unborn } from '../contract/service/acts.js';
import type { ActState } from '../contract/service/transaction.js';
import { BlockRows } from '../acts/rows.js';
import { assertComposable, assertRequiredFields, declaringTag, validateFields } from './declarationRules.js';
import { carriesTag } from './projection.js';
import { writesIdentity } from './naming.js';
import { sameSchema } from './compiler.js';

export type AssertFieldTargets = (
  table: TagTable,
  projectId: number,
  tags: readonly Tag[],
  fields: Readonly<Record<string, unknown>>,
) => Effect.Effect<void, StoreFailure | GateRefusal<'field-target'>>;

export type Renamed = { readonly was: string; readonly now: string };

export type ReadCarriers = (
  table: TagTable,
  projectId: number,
  types: readonly string[],
  renamed: Renamed | null,
) => Effect.Effect<void, StoreFailure | GateRefusal<'carriers-invalid'>, ActState>;

export const fieldTargetGuard = Effect.gen(function* () {
  const blockNames = yield* BlockNames;
  const blockRows = yield* BlockRows;

  const assertFieldTargets: AssertFieldTargets = Effect.fn('Vocabulary.assertFieldTargets')(function* (
    table: TagTable,
    projectId: number,
    tags: readonly Tag[],
    fields: Readonly<Record<string, unknown>>,
  ): Effect.fn.Return<void, StoreFailure | GateRefusal<'field-target'>> {
    const unborn = yield* Unborn;
    for (const [name, value] of Object.entries(fields)) {
      const tag = declaringTag(tags, name);
      const declared = tag === null ? undefined : tag.fields[name];
      if (tag === null || declared === undefined || typeof declared === 'string' || declared.type !== 'ref') continue;
      const wanted = declared.tag === undefined ? undefined : (table.identities.resolveStoredType(declared.tag) ?? declared.tag);
      for (const written of Array.isArray(value) ? (value as readonly unknown[]) : [value]) {
        if (typeof written !== 'string' || unborn(written.toLowerCase())) continue;
        const found = yield* Effect.result(blockNames.idOfName(written));
        const refused = found._tag === 'Failure' ? found.failure : undefined;
        if (refused !== undefined && !(refused instanceof GateRefusal)) return yield* Effect.fail(refused);
        const target = found._tag === 'Success' ? yield* blockRows.liveBlock(found.success) : undefined;
        if (target === undefined || target.projectId !== projectId) {
          const resting = found._tag === 'Success' && target === undefined;
          return yield* new GateRefusal(
            'field-target',
            resting
              ? `${tag.id}.${name}: ${written} rests in the trash`
              : `${tag.id}.${name}: nothing in this project answers to "${written}"`,
            resting
              ? [`restore_block ${written}, and write the field after it stands`, 'or name a node that stands']
              : [
                  `search_blocks for the node this field names, and write the name a read printed`,
                  ...(refused instanceof GateRefusal ? [refused.reason] : []),
                ],
          );
        }
        if (wanted !== undefined && !target.tags.includes(wanted)) {
          return yield* new GateRefusal('field-target', `${tag.id}.${name}: ${blockName(target.uuid)} carries no #${wanted}`, [
            `${tag.id}.${name} names a #${wanted}: the declaration says what may stand at the far end`,
            `create_block the #${wanted} this field is about, and name it here`,
          ]);
        }
      }
    }
  });
  return assertFieldTargets;
});

export function vocabularyReshaped(before: TagTable, after: TagTable): readonly string[] {
  const reshaped: string[] = [];
  for (const id of new Set([...before.declaredTags(), ...after.declaredTags()])) {
    const was = before.tagById(id);
    const now = after.tagById(id);
    if (was === now || (was !== null && now !== null && sameSchema(was, now))) continue;
    if (now !== null) reshaped.push(id);
  }
  return reshaped;
}

export type CloseVocabulary = (
  projectId: number,
  before: TagTable,
  after: TagTable,
  renamed: Renamed | null,
) => Effect.Effect<void, StoreFailure | GateRefusal<'carriers-invalid' | 'field-invalid'>, ActState>;

type Carrier = {
  readonly id: number;
  readonly uuid: string;
  readonly tags: readonly string[];
  readonly fields: Readonly<Record<string, unknown>>;
};

const carrierWork = Effect.gen(function* () {
  const { db } = yield* GraphStore;
  const blockProjection = yield* BlockProjection;
  const assertFieldTargets = yield* fieldTargetGuard;

  const carriersOf = (projectId: number, types: readonly string[]) =>
    db
      .select({ id: block.id, uuid: block.uuid, tags: block.tags, fields: block.fields })
      .from(block)
      .where(and(eq(block.projectId, projectId), isNull(block.deletedAt), carriesTag(types, block.id)))
      .orderBy(block.id);

  const reread = Effect.fn('Vocabulary.reread')(function* (
    table: TagTable,
    projectId: number,
    carried: readonly Carrier[],
    types: readonly string[],
    renamed: Renamed | null,
  ): Effect.fn.Return<void, StoreFailure | GateRefusal<'carriers-invalid'>, ActState> {
    const stranded = renamed === null ? [] : carried.filter((node) => node.tags.includes(renamed.was));
    const first = stranded[0];
    if (renamed !== null && first !== undefined) {
      return yield* new GateRefusal(
        'carriers-invalid',
        `${stranded.length} node(s) carry #${renamed.was}, and this write would leave them with a word nothing declares: ${blockName(first.uuid)}`,
        [
          writesIdentity
            ? `keep the id "${renamed.was}" and write identity: {name: "${renamed.now}"} to rename it: its carriers keep the key they hold and answer to the new name`
            : `keep the id "${renamed.was}": its carriers hold it`,
          `create_block with tags: ['${TAG_DECLARATION.id}'] to declare #${renamed.now} beside it, and rewrite the carriers to it`,
        ],
      );
    }
    for (const node of carried) {
      const own = table.tagsOf(node);
      const reread = yield* Effect.result(
        assertComposable(own).pipe(
          Effect.andThen(validateFields(own, node.fields)),
          Effect.andThen(assertRequiredFields(own, node.fields)),
          Effect.andThen(assertFieldTargets(table, projectId, own, node.fields)),
        ),
      );
      const refused = reread._tag === 'Failure' ? reread.failure : undefined;
      if (refused !== undefined && !(refused instanceof GateRefusal)) return yield* Effect.fail(refused);
      if (refused instanceof GateRefusal) {
        return yield* new GateRefusal(
          'carriers-invalid',
          `${blockName(node.uuid)} carries #${types.find((type) => node.tags.includes(type)) ?? renamed?.now ?? types[0]} and no longer reads against it: ${refused.reason}`,
          [`update_block on ${blockName(node.uuid)} first, with what the new declaration takes`, ...refused.unblock],
        );
      }
      yield* blockProjection.syncTags(node.id);
    }
  });

  const readCarriers: ReadCarriers = (table, projectId, types, renamed) =>
    Effect.flatMap(carriersOf(projectId, types), (carried) => reread(table, projectId, carried, types, renamed));

  return { carriersOf, reread, readCarriers };
});

export const carrierReader = Effect.map(carrierWork, ({ readCarriers }) => readCarriers);

export const vocabularyCloser = Effect.gen(function* () {
  const { readCarriers } = yield* carrierWork;

  const closeVocabulary: CloseVocabulary = Effect.fn('Vocabulary.close')(function* (
    projectId: number,
    before: TagTable,
    after: TagTable,
    renamed: Renamed | null,
  ) {
    const reshaped = vocabularyReshaped(before, after);
    const types = renamed === null || reshaped.includes(renamed.was) ? reshaped : [...reshaped, renamed.was];
    if (types.length > 0) yield* readCarriers(after, projectId, types, renamed);
  });

  return closeVocabulary;
});
