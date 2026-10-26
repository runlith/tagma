import { Layer } from 'effect';
import { Configs } from './contract/service/configs.js';
import { makeConfigs } from './reading.js';

export const configsLayer = Layer.effect(Configs, makeConfigs);
