import { Layer } from 'effect';
import { AdapterSources } from '../../providers/contract/service/registry.js';
import { registryLayer } from '../../providers/registry.js';
import { fixedSources } from '../../providers/testing/registry.js';
import { TESTING_ADAPTERS } from './adapters.js';

export const builtinRegistry = registryLayer.pipe(Layer.provide(Layer.succeed(AdapterSources, fixedSources(TESTING_ADAPTERS))));
