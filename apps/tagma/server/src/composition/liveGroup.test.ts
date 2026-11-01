import { expect, test } from 'bun:test';
import type { Schema } from 'effect';
import { RpcGroup, RpcSchema } from 'effect/rpc';
import type { Manifest } from '../platform/contract/service/manifest.js';
import { liveGroupOf, rpcOf } from '../platform/contract/wire/live.js';
import { CATALOG_MODULES as DEVELOPER_CATALOG } from './developer/catalog.js';
import { CATALOG_MODULES as RELEASE_CATALOG } from './release/catalog.js';
import { MODULES as RELEASE_MODULES } from './release/modules.js';
import { LiveRpc } from './testing/composed.js';

type Declared = { readonly _tag: string; readonly payloadSchema: unknown; readonly successSchema: Schema.Constraint };

const schemasOf = (rpc: Declared) =>
  [rpc.payloadSchema, RpcSchema.isStreamSchema(rpc.successSchema) ? rpc.successSchema.success : rpc.successSchema] as const;

const releaseServed = RpcGroup.make(...RELEASE_MODULES.flatMap((module: Manifest) => module.live?.feeds ?? []).map(rpcOf));

test.each([
  { build: 'developer', declared: liveGroupOf(DEVELOPER_CATALOG), served: LiveRpc },
  { build: 'release', declared: liveGroupOf(RELEASE_CATALOG), served: releaseServed },
])('the $build catalog the app speaks declares every feed its modules serve, over the same schemas', ({ declared, served }) => {
  const declaredRpcs: ReadonlyMap<string, Declared> = declared.requests;
  const servedRpcs: ReadonlyMap<string, Declared> = served.requests;
  expect([...declaredRpcs.keys()].sort()).toEqual([...servedRpcs.keys()].sort());
  for (const [tag, rpc] of servedRpcs) {
    const [payload, success] = schemasOf(rpc);
    const [declaredPayload, declaredSuccess] = schemasOf(declaredRpcs.get(tag)!);
    expect(declaredPayload).toBe(payload);
    expect(declaredSuccess).toBe(success);
  }
});
