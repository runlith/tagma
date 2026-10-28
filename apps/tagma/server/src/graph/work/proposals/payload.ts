import { Effect } from 'effect';
import { and, eq } from 'drizzle-orm';
import { AMENDMENT_OPS, type AmendmentOp, type BatchRef } from '../../contract/wire/batch.js';
import { GraphStore, type StoreFailure } from '../../../platform/contract/service/store.js';
import { edge } from '../../store/tables.js';
import { assertBodyCap, leafRefusal } from '../../blocks/guards.js';
import { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import { BlockNames, type BlockRow } from '../../contract/service/acts.js';
import { BlockRows } from '../../acts/rows.js';
import type { AmendmentPayloadRefusal, AmendmentRefusal } from '../../contract/service/blocks.js';
import { AMENDMENT, amendmentOf } from '../../contract/wire/tags/amendment.js';
import { LEAF } from '../../contract/wire/tags/leaf.js';
import { type Tagged, tagLabel } from '../../contract/wire/tags/roles.js';
import type { TagTable } from '../../contract/wire/tags/table.js';
import type { ContractId } from '../../contract/wire/tags/behaviour.js';
import { readField } from '../../vocabulary/declarationRules.js';
import { Selection } from '../../contract/service/reads.js';
import { addressedRefsRefusal, blockName } from '../../contract/wire/references.js';

type Deferring = Tagged & { readonly uuid: string };

export function amendmentField(table: TagTable, row: { readonly tags: readonly string[] }): string | null {
  return (
    table
      .tagsOf(row)
      .map(amendmentOf)
      .find((binding) => binding !== null)?.ops ?? null
  );
}

export function deferredOps(
  table: TagTable,
  row: Deferring,
): Effect.Effect<readonly AmendmentOp[], GateRefusal<'not-an-amendment' | 'field-invalid'>> {
  const name = amendmentField(table, row);
  return name === null
    ? new GateRefusal('not-an-amendment', `${blockName(row.uuid)} binds no amendment field`, [
        'read_amendments — the open findings of a scope, each with what it would do',
      ])
    : readField(row, name, 'amendmentOps');
}

const payloadNames = (ops: readonly AmendmentOp[]): string[] => {
  const spelled: (BatchRef | undefined)[] = [];
  for (const op of ops) {
    if (!(AMENDMENT_OPS as readonly string[]).includes(op.op)) continue;
    switch (op.op) {
      case 'create':
        spelled.push(op.parentId, ...(op.edges ?? []).map((link) => link.to));
        break;
      case 'edit':
      case 'delete':
        spelled.push(op.id);
        break;
      case 'update':
        spelled.push(op.id, op.parentId);
        break;
      case 'link':
      case 'unlink':
        spelled.push(op.fromId, op.toId);
        break;
    }
  }
  return spelled.filter((value): value is BatchRef => value !== undefined && !value.startsWith('$'));
};

function assertBareOps(ops: readonly AmendmentOp[]): Effect.Effect<void, GateRefusal<'body-address'>> {
  for (const [index, op] of ops.entries()) {
    const text = op.op === 'edit' ? op.new : op.op === 'create' || op.op === 'update' ? op.body : undefined;
    const refused = text === undefined ? null : addressedRefsRefusal(text);
    if (refused !== null) return new GateRefusal('body-address', `ops[${index}] (${op.op}): ${refused.reason}`, refused.unblock);
  }
  return Effect.void;
}

export const payloadGate = Effect.gen(function* () {
  const { db } = yield* GraphStore;
  const blockRows = yield* BlockRows;
  const blockNames = yield* BlockNames;
  const selection = yield* Selection;

  const creationTags = Effect.fn('Review.creationTags')(function* (
    table: TagTable,
    input: { readonly tags?: readonly string[]; readonly contract?: ContractId },
  ) {
    const selected =
      input.tags === undefined && input.contract !== undefined ? [(yield* table.creationType(input.contract)).id] : (input.tags ?? []);
    const tags = selected.map((word) => table.identities.keyOf(word) ?? word);
    if (input.contract !== undefined && !table.supports({ tags }, input.contract)) {
      return yield* new GateRefusal('creation-contract', `the deferred create's types do not support ${input.contract}`, [
        'omit tags to select the installed creation default, or name types supporting the required contract',
      ]);
    }
    return tags;
  });

  const assertPayloadCaps = Effect.fn('Review.assertPayloadCaps')(function* (table: TagTable, ops: readonly AmendmentOp[]) {
    const bodies = new Map<string, { tags: readonly string[]; body: string }>();
    const known = Effect.fn('Review.assertPayloadCaps.known')(function* (ref: BatchRef) {
      const held = bodies.get(ref);
      if (held !== undefined) return held;
      if (ref.startsWith('$')) return undefined;
      const row = yield* blockRows.liveBlock(yield* blockNames.idOfName(ref));
      if (row === undefined) return undefined;
      const state = { tags: row.tags, body: row.body };
      bodies.set(ref, state);
      return state;
    });
    for (const op of ops) {
      switch (op.op) {
        case 'create': {
          const tags = yield* creationTags(table, op);
          if (op.$id !== undefined) bodies.set(`$${op.$id}`, { tags, body: op.body ?? '' });
          if (op.body !== undefined) yield* assertBodyCap(table.tagsOf({ tags }), op.body);
          break;
        }
        case 'update': {
          if (op.body === undefined && op.tags === undefined) break;
          const state = yield* known(op.id);
          if (state === undefined) break;
          const replaced = state.body;
          if (op.body !== undefined) state.body = op.body;
          if (op.tags !== undefined) state.tags = op.tags.map((word) => table.identities.keyOf(word) ?? word);
          yield* assertBodyCap(table.tagsOf(state), state.body, op.tags === undefined ? replaced : undefined);
          break;
        }
        case 'edit': {
          const state = yield* known(op.id);
          if (state === undefined) break;
          const replaced = state.body;
          state.body = op.all === true ? state.body.replaceAll(op.old, op.new) : state.body.replace(op.old, op.new);
          yield* assertBodyCap(table.tagsOf(state), state.body, replaced);
          break;
        }
        default:
          break;
      }
    }
  });

  const assertAmendment = Effect.fn('Review.assertAmendment')(function* (
    table: TagTable,
    target: BlockRow,
    ops: readonly AmendmentOp[],
  ): Effect.fn.Return<void, StoreFailure | GateRefusal<AmendmentRefusal>> {
    if (!Array.isArray(ops) || ops.length === 0) {
      return yield* new GateRefusal('amendment-empty', 'a proposal defers at least one op', [
        `what the finding IS is the shape of what it defers: ${AMENDMENT_OPS.join(', ')}`,
        'a finding with nothing to do is a note, and it belongs in a body',
      ]);
    }
    const subtree = yield* selection.subtree(target.id);
    const handles = new Map<string, readonly string[]>();
    const named = yield* blockNames.idsOfNames(payloadNames(ops));
    const idOf = Effect.fn('Review.assertAmendment.idOf')(function* (
      value: string,
      index: number,
      op: string,
    ): Effect.fn.Return<number | undefined, GateRefusal<'amendment-ref' | 'not-found' | 'bad-name' | 'ambiguous-name'> | StoreFailure> {
      if (value.startsWith('$')) {
        if (!handles.has(value.slice(1))) {
          return yield* new GateRefusal(
            'amendment-ref',
            `ops[${index}] (${op}): "${value}" names no handle declared earlier in this payload`,
            ['payload handles live in their own namespace: declare "$id" on a create inside the payload'],
          );
        }
        return undefined;
      }
      return named.get(value.toLowerCase().replaceAll('-', '')) ?? (yield* blockNames.idOfName(value));
    });
    const inScope = Effect.fn('Review.assertAmendment.inScope')(function* (
      value: BatchRef | undefined,
      index: number,
      op: string,
      role: string,
      instead?: string,
    ): Effect.fn.Return<
      void,
      GateRefusal<'amendment-outside' | 'amendment-ref' | 'not-found' | 'bad-name' | 'ambiguous-name'> | StoreFailure
    > {
      if (value === undefined) return;
      const id = yield* idOf(value, index, op);
      if (id === undefined) return;
      if (!subtree.has(id)) {
        return yield* new GateRefusal(
          'amendment-outside',
          `ops[${index}] (${op}): ${role} ${value} is outside the amended subtree of ${blockName(target.uuid)}`,
          instead === undefined
            ? ['a proposal writes only inside the subtree of the block it amends']
            : [instead, 'a proposal writes only inside the subtree of the block it amends'],
        );
      }
    });
    const takesChildren = Effect.fn('Review.assertAmendment.takesChildren')(function* (value: BatchRef, index: number, op: string) {
      const id = yield* idOf(value, index, op);
      const tags = id === undefined ? handles.get(value.slice(1)) : (yield* blockRows.liveBlock(id))?.tags;
      if (tags !== undefined && table.supports({ tags }, LEAF)) {
        return yield* leafRefusal(`ops[${index}] (${op}): parent ${value}`);
      }
    });
    const destination = Effect.fn('Review.assertAmendment.destination')(function* (
      value: BatchRef | undefined,
      index: number,
    ): Effect.fn.Return<void, GateRefusal<'leaf' | 'amendment-ref' | 'not-found' | 'bad-name' | 'ambiguous-name'> | StoreFailure> {
      if (value === undefined) return;
      yield* takesChildren(value, index, 'update');
    });
    for (const [index, op] of ops.entries()) {
      if (!(AMENDMENT_OPS as readonly string[]).includes(op.op)) {
        return yield* new GateRefusal('amendment-op', `ops[${index}]: "${(op as { op?: unknown }).op}" is not an amendment op`, [
          `a proposal defers: ${AMENDMENT_OPS.join(', ')}`,
        ]);
      }
      switch (op.op) {
        case 'create': {
          const tags = yield* creationTags(table, op);
          if (table.supports({ tags }, AMENDMENT)) {
            return yield* new GateRefusal('amendment-op', `ops[${index}]: a proposal does not create proposals`, [
              'file a second proposal of your own beside this one: one per coherent finding',
            ]);
          }
          if (op.parentId === undefined) {
            if (target.parentId !== null) {
              return yield* new GateRefusal(
                'amendment-outside',
                `ops[${index}] (create): no parent lands under the project root, outside the amended subtree`,
                ['name a parentId inside the subtree'],
              );
            }
          } else {
            yield* inScope(op.parentId, index, 'create', 'parent');
            yield* takesChildren(op.parentId, index, 'create');
          }
          for (const link of op.edges ?? []) yield* inScope(link.to, index, 'create', `${link.kind} target`);
          if (op.$id !== undefined) {
            if (handles.has(op.$id)) {
              return yield* new GateRefusal('amendment-ref', `ops[${index}]: handle "$${op.$id}" is declared twice`, [
                'give this create its own "$id": a handle names exactly one block of the payload',
              ]);
            }
            handles.set(op.$id, tags);
          }
          break;
        }
        case 'edit':
        case 'delete':
          yield* inScope(op.id, index, op.op, 'block');
          break;
        case 'update':
          yield* inScope(
            op.id,
            index,
            'update',
            'block',
            op.parentId === undefined
              ? undefined
              : `a move is amended on the block that MOVES: file this finding on ${op.id}, naming ${op.parentId} as its parentId`,
          );
          yield* destination(op.parentId, index);
          break;
        case 'link':
        case 'unlink':
          yield* inScope(op.fromId, index, op.op, 'edge end');
          yield* inScope(op.toId, index, op.op, 'edge end');
          break;
      }
    }
  });

  const assertPayload = Effect.fnUntraced(function* (table: TagTable, target: BlockRow, ops: readonly AmendmentOp[]) {
    yield* assertAmendment(table, target, ops);
    yield* assertPayloadCaps(table, ops);
    yield* assertBareOps(ops);
  });

  const amendsEdgeOf = Effect.fn('Review.amendsEdgeOf')(function* (id: number) {
    const row = yield* db
      .select({ toId: edge.toId })
      .from(edge)
      .where(and(eq(edge.fromId, id), eq(edge.kind, 'amends')))
      .get();
    if (!row) return yield* Effect.die(`proposal ${yield* blockNames.nameOf(id)} has no amends edge`);
    return row.toId;
  });

  const assertFiled = Effect.fn('Review.assertFiled')(function* (
    table: TagTable,
    filed: { readonly projectId: number; readonly amendsId: number; readonly parentId: number | undefined; readonly node: Deferring },
  ): Effect.fn.Return<
    void,
    StoreFailure | GateRefusal<AmendmentPayloadRefusal | 'field-invalid' | 'cross-project' | 'amends-an-amendment' | 'amendment-shape'>
  > {
    const target = yield* blockRows.blockById(filed.amendsId);
    if (target.projectId !== filed.projectId) {
      return yield* new GateRefusal('cross-project', 'a proposal amends a block of its own project', [
        'file the finding in the project that holds the block: a review reads one graph',
      ]);
    }
    if (table.supports(target, AMENDMENT)) {
      return yield* new GateRefusal('amends-an-amendment', 'a proposal is not amended — derive a new proposal on the same target', [
        `read_block ${blockName(target.uuid)} — the amends edge names the block this finding is really about`,
        'a derived proposal names its sources `discovered-from` and is taken in their place',
      ]);
    }
    if (filed.parentId !== undefined && filed.parentId !== filed.amendsId) {
      return yield* new GateRefusal('amendment-shape', 'a proposal lives under the block it amends', [
        `drop the parent: naming amendsId ${blockName(target.uuid)} already places it`,
      ]);
    }
    const field = amendmentField(table, filed.node);
    if (field === null || filed.node.fields[field] === undefined) return;
    yield* assertPayload(table, target, yield* readField(filed.node, field, 'amendmentOps'));
  });

  const assertRevised = Effect.fn('Review.assertRevised')(function* (
    table: TagTable,
    current: BlockRow,
    ops: readonly AmendmentOp[],
  ): Effect.fn.Return<BlockRow, StoreFailure | GateRefusal<AmendmentPayloadRefusal | 'verdict-standing'>> {
    if (table.isTerminal(current)) {
      return yield* new GateRefusal(
        'verdict-standing',
        `${blockName(current.uuid)} is ${table.statusOf(current)}: a decided ${tagLabel(table.tagOf(current))} is history`,
        ['derive a new proposal on the same target: the propose op of `apply_batch`'],
      );
    }
    const target = yield* blockRows.blockById(yield* amendsEdgeOf(current.id));
    yield* assertPayload(table, target, ops);
    return target;
  });

  return { assertAmendment, assertFiled, assertRevised, amendsEdgeOf };
});

export type PayloadGate = Effect.Success<typeof payloadGate>;
