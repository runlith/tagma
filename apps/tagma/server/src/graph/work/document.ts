import { Effect, Layer } from 'effect';
import * as Hex from 'effect/encoding/Hex';
import type { DocumentOp, BatchRef } from '../contract/wire/batch.js';
import type { BlockQuery } from '../contract/wire/query.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { FieldType, Tag } from '../contract/wire/tags/declaration.js';
import type { TagTable } from '../contract/wire/tags/table.js';
import { mintBlockId } from '../contract/wire/identity.js';
import { Tags } from '../contract/service/vocabulary.js';
import { declaringTag } from '../vocabulary/declarationRules.js';
import { fieldTargetGuard } from '../vocabulary/carriers.js';

import { eq, inArray } from 'drizzle-orm';
import { GraphStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { block } from '../store/tables.js';
import { Blocks } from '../contract/service/blocks.js';
import { assertBodyCap } from '../blocks/guards.js';
import { bodyDelta } from '../blocks/bodyDiff.js';
import { Edges } from '../contract/service/blocks.js';
import { Act, BlockNames, BlockProjection, BlockReferences, Unborn } from '../contract/service/acts.js';
import { BlockRows } from '../acts/rows.js';
import { ActState } from '../contract/service/transaction.js';
import { blockName } from '../contract/wire/references.js';
import { Trash } from '../contract/service/blocks.js';
import {
  Documents,
  type DocumentOpRefusal,
  type BatchAnswer,
  type DocumentRefRefusal,
  type DocumentReferences,
  type DocumentRefusal,
  type Handles,
  type OpOutcome,
} from '../contract/service/work.js';
import { writes } from '../../platform/contract/service/writes.js';
import { projecting, referencing } from '../store/actWrites.js';

const applying = writes('Documents.runDocument', [block], projecting, referencing);

export const handleId = (handles: Handles, name: string): number | undefined => handles.declared.get(name);

const textEncoder = new TextEncoder();

export function refOf(handles: Handles, value: BatchRef): Effect.Effect<number, GateRefusal<DocumentRefRefusal> | StoreFailure> {
  if (value.startsWith('$')) {
    const id = handleId(handles, value.slice(1));
    if (id === undefined) {
      return new GateRefusal('batch-ref', `"${value}" names no block: "$handle" references a "$id" declared earlier in the batch`, [
        'move the create that declares it above this op, or write the block’s own name',
      ]);
    }
    return Effect.succeed(id);
  }
  return handles.references.resolve(value);
}

export function optionalRef(
  handles: Handles,
  value: BatchRef | undefined,
): Effect.Effect<number | undefined, GateRefusal<DocumentRefRefusal> | StoreFailure> {
  return value === undefined ? Effect.succeed(undefined) : refOf(handles, value);
}

type FieldWrite = { readonly fields?: Readonly<Record<string, unknown>>; readonly unborn: boolean };

const handleOf = (declared: string): string => (declared.startsWith('$') ? declared.slice(1) : declared);

function mintedHandles(ops: readonly { readonly op: string }[]): Map<string, string> {
  const minted = new Map<string, string>();
  for (const op of ops) {
    const declared = (op as { readonly $id?: unknown }).$id;
    if (op.op !== 'create' || typeof declared !== 'string') continue;
    const handle = handleOf(declared);
    if (handle.length > 0 && !minted.has(handle)) minted.set(handle, mintBlockId());
  }
  return minted;
}

function declaredField(table: TagTable, tags: readonly Tag[], name: string): FieldType | undefined {
  const keys = [...new Set(tags.flatMap((tag) => table.identities.fieldKeyOf(tag.id, name) ?? []))];
  const key = keys.length === 1 ? keys[0]! : name;
  return declaringTag(tags, key)?.fields[key];
}

export function register(handles: Handles, handle: string | undefined, id: number): Effect.Effect<void, GateRefusal<'batch-ref'>> {
  if (handle === undefined) return Effect.void;
  const name = handleOf(handle);
  if (name.length === 0) {
    return new GateRefusal('batch-ref', '"$id" needs a name: "$id": "a" declares the handle "$a"', [
      'name the handle after the block it stands for, letters and digits',
    ]);
  }
  if (handles.declared.has(name)) {
    return new GateRefusal('batch-ref', `handle "$${name}" is declared twice`, [
      'give the second create its own "$id": a handle names exactly one block of the document',
    ]);
  }
  handles.declared.set(name, id);
  return Effect.void;
}

function opAddress(index: number, op: string): string {
  return `ops[${index}] (${op})`;
}

export const documentsLayer: Layer.Layer<
  Documents,
  never,
  GraphStore | Act | Blocks | Edges | Trash | Tags | BlockRows | BlockNames | BlockProjection | BlockReferences
> = Layer.effect(
  Documents,
  Effect.gen(function* () {
    const { db } = yield* GraphStore;
    const act = yield* Act;
    const blockRows = yield* BlockRows;
    const blockNames = yield* BlockNames;
    const blockProjection = yield* BlockProjection;
    const blockReferences = yield* BlockReferences;
    const blocks = yield* Blocks;
    const edges = yield* Edges;
    const trash = yield* Trash;
    const vocabulary = yield* Tags;
    const assertFieldTargets = yield* fieldTargetGuard;

    const assertAwaited = Effect.fn('Documents.assertAwaited')(function* (
      awaited: ReadonlyMap<number, { readonly index: number; readonly op: string }>,
    ): Effect.fn.Return<void, StoreFailure | GateRefusal<'field-target' | 'not-found'>> {
      for (const [id, { index, op }] of awaited) {
        const row = yield* blockRows.rawBlockById(id);
        const table = yield* vocabulary.of(row.projectId);
        yield* assertFieldTargets(table, row.projectId, table.tagsOf(row), row.fields).pipe(
          Effect.catchTag(
            'GateRefusal',
            (refusal: GateRefusal<'field-target'>) =>
              new GateRefusal(refusal.code, `${opAddress(index, op)}: ${refusal.reason}`, refusal.unblock),
          ),
        );
      }
    });

    const resolveHandleRefs = Effect.fn('Documents.rewriteHandles')(function* (
      actId: string,
      graphId: number | undefined,
      handles: Handles,
      written: readonly { readonly index: number; readonly op: string; readonly id: number }[],
      bodyFiles?: ReadonlyMap<number, string | undefined>,
    ): Effect.fn.Return<void, StoreFailure | GateRefusal<'batch-ref' | 'body-capped'>, ActState> {
      yield* Effect.annotateCurrentSpan({
        actId,
        graphId,
        writtenBlocks: written.length,
      });
      const named = new Map<number, string>();
      const reachable = [...handles.declared.values()];
      if (reachable.length > 0) {
        const rows = yield* db.select({ id: block.id, uuid: block.uuid }).from(block).where(inArray(block.id, reachable));
        for (const row of rows) named.set(row.id, blockName(row.uuid));
      }
      for (const item of written) {
        yield* Effect.yieldNow;
        const row = yield* db
          .select({ body: block.body, tags: block.tags, projectId: block.projectId })
          .from(block)
          .where(eq(block.id, item.id))
          .get();
        if (!row?.body.includes('[[$')) continue;
        const unknown: string[] = [];
        const body = row.body.replaceAll(/\[\[\$([A-Za-z0-9_-]+)(\|[^\]\n]+)?\]\]/g, (whole, handle: string, label: string | undefined) => {
          const target = handleId(handles, handle);
          if (target === undefined) {
            if (!handles.literals.get(item.id)?.has(handle)) unknown.push(handle);
            return whole;
          }
          return `[[${named.get(target) ?? ''}${label ?? ''}]]`;
        });
        const missing = unknown[0];
        if (missing !== undefined) {
          return yield* new GateRefusal('batch-ref', `"$${missing}" in a body names no handle declared in this batch`, [
            `declare "$id": "${missing}" on a create in this same document — before or after the body that names it`,
            'a block that already exists is written as [[name]], not as a handle',
          ]);
        }
        if (body === row.body) continue;
        const table = yield* vocabulary.of(row.projectId);
        const capped = yield* Effect.result(assertBodyCap(table.tagsOf(row), body, row.body));
        if (capped._tag === 'Failure') {
          return yield* new GateRefusal(
            capped.failure.code,
            `${opAddress(item.index, item.op)}: ${capped.failure.reason}`,
            capped.failure.unblock,
            bodyFiles?.get(item.index),
          );
        }
        yield* db.update(block).set({ body }).where(eq(block.id, item.id));
        yield* blockReferences.syncRefs(item.id, body);
        yield* blockProjection.syncSearch(item.id);
        yield* act.record('update', item.id, {
          structural: false,
          chars: body.length,
          wasChars: row.body.length,
          delta: bodyDelta(row.body, body),
        });
      }
    });

    const runDocument = Effect.fn('Documents.runDocument')(function* <Op extends { op: string }, Code extends string>(
      ops: readonly Op[],
      dispatch: (op: Op, handles: Handles, index: number) => Effect.Effect<OpOutcome, StoreFailure | GateRefusal<Code>, ActState>,
      bodyFiles?: ReadonlyMap<number, string | undefined>,
      references?: DocumentReferences,
    ): Effect.fn.Return<BatchAnswer, StoreFailure | GateRefusal<Code | DocumentRefusal>> {
      const actId = Hex.random(16);
      yield* Effect.annotateCurrentSpan({ actId });
      if (!Array.isArray(ops) || ops.length === 0) {
        return yield* new GateRefusal('batch-shape', 'the document is {"ops": [...]} with at least one operation', [
          'apply_batch states the exact fields of every op, and the "$handle" namespace',
        ]);
      }
      const handles: Handles = {
        declared: new Map(),
        literals: new Map(),
        minted: mintedHandles(ops),
        awaiting: new Set(),
        references: references ?? {
          resolve: blockNames.idOfName,
          target: (name) => Effect.map(blockNames.idOfName(name), (near) => ({ near })),
        },
      };
      const mintedNames = new Map([...handles.minted].map(([handle, uuid]) => [blockName(uuid), handle] as const));
      const unborn = (name: string): boolean => {
        const handle = mintedNames.get(name);
        return handle !== undefined && !handles.declared.has(handle);
      };
      const results: BatchAnswer['ops'] = [];
      const named: Record<string, string> = {};
      const graphIds = new Set<number>();
      let bodyBytes = 0;
      const written: Array<{
        index: number;
        op: string;
        id: number;
        refsIn: string[];
      }> = [];
      const awaited = new Map<number, { readonly index: number; readonly op: string }>();
      yield* act.unit(
        applying,
        Effect.gen(function* () {
          yield* Effect.gen(function* () {
            for (const [index, op] of ops.entries()) {
              const outcome = yield* Effect.result(
                Effect.gen(function* () {
                  const result = yield* dispatch(op, handles, index);
                  if ('projectId' in result && typeof result.projectId === 'number') {
                    yield* Effect.annotateCurrentSpan({ graphId: result.projectId });
                  }
                  return result;
                }).pipe(
                  Effect.withSpan('Documents.op', {
                    attributes: { actId, opKind: op.op, opIndex: index },
                  }),
                ),
              );
              if (outcome._tag === 'Failure') {
                const failure = outcome.failure;
                if (failure._tag !== 'GateRefusal') return yield* Effect.fail(failure);
                return yield* new GateRefusal(
                  failure.code,
                  `${opAddress(index, op.op)}: ${failure.reason}`,
                  failure.unblock,
                  failure.inputFile,
                );
              }
              const result = outcome.success;
              if ('projectId' in result && typeof result.projectId === 'number') graphIds.add(result.projectId);
              results.push(result);
              if ('refsIn' in result) {
                written.push({ index, op: op.op, id: result.id, refsIn: result.refsIn });
                if (handles.awaiting.has(result.id) && !awaited.has(result.id)) awaited.set(result.id, { index, op: op.op });
              }
              yield* Effect.yieldNow;
            }
          }).pipe(Effect.provideService(Unborn, unborn));
          yield* assertAwaited(awaited);
          const [graphId] = graphIds.size === 1 ? graphIds : [];
          yield* resolveHandleRefs(actId, graphId, handles, written, bodyFiles);
          bodyBytes = yield* Effect.gen(function* () {
            let bytes = 0;
            for (const item of written) {
              yield* Effect.yieldNow;
              const row = yield* blockRows.rawBlockById(item.id);
              bytes += textEncoder.encode(row.body).byteLength;
              results[item.index] = {
                ...(yield* blockRows.written(row, false)),
                refsIn: item.refsIn,
              };
            }
            yield* Effect.annotateCurrentSpan({ bodyBytes: bytes });
            return bytes;
          }).pipe(
            Effect.withSpan('Documents.project', {
              attributes: {
                actId,
                graphId,
                writtenBlocks: written.length,
              },
            }),
          );
          for (const [handle, id] of handles.declared) named[handle] = yield* blockNames.nameOf(id);
        }),
      );
      const [graphId] = graphIds.size === 1 ? graphIds : [];
      yield* Effect.annotateCurrentSpan({
        graphId,
        writtenBlocks: written.length,
        bodyBytes,
      });
      return { ops: results, ids: named };
    });

    const nameOfRef = Effect.fn('Documents.nameOfRef')(function* (
      handles: Handles,
      value: string,
    ): Effect.fn.Return<{ readonly name: string; readonly unborn: boolean }, StoreFailure | GateRefusal<'batch-ref'>> {
      if (!value.startsWith('$')) return { name: value, unborn: false };
      const handle = value.slice(1);
      const id = handleId(handles, handle);
      if (id !== undefined) return { name: yield* blockNames.nameOf(id), unborn: false };
      const minted = handles.minted.get(handle);
      if (minted !== undefined) return { name: blockName(minted), unborn: true };
      return yield* new GateRefusal('batch-ref', `"${value}" names no handle declared in this document`, [
        `declare "$id": "${handle}" on a create in this same document — above or below the op that names it`,
        'a block that already exists is written by its name, not as a handle',
      ]);
    });

    const resolveQueryRefs = Effect.fn('Documents.resolveQueryRefs')(function* (
      handles: Handles,
      query: BlockQuery,
    ): Effect.fn.Return<BlockQuery, StoreFailure | GateRefusal<DocumentRefRefusal>> {
      const named = Effect.fn(function* (value: string) {
        return (yield* nameOfRef(handles, value)).name;
      });
      return {
        ...query,
        scope: query.scope === undefined ? undefined : yield* Effect.forEach(query.scope, named),
        edge:
          query.edge === undefined
            ? undefined
            : {
                ...query.edge,
                to: query.edge.to === undefined ? undefined : yield* named(query.edge.to),
                from: query.edge.from === undefined ? undefined : yield* named(query.edge.from),
              },
      };
    });

    const resolveFieldRefs = Effect.fn('Documents.resolveFieldRefs')(function* (
      handles: Handles,
      table: TagTable,
      tags: readonly Tag[],
      fields: Readonly<Record<string, unknown>> | undefined,
    ): Effect.fn.Return<FieldWrite, StoreFailure | GateRefusal<DocumentRefRefusal>> {
      if (fields === undefined) return { unborn: false };
      const resolved: Record<string, unknown> = { ...fields };
      let unborn = false;
      const named = Effect.fn(function* (value: unknown) {
        if (typeof value !== 'string') return value;
        const ref = yield* nameOfRef(handles, value);
        unborn ||= ref.unborn;
        return ref.name;
      });
      for (const [name, value] of Object.entries(fields)) {
        if (value === null) continue;
        const declared = declaredField(table, tags, name);
        if (declared === undefined || typeof declared === 'string') continue;
        if (declared.type === 'ref') {
          resolved[name] = Array.isArray(value) ? yield* Effect.forEach(value, (entry) => named(entry)) : yield* named(value);
        }
        if (declared.type === 'schema' && declared.name === 'blockQuery') {
          resolved[name] = yield* resolveQueryRefs(handles, value as BlockQuery);
        }
      }
      return { fields: resolved, unborn };
    });

    const applyOp = Effect.fn('Documents.applyOp')(function* (
      op: DocumentOp,
      handles: Handles,
      projectId: number,
    ): Effect.fn.Return<OpOutcome, StoreFailure | GateRefusal<DocumentOpRefusal>, ActState> {
      if ((op.op === 'edit' || op.op === 'update') && !op.id.startsWith('$')) {
        const id = yield* refOf(handles, op.id);
        if (!handles.literals.has(id)) {
          const row = yield* blockRows.blockById(id);
          handles.literals.set(id, new Set([...row.body.matchAll(/\[\[\$([A-Za-z0-9_-]+)(?:\|[^\]\n]+)?\]\]/g)].map((match) => match[1]!)));
        }
      }
      switch (op.op) {
        case 'create': {
          const table = yield* vocabulary.of(projectId);
          const selected =
            op.tags === undefined && op.contract !== undefined ? [(yield* table.creationType(op.contract)).id] : (op.tags ?? []);
          const tags = selected.map((word) => table.identities.keyOf(word) ?? word);
          const written = yield* resolveFieldRefs(handles, table, table.tagsOf({ tags }), op.fields);
          const handle = op.$id === undefined ? undefined : handleOf(op.$id);
          const uuid = handle === undefined || handles.declared.has(handle) ? undefined : handles.minted.get(handle);
          const linked = yield* Effect.forEach(op.edges ?? [], (link) =>
            Effect.map(
              link.to.startsWith('$')
                ? Effect.map(refOf(handles, link.to), (near) => ({ near }))
                : handles.references.target(link.to, projectId, link.kind),
              (target) => ({ kind: link.kind, target }),
            ),
          );
          const row = yield* blocks.create({
            ...op,
            tags,
            projectId,
            fields: written.fields,
            uuid,
            parentId: yield* optionalRef(handles, op.parentId),
            edges:
              op.edges === undefined
                ? undefined
                : linked.flatMap((link) => ('near' in link.target ? [{ kind: link.kind, to: link.target.near }] : [])),
            farEdges: linked.flatMap((link) => ('far' in link.target ? [{ kind: link.kind, end: link.target.far }] : [])),
          });
          if (written.unborn) handles.awaiting.add(row.id);
          handles.literals.set(row.id, new Set());
          yield* register(handles, op.$id, row.id);
          return row;
        }
        case 'update': {
          const id = yield* refOf(handles, op.id);
          const table = yield* vocabulary.of(projectId);
          const typed =
            op.tags === undefined ? yield* blockRows.blockById(id) : { tags: op.tags.map((word) => table.identities.keyOf(word) ?? word) };
          const written: FieldWrite =
            op.fields === undefined ? { unborn: false } : yield* resolveFieldRefs(handles, table, table.tagsOf(typed), op.fields);
          const row = yield* blocks.update({
            id,
            title: op.title,
            body: op.body,
            status: op.status,
            tags: op.tags,
            parentId: yield* optionalRef(handles, op.parentId),
            ord: op.ord,
            fields: written.fields,
          });
          if (written.unborn) handles.awaiting.add(id);
          return row;
        }
        case 'edit':
          return yield* blocks.edit({ id: yield* refOf(handles, op.id), old: op.old, new: op.new, all: op.all });
        case 'link':
          yield* edges.link({ fromId: yield* refOf(handles, op.fromId), kind: op.kind, toId: yield* refOf(handles, op.toId) });
          return { ok: true };
        case 'unlink':
          yield* edges.unlink({ fromId: yield* refOf(handles, op.fromId), kind: op.kind, toId: yield* refOf(handles, op.toId) });
          return { ok: true };
        case 'delete':
          return yield* trash.delete({ id: yield* refOf(handles, op.id) });
      }
    });

    return Documents.of({
      runDocument,
      applyOp,
    });
  }),
);
