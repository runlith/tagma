import { Layer } from 'effect';
import { BuiltinAdapters } from '../../providers/contract/service/registry.js';
import { registryLayer } from '../../providers/registry.js';
import { TESTING_ADAPTERS } from './adapters.js';

export const builtinRegistry = registryLayer.pipe(Layer.provide(Layer.succeed(BuiltinAdapters, { sources: TESTING_ADAPTERS })));
