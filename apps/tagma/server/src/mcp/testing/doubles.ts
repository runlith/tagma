import { Effect, Layer } from 'effect';
import { McpPlaces } from '../contract/service/places.js';
import { mcpServersLayer as mcpServersLayerFn } from '../serverPool.js';

export const fixedMcpPlaces = (places: readonly string[] = []) =>
  Layer.succeed(McpPlaces, McpPlaces.of({ of: () => Effect.succeed(places), onMoved: () => () => undefined }));

export const mcpServersLayer = (environment: Readonly<Record<string, string | undefined>>, places: readonly string[] = []) =>
  mcpServersLayerFn(environment).pipe(Layer.provide(fixedMcpPlaces(places)));
