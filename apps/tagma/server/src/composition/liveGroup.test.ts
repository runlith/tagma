import { expect, test } from 'bun:test';
import type { Schema } from 'effect';
import { RpcSchema } from 'effect/rpc';
import { LiveRpc } from './testing/composed.js';

const APP_GROUP = new URL('../../../app/src/lib/wire/liveGroup.ts', import.meta.url).href;

type Declared = { readonly _tag: string; readonly payloadSchema: unknown; readonly successSchema: Schema.Constraint };

const schemasOf = (rpc: Declared) =>
  [rpc.payloadSchema, RpcSchema.isStreamSchema(rpc.successSchema) ? rpc.successSchema.success : rpc.successSchema] as const;

test('the app speaks every verb the modules declare, over the same schemas', async () => {
  const used: { readonly requests: ReadonlyMap<string, Declared> } = (await import(APP_GROUP)).LiveRpc;
  const served: ReadonlyMap<string, Declared> = LiveRpc.requests;
  expect([...used.requests.keys()].sort()).toEqual([...served.keys()].sort());
  for (const [tag, rpc] of served) {
    const [payload, success] = schemasOf(rpc);
    const [usedPayload, usedSuccess] = schemasOf(used.requests.get(tag)!);
    expect(usedPayload).toBe(payload);
    expect(usedSuccess).toBe(success);
  }
});
