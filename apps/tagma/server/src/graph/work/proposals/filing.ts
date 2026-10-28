import { Clock, Effect } from 'effect';
import { type SourceInput } from '../../contract/wire/sources.js';
import { AMENDMENT_OPS, type AmendmentOp, type BatchRef } from '../../contract/wire/batch.js';
import { and, eq } from 'drizzle-orm';
import { GraphStore, type StoreFailure } from '../../../platform/contract/service/store.js';
import { block, edge } from '../../store/tables.js';
import { type BlockCreateRefusal, Blocks } from '../../contract/service/blocks.js';
import { assertBareRefs, assertBodyCap, leafRefusal } from '../../blocks/guards.js';
import { type FloorRefusal, GateRefusal } from '../../../platform/contract/wire/refusal.js';
import { Act, BlockNames, BlockProjection } from '../../contract/service/acts.js';
import { BlockRows } from '../../acts/rows.js';
import { type BlockRecord, type BlockRow, type BlockWrite } from '../../contract/service/acts.js';
import { tagLabel } from '../../contract/wire/tags/roles.js';
import { AMENDMENT, amendmentOf } from '../../contract/wire/tags/amendment.js';
import { LEAF } from '../../contract/wire/tags/leaf.js';
import type { CreationDefaultRefusal } from '../../contract/wire/tags/profile.js';
import type { TagTable } from '../../contract/wire/tags/table.js';
import type { ContractId } from '../../contract/wire/tags/behaviour.js';
import { readField } from '../../vocabulary/declarationRules.js';
import { Tags } from '../../contract/service/vocabulary.js';
import { Selection } from '../../contract/service/reads.js';
import { blockName } from '../../contract/wire/references.js';
import { writes } from '../../../platform/contract/service/writes.js';
import { projecting } from '../../store/actWrites.js';

const revising = writes('Review.revise', [block], projecting);

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
  row: BlockRow,
): Effect.Effect<readonly AmendmentOp[], GateRefusal<'not-an-amendment' | 'field-invalid'>> {
  const name = amendmentField(table, row);
  return name === null
    ? new GateRefusal('not-an-amendment', `${blockName(row.uuid)} binds no amendment field`, [
        'read_amendments — the open findings of a scope, each with what it would do',
      ])
    : readField(row, name, 'amendmentOps');
}

export type PayloadRefusal =
  | CreationDefaultRefusal
  | 'creation-contract'
  | 'amendment-empty'
  | 'amendment-op'
  | 'amendment-ref'
  | 'amendment-outside'
  | 'leaf'
  | 'not-found'
  | 'bad-name'
  | 'ambiguous-name';

type PayloadBodyRefusal =
  | CreationDefaultRefusal
  | 'creation-contract'
  | 'body-capped'
  | 'body-address'
  | 'not-found'
  | 'bad-name'
  | 'ambiguous-name';

type ProposeRefusal =
  | BlockCreateRefusal
  | 'cross-project'
  | 'amends-an-amendment'
  | 'amendment-shape'
  | CreationDefaultRefusal
  | PayloadRefusal
  | PayloadBodyRefusal;

type ReviseRefusal = FloorRefusal | 'not-found' | 'deleted' | 'not-an-amendment' | 'verdict-standing' | PayloadRefusal | PayloadBodyRefusal;

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

export const proposalFiling = Effect.gen(function* () {
  const { db } = yield* GraphStore;
  const act = yield* Act;
  const blockRows = yield* BlockRows;
  const blockNames = yield* BlockNames;
  const blockProjection = yield* BlockProjection;
  const blocks = yield* Blocks;
  const selection = yield* Selection;
  const vocabulary = yield* Tags;
  const tableOf = (row: { projectId: number }) => vocabulary.of(row.projectId);

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

  const assertPayloadBodies = Effect.fn('Review.assertPayloadBodies')(function* (
    table: TagTable,
    ops: readonly AmendmentOp[],
  ): Effect.fn.Return<void, StoreFailure | GateRefusal<PayloadBodyRefusal>> {
    const bodies = new Map<string, { tags: readonly string[]; body: string }>();
    const known = Effect.fn('Review.assertPayloadBodies.known')(function* (ref: BatchRef) {
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
          if (op.body !== undefined) {
            yield* assertBodyCap(table.tagsOf({ tags }), op.body);
            yield* assertBareRefs(op.body);
          }
          break;
        }
        case 'update': {
          if (op.body === undefined && op.tags === undefined) break;
          if (op.body !== undefined) yield* assertBareRefs(op.body);
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
          if (state.body !== replaced) yield* assertBareRefs(state.body);
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
  ): Effect.fn.Return<void, StoreFailure | GateRefusal<PayloadRefusal>> {
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

  const amendsEdgeOf = Effect.fn('Review.amendsEdgeOf')(function* (id: number) {
    const row = yield* db
      .select({ toId: edge.toId })
      .from(edge)
      .where(and(eq(edge.fromId, id), eq(edge.kind, 'amends')))
      .get();
    if (!row) return yield* Effect.die(`proposal ${yield* blockNames.nameOf(id)} has no amends edge`);
    return row.toId;
  });

  return {
    assertAmendment,
    amendsEdgeOf,
    propose: Effect.fn('Review.propose')(function* (input: {
      projectId: number;
      amendsId: number;
      title: string;
      body?: string;
      ops: readonly AmendmentOp[];
      sources?: readonly SourceInput[];
      parentId?: number;
    }): Effect.fn.Return<BlockWrite, StoreFailure | GateRefusal<ProposeRefusal>> {
      const target = yield* blockRows.blockById(input.amendsId);
      const table = yield* vocabulary.of(input.projectId);
      if (target.projectId !== input.projectId) {
        return yield* new GateRefusal('cross-project', 'a proposal amends a block of its own project', [
          'file the finding in the project that holds the block: a review reads one graph',
        ]);
      }
      if (table.supports(target, AMENDMENT)) {
        return yield* new GateRefusal('amends-an-amendment', 'a proposal is not amended — derive a new proposal on the same target', [
          `read_block ${target.id} — the amends edge names the block this finding is really about`,
          'a derived proposal names its sources `discovered-from` and is taken in their place',
        ]);
      }
      if (input.parentId !== undefined && input.parentId !== input.amendsId) {
        return yield* new GateRefusal('amendment-shape', 'a proposal lives under the block it amends', [
          `drop the parent: naming amendsId ${input.amendsId} already places it`,
        ]);
      }
      yield* assertAmendment(table, target, input.ops);
      yield* assertPayloadBodies(table, input.ops);
      const filed = yield* table.creationType(AMENDMENT);
      const binding = amendmentOf(filed);
      if (binding === null) return yield* Effect.die(`type ${filed.id} supports ${AMENDMENT} without its binding`);
      const born = yield* blocks.create({
        projectId: input.projectId,
        tags: [filed.id],
        title: input.title,
        body: input.body,
        amendsId: input.amendsId,
        fields: { [binding.ops]: [...input.ops] },
        sources: input.sources === undefined ? undefined : [...input.sources],
      });
      return born;
    }),

    revise: Effect.fn('Review.revise')(function* (input: {
      id: number;
      ops: readonly AmendmentOp[];
    }): Effect.fn.Return<BlockRecord, StoreFailure | GateRefusal<ReviseRefusal>> {
      const current = yield* blockRows.blockById(input.id);
      const table = yield* tableOf(current);
      if (!table.supports(current, AMENDMENT)) {
        return yield* new GateRefusal(
          'not-an-amendment',
          `${blockName(current.uuid)} is ${tagLabel(table.tagOf(current))}, which does not support the amendment contract; deferred ops belong to an amendment`,
          [`update_block on ${yield* blockNames.nameOf(input.id)} — the block's own text`],
        );
      }
      if (table.isTerminal(current)) {
        return yield* new GateRefusal(
          'verdict-standing',
          `${blockName(current.uuid)} is ${table.statusOf(current)}: a decided ${tagLabel(table.tagOf(current))} is history`,
          ['derive a new proposal on the same target: the propose op of `apply_batch`'],
        );
      }
      const target = yield* blockRows.blockById(yield* amendsEdgeOf(input.id));
      yield* assertAmendment(table, target, input.ops);
      yield* assertPayloadBodies(table, input.ops);
      return yield* act.unit(
        revising,
        Effect.gen(function* () {
          const now = new Date(yield* Clock.currentTimeMillis);
          const row = yield* db
            .update(block)
            .set({ fields: { ...current.fields, [amendmentField(table, current) ?? 'ops']: input.ops }, updatedAt: now })
            .where(eq(block.id, input.id))
            .returning()
            .get();
          if (!row) return yield* Effect.die('proposal revise returned no row');
          yield* blockProjection.syncTags(row.id);
          yield* act.record('revise', row.id, { amends: target.id, ops: input.ops.length }, now);
          return yield* blockRows.recordOf(row);
        }),
      );
    }),
  };
});

export type ProposalFiling = Effect.Success<typeof proposalFiling>;
