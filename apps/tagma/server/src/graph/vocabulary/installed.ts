import { and, eq, isNull, sql } from 'drizzle-orm';
import { Effect, Schema } from 'effect';
import type { StoreDb, StoreFailure } from '../../platform/contract/service/store.js';
import { SPOKEN_LENGTH } from '../../platform/contract/wire/ids.js';
import { block, blockTag } from '../store/tables.js';
import type { BlockRow } from '../contract/service/acts.js';
import { blockName } from '../contract/wire/references.js';
import { CATALOG_DECLARATION, catalogReleaseSchema, TAG_DECLARATION } from '../contract/wire/tags/declaration.js';
import { tagIdentitySchema } from '../contract/wire/tags/identity.js';
import { forkSchema, guidanceForkSchema, keyedLayerSchema } from '../contract/wire/tags/sections.js';
import { closedParsing } from '../contract/wire/fields.js';
import { candidateOf } from './declarationRules.js';
import type { Installed, StandingCatalog, StandingType } from './candidate.js';

const decodeIdentity = (input: unknown) => Schema.decodeUnknownResult(tagIdentitySchema)(input, closedParsing);
const decodeLayer = (input: unknown) => Schema.decodeUnknownResult(keyedLayerSchema)(input, closedParsing);
const decodeFork = (input: unknown) => Schema.decodeUnknownResult(forkSchema)(input, closedParsing);
const decodeGuidanceFork = (input: unknown) => Schema.decodeUnknownResult(guidanceForkSchema)(input, closedParsing);
const decodeRelease = Schema.decodeUnknownResult(catalogReleaseSchema);

type Decoded<A> = { readonly _tag: 'Success'; readonly success: A } | { readonly _tag: 'Failure' };

function optional<A>(value: unknown, decode: (input: unknown) => Decoded<A>, name: string, unread: string[]): A | null {
  if (value === undefined) return null;
  const read = decode(value);
  if (read._tag === 'Success') return read.success;
  unread.push(name);
  return null;
}

export const vocabularyRows = (db: StoreDb<'graph'>, projectId: number): Effect.Effect<BlockRow[], StoreFailure> =>
  db
    .select()
    .from(block)
    .where(
      and(
        eq(block.projectId, projectId),
        isNull(block.deletedAt),
        sql`exists (select 1 from ${blockTag} t where t.block_id = ${block.id} and t.tag in (${TAG_DECLARATION.id}, ${CATALOG_DECLARATION.id}))`,
      ),
    )
    .orderBy(block.ord, block.id);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function withoutWhy(row: BlockRow): BlockRow {
  const shape = row.fields.body;
  if (!row.tags.includes(TAG_DECLARATION.id) || !isRecord(shape) || !Object.hasOwn(shape, 'why')) return row;
  const { why: _removed, ...body } = shape;
  return { ...row, fields: { ...row.fields, body } };
}

export function installedOf(rows: readonly BlockRow[]): Installed {
  const types: StandingType[] = [];
  const bySuffix = new Map<string, { readonly name: string; readonly compact: string }[]>();
  for (const row of rows) {
    if (!row.tags.includes(TAG_DECLARATION.id)) continue;
    const compact = row.uuid.replaceAll('-', '').toLowerCase();
    const suffix = compact.slice(-SPOKEN_LENGTH);
    bySuffix.set(suffix, [...(bySuffix.get(suffix) ?? []), { name: blockName(row.uuid), compact }]);
    const read = candidateOf(row);
    const unread: string[] = [];
    const identity = optional(row.fields.identity, decodeIdentity, 'identity', unread);
    const layer = optional(row.fields.layer, decodeLayer, 'layer', unread);
    const fork = optional(row.fields.fork, decodeFork, 'fork', unread);
    const overlay =
      unread.length === 0
        ? null
        : `its ${unread.join(', ')} ${unread.length === 1 ? 'is' : 'are'} written in a shape this grammar cannot read`;
    types.push({
      row: row.id,
      uuid: compact,
      name: read.name,
      ord: row.ord,
      declaration: read.declaration,
      unread: read.unread === null ? overlay : overlay === null ? read.unread : `${read.unread}; ${overlay}`,
      identity,
      layer,
      fork,
    });
  }
  const memberOf = (ref: string): string | null => {
    const tail = ref.replaceAll('-', '').toLowerCase();
    const found = (bySuffix.get(tail.slice(-SPOKEN_LENGTH)) ?? []).filter((entry) => entry.compact.endsWith(tail));
    return found.length === 1 ? found[0]!.name : null;
  };
  const catalogs: StandingCatalog[] = [];
  for (const row of rows) {
    if (!row.tags.includes(CATALOG_DECLARATION.id) || typeof row.fields.id !== 'string') continue;
    const release = row.fields.release === undefined ? null : decodeRelease(row.fields.release);
    const listed = Array.isArray(row.fields.tags) ? row.fields.tags : [];
    const unread: string[] = [];
    const layer = optional(row.fields.layer, decodeLayer, 'layer', unread);
    const fork = optional(row.fields.fork, decodeGuidanceFork, 'fork', unread);
    catalogs.push({
      layer,
      fork,
      unread:
        unread.length === 0
          ? null
          : `its ${unread.join(', ')} ${unread.length === 1 ? 'is' : 'are'} written in a shape this grammar cannot read`,
      row: row.id,
      name: blockName(row.uuid),
      id: row.fields.id,
      guidance: row.body,
      listed: listed.filter((ref): ref is string => typeof ref === 'string'),
      members: listed.flatMap((ref) => {
        const member = typeof ref === 'string' ? memberOf(ref) : null;
        return member === null ? [] : [member];
      }),
      release: release !== null && release._tag === 'Success' ? release.success : null,
    });
  }
  return { types, catalogs };
}
