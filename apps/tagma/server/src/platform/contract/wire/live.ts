import { Schema } from 'effect';
import { Rpc, type RpcSchema, RpcSerialization } from 'effect/rpc';
import type { FeedDeclaration } from './operation.js';
import { refusalSchema } from './refusal.js';

type Streamed<F extends FeedDeclaration> = F extends { readonly stream: false } ? false : true;

export type RpcOfFeed<F> = F extends FeedDeclaration
  ? Rpc.Rpc<
      F['id'],
      F['input'],
      Streamed<F> extends true ? RpcSchema.Stream<F['event'], typeof refusalSchema> : F['event'],
      Streamed<F> extends true ? typeof Schema.Never : typeof refusalSchema
    >
  : never;

export const liveSerialization = RpcSerialization.layerJson;

export const RESTARTING_CLOSE = 4301;

export const rpcOf = <const F extends FeedDeclaration>(declared: F): RpcOfFeed<F> =>
  Rpc.make(declared.id, {
    payload: declared.input,
    success: declared.event,
    error: refusalSchema,
    stream: declared.stream ?? true,
  }) as RpcOfFeed<F>;

export type FeedBody = (params: { readonly projectId?: number }, ...rest: readonly unknown[]) => unknown;

export type FeedHandlers<F extends FeedDeclaration, R = never> = {
  readonly [Current in Exclude<F, { readonly performs: string }> as Current['id']]: Rpc.ToHandlerFn<RpcOfFeed<Current>, R>;
};
