import { expect, test } from 'bun:test';
import type { Schema } from 'effect';
import { RpcSchema } from 'effect/rpc';
import { liveGroupOf } from '../platform/contract/wire/live.js';
import { CATALOG_MODULES } from './developer/catalog.js';
import { LiveRpc } from './testing/composed.js';

type Declared = { readonly _tag: string; readonly payloadSchema: unknown; readonly successSchema: Schema.Constraint };

const schemasOf = (rpc: Declared) =>
  [rpc.payloadSchema, RpcSchema.isStreamSchema(rpc.successSchema) ? rpc.successSchema.success : rpc.successSchema] as const;

test('the catalog the app speaks declares every feed the modules serve, over the same schemas', () => {
  const declared: ReadonlyMap<string, Declared> = liveGroupOf(CATALOG_MODULES).requests;
  const served: ReadonlyMap<string, Declared> = LiveRpc.requests;
  expect([...declared.keys()].sort()).toEqual([...served.keys()].sort());
  for (const [tag, rpc] of served) {
    const [payload, success] = schemasOf(rpc);
    const [declaredPayload, declaredSuccess] = schemasOf(declared.get(tag)!);
    expect(declaredPayload).toBe(payload);
    expect(declaredSuccess).toBe(success);
  }
});
