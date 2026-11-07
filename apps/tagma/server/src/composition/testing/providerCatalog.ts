import { Layer } from 'effect';
import { registryLayer } from '../../providers/registry.js';
import { fixedSources } from '../../providers/testing/registry.js';
import { TESTING_ADAPTERS } from './adapters.js';

export const builtinRegistry = registryLayer.pipe(Layer.provide(fixedSources(TESTING_ADAPTERS)));
