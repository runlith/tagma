import { Effect, Layer } from 'effect';
import type { HttpClient } from 'effect/http';
import { doorExecutorLayer, wireExecutorLayer } from '../llm/route/executor';
import { llmClientLayer } from '../llm/route/client';

export type ModelClient = Effect.Success<ReturnType<typeof openModelClient>>;

export const openModelClient = Effect.fnUntraced(function* (door?: HttpClient.HttpClient) {
  const executor = door === undefined ? wireExecutorLayer : doorExecutorLayer(door);
  return yield* Layer.build(llmClientLayer.pipe(Layer.provideMerge(executor)));
});
