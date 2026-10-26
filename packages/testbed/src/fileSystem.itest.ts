import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { scenarios } from './conformance/fileSystem';

layer(BunFileSystem.layer, { excludeTestServices: true })('host FileSystem', (it) => {
  for (const scenario of scenarios) it.effect(scenario.name, () => scenario.effect);
});
