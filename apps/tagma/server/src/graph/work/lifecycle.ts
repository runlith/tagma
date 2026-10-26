import { Effect } from 'effect';
import { and, eq, isNull } from 'drizzle-orm';
import { block } from '../store/tables.js';
import type { StoreDb, StoreFailure } from '../../platform/contract/service/store.js';
import { blockName } from '../contract/wire/references.js';
import type { TagTable } from '../contract/wire/tags/table.js';
import type { TransitionRefusal } from '../contract/wire/lifecycle.js';
import { carriesTag } from '../vocabulary/projection.js';
import { statusTargets, statusWords, tagLabel } from '../contract/wire/tags/roles.js';
import { lifecycleOf } from '../contract/wire/tags/lifecycle.js';
import type { Tag } from '../contract/wire/tags/declaration.js';
import type { Unblock } from '../../platform/contract/wire/refusal.js';
import { WORK } from '../contract/wire/tags/work.js';
import { contractAt } from '../vocabulary/projection.js';
import { moveOwners, type TagActions } from '../contract/wire/tags/actions.js';

export type TransitionVerdict = { ok: true } | { ok: false; code: TransitionRefusal; reason: string; unblock: Unblock };

export function checkTransition(actions: TagActions, tag: Tag | null, from: string | null, to: string): TransitionVerdict {
  const label = tagLabel(tag);
  const field = tag === null ? undefined : lifecycleOf(tag)?.field;
  if (tag === null || field === undefined) {
    return refuse('no-status', `${label} supports no core/lifecycle: there is no work on it to report`, [
      'supersede_block — a node that reports no work leaves the working set by being replaced',
    ]);
  }
  const words = statusWords(tag);
  if (!words.includes(to)) {
    return refuse(
      'illegal-status',
      `status "${to}" is not one of ${label}.${field}`,
      words.length === 0
        ? [`${label}.${field} declares no words: ${label} binds its lifecycle status to a field that names none`]
        : [`the words of ${label}.${field}: ${words.join(', ')}`],
    );
  }
  const targets = from === null ? [...words] : statusTargets(tag, from);
  if (!targets.includes(to)) {
    const moves = targets.map((target) => {
      const owners = moveOwners(actions, field, from, target).map((move) => move.op);
      return `${target} (${owners.length === 0 ? 'update_block' : owners.join(' or ')})`;
    });
    return refuse(
      'illegal-transition',
      `"${from}" → "${to}" is not a legal transition`,
      targets.length === 0
        ? [`"${from}" is where the work of a ${label} ends: no status follows it`]
        : [`legal moves from "${from}", each by its operation: ${moves.join(', ')}`],
    );
  }
  return { ok: true };
}

function refuse(code: TransitionRefusal, reason: string, unblock: Unblock): TransitionVerdict {
  return { ok: false, code, reason, unblock };
}

export const openChildrenOf = Effect.fn('openChildrenOf')(function* (
  db: StoreDb<'graph'>,
  table: TagTable,
  node: { readonly id: number; readonly tags: readonly string[]; readonly fields: Readonly<Record<string, unknown>> },
): Effect.fn.Return<string[], StoreFailure> {
  const blocking = table
    .tagsOf(node)
    .flatMap((tag) =>
      tag.gates.flatMap((gate) => (gate.gate === 'open-children' ? [table.identities.resolveStoredType(gate.tag) ?? gate.tag] : [])),
    );
  if (blocking.length === 0) return [];
  const rows = yield* db
    .select({ uuid: block.uuid })
    .from(block)
    .where(
      and(eq(block.parentId, node.id), carriesTag(blocking, block.id), contractAt(table, WORK, 'open', block.id), isNull(block.deletedAt)),
    );
  return rows.map((row) => blockName(row.uuid));
});
