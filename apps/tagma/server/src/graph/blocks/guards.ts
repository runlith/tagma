import { Effect } from 'effect';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { tagLabel } from '../contract/wire/tags/roles.js';
import type { DeclaringNode, TagTable } from '../contract/wire/tags/table.js';
import { CATALOG_DECLARATION, type Tag, TAG_DECLARATION } from '../contract/wire/tags/declaration.js';
import { lifecycleOf } from '../contract/wire/tags/lifecycle.js';
import { MODULE } from '../contract/wire/tags/moduleContract.js';
import type { Tagged } from '../contract/wire/tags/roles.js';
import { addressedRefsRefusal, blockName } from '../contract/wire/references.js';
import { bodyCap, declarationOf, type DeclarationNode } from '../vocabulary/declarationRules.js';

export function leafRefusal(where: string): GateRefusal<'leaf'> {
  return new GateRefusal('leaf', `${where} holds no children`, [
    'name another parent: what a leaf answers is a page, read when it is opened and never stored as a subtree',
  ]);
}

export const assertTagNode = (
  table: TagTable,
  node: DeclarationNode,
  own: DeclaringNode | null,
): Effect.Effect<string, GateRefusal<'tag-declared' | 'tag-incoherent'>> =>
  Effect.flatMap(
    Effect.fromResult(declarationOf(node)).pipe(
      Effect.mapError((failure) => new GateRefusal('tag-incoherent', failure.message, ['repair the unreadable fields of the declaration'])),
    ),
    (declared): Effect.Effect<string, GateRefusal<'tag-declared' | 'tag-incoherent'>> => {
      const standing = table.tagById(declared.id);
      if (standing !== null && declared.id !== own?.id) {
        return new GateRefusal('tag-declared', `this project already declares #${declared.id}`, [
          declared.id === TAG_DECLARATION.id
            ? `#${TAG_DECLARATION.id} is the one declaration the core carries: it is what every other declaration is read by, so no node declares it`
            : `write another id: two declarations of #${declared.id} would leave every node carrying it with two meanings`,
          `update_block on the #${declared.id} that stands, to change what it declares`,
        ]);
      }
      return Effect.as(table.redeclare(declared, own), declared.id);
    },
  );

const BOUNDARY_OWNER =
  "set_module writes a module's boundaries, measuring every enforced rule the change moves and naming every debt it records";

export type Boundary =
  | 'created'
  | 'trashed'
  | 'restored'
  | 'moved'
  | 'superseded'
  | 'anchored'
  | 'unanchored'
  | 'linked'
  | 'unlinked'
  | 'retagged';

export function boundaryRefusal(name: string, change: Boundary): GateRefusal<'operation-only'> {
  return new GateRefusal(
    'operation-only',
    `${name} carries a module's boundaries, and a module is not ${change} by any road but set_module`,
    [`${BOUNDARY_OWNER}: set_module with the module's id`],
  );
}

export function assertNoBoundary(
  table: TagTable,
  rows: readonly (Tagged & { readonly uuid: string })[],
  change: Boundary,
): Effect.Effect<void, GateRefusal<'operation-only'>> {
  const carrier = rows.find((row) => table.supports(row, MODULE));
  return carrier === undefined ? Effect.void : boundaryRefusal(blockName(carrier.uuid), change);
}

export function assertNotOperated(
  table: TagTable,
  tags: readonly Tag[],
  fields: Readonly<Record<string, unknown>>,
  where: 'at birth' | 'by update',
): Effect.Effect<void, GateRefusal<'operation-only'>> {
  for (const tag of tags) {
    if (tag.id === CATALOG_DECLARATION.id && fields.release !== undefined) {
      return new GateRefusal('operation-only', 'catalog.release is installation provenance', [
        'edit the catalog guidance or membership; the installer records release provenance',
      ]);
    }
    const status = lifecycleOf(tag)?.field;
    if (status !== undefined && fields[status] !== undefined) {
      return new GateRefusal(
        'operation-only',
        `${tag.id}.${status} is not written ${where}: it is the status, moved by its own operations`,
        [
          where === 'at birth'
            ? `a ${tagLabel(tag)} is born at its initial word`
            : `update_block with status, for a move no operation owns; ${tagLabel(tag)}'s status line names the operation of every other move`,
        ],
      );
    }
    for (const { field, ops } of table.actionsOf(tag.id).slots) {
      if (fields[field] === undefined) continue;
      return new GateRefusal('operation-only', `${tag.id}.${field} is not written ${where}: ${ops.join(' and ')} write it`, [
        `${ops.join(' or ')} on the block`,
      ]);
    }
  }
  return Effect.void;
}

export function assertBareRefs(body: string): Effect.Effect<void, GateRefusal<'body-address'>> {
  return addressedRefsRefusal(body) ?? Effect.void;
}

export function assertBodyCap(
  tags: readonly Tag[],
  next: { readonly length: number },
  current?: { readonly length: number },
): Effect.Effect<void, GateRefusal<'body-capped'>> {
  const capped = bodyCap(tags);
  if (capped === null || next.length <= capped.cap) return Effect.void;
  if (current !== undefined && next.length < current.length) return Effect.void;
  return new GateRefusal(
    'body-capped',
    `the body is ${next.length} UTF-16 code units; ${tagLabel(capped.tag)} declares a maximum of ${capped.cap}`,
    ['provide a body within the declared constraint, or correct the tag declaration if its consuming contract changed'],
  );
}
