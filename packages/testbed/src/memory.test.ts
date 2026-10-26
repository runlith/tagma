import { layer } from '@runlith/effect-test';
import { scenarios } from './conformance/fileSystem';
import * as Memory from './memory';

layer(Memory.layer, { excludeTestServices: true })('memory FileSystem', (it) => {
  for (const scenario of scenarios) it.effect(scenario.name, () => scenario.effect);
});
