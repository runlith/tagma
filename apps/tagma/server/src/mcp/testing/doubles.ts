import { Effect, Layer, Stream } from 'effect';
import { memorySecretsLayer } from '../../secrets/testing/doubles.js';
import { McpContributions } from '../contract/service/contributions.js';
import { McpPlaces } from '../contract/service/places.js';
import { mcpServersLayer as mcpServersLayerFn } from '../serverPool.js';

export const fixedMcpPlaces = (places: readonly string[] = []) =>
  Layer.succeed(McpPlaces, McpPlaces.of({ of: () => Effect.succeed(places), onMoved: () => () => undefined }));

export const noMcpContributions = Layer.succeed(
  McpContributions,
  McpContributions.of({ of: () => Effect.succeed([]), changes: Stream.never }),
);

export const mcpServersLayer = (environment: Readonly<Record<string, string | undefined>>, places: readonly string[] = []) =>
  mcpServersLayerFn(environment).pipe(
    Layer.provide(fixedMcpPlaces(places)),
    Layer.provide(noMcpContributions),
    Layer.provideMerge(memorySecretsLayer()),
  );
