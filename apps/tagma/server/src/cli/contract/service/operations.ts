import type { Effect, Schema } from 'effect';
import type { Flag } from 'effect/cli';
import type { OperationRegistry } from '../../../invocation/contract/service/registry.js';
import type { Invocation } from '../../../platform/cli/verb.js';
import type { McpToolShape, SessionRef } from '../../../platform/contract/wire/session.js';
import type { Operation } from '../../../platform/contract/wire/operation.js';

export type JsonObjectSchema = Readonly<Record<string, unknown>> & { readonly type: 'object' };

export type BridgedHarness = {
  readonly harness: string;
  readonly variable?: string | undefined;
  readonly mcpTools: McpToolShape;
  readonly mcpCallMeta?: string;
};

type Lens = { readonly cwd?: string; readonly project?: string; readonly scope?: string };

type Performed = {
  readonly params: { readonly id: string };
  readonly query: Lens;
  readonly headers: Record<string, string | number | undefined>;
  readonly payload: unknown;
};

export type VerbsDoor = {
  readonly operations: {
    perform(
      request: Performed & { readonly responseMode: 'decoded-and-response' },
    ): Effect.Effect<readonly [unknown, { readonly headers: Readonly<Record<string, string | undefined>> }], unknown>;
    perform(request: Performed): Effect.Effect<unknown, unknown>;
  };
};

export type OperationsCli<Id extends string, Harness extends string> = {
  readonly registry: OperationRegistry<Id>;
  readonly inputSchema: (schema: Schema.Top) => JsonObjectSchema;
  readonly operationSchema: (entry: Operation) => JsonObjectSchema;
  readonly blockRefFlag: (name: string) => Flag.Flag<string>;
  readonly version: string;
  readonly harnesses: readonly [Harness, ...Harness[]];
  readonly harness: (name: Harness) => BridgedHarness;
  readonly ask: <A>(call: (door: VerbsDoor, at: Invocation) => Effect.Effect<A, unknown>) => Effect.Effect<A, unknown>;
  readonly baseUrl: (at: Invocation) => string;
  readonly declareBridge: (at: Invocation, declared: SessionRef) => void;
};
