import { Layer, Stream } from 'effect';
import { SourceChanges } from '../contract/service/changes.js';
import { checkoutBuildsLayer as checkoutBuildsLayerFn } from '../runner.js';

export const checkoutBuildsLayer = (...input: Parameters<typeof checkoutBuildsLayerFn>) =>
  checkoutBuildsLayerFn(...input).pipe(Layer.provide(Layer.succeed(SourceChanges, { watch: () => Stream.never })));
