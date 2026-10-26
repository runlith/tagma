import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Context, Effect, Layer } from 'effect';
import { kind, shared } from '@runlith/testbed/worlds';
import { FileWatcher } from '../../platform/contract/service/watch.js';
import { makeFileWatcher } from '../fileWatcher.js';

export const watchProcessAt = (dir: string) => makeFileWatcher({ dir, lifetime: 'with-client' });

class WatchWorld extends Context.Service<WatchWorld, FileWatcher['Service']>()('testing/WatchWorld') {}

const watchWorld = kind(WatchWorld, (_params: null, home: string) =>
  Effect.flatMap(
    Effect.promise(() => mkdir(join(home, 'watch'), { recursive: true })),
    () => watchProcessAt(join(home, 'watch')),
  ),
);

export const watchProcessLayer: Layer.Layer<FileWatcher> = Layer.effect(FileWatcher, shared(watchWorld, null));
