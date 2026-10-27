import { expect } from 'bun:test';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { Effect, FileSystem, Layer, Queue, Stream } from 'effect';
import type { FolderFrame } from '../../../checkout-files/contract/wire/scratch.js';
import { makeFolderWatches } from '../../../checkout-files/documents/folders.js';
import { filesChannel } from '../../../checkout-files/feed.js';
import { makeLooseFolders } from '../../../checkout-files/listing/loose.js';
import { watchProcessLayer } from '../fileWatcher.js';

const unread = (what: string) => () => Effect.die(new Error(`the scratch feed reads no ${what}`));

layer(Layer.merge(watchProcessLayer, BunFileSystem.layer), { excludeTestServices: true })('scratch feed', (it) => {
  it.effect(
    "lists a folder of the thread's scratch newest first, cut to the limit with the whole count, follows a write and refuses a folder outside the scratch",
    () =>
      Effect.gen(function* () {
        const files = yield* FileSystem.FileSystem;
        const scratch = yield* files.makeTempDirectoryScoped({ prefix: 'scratch-feed-' });
        const stamped = Effect.fnUntraced(function* (name: string, at: number, text?: string) {
          if (text === undefined) yield* files.makeDirectory(join(scratch, name));
          else yield* files.writeFileString(join(scratch, name), text);
          yield* files.utimes(join(scratch, name), new Date(at), new Date(at));
        });
        yield* stamped('old.md', 1_000, 'old');
        yield* stamped('runs', 2_000);
        yield* stamped('report.md', 3_000, 'report');

        const channel = filesChannel(
          { rootOf: unread('checkout'), placeOf: unread('checkout') },
          { list: unread('directory'), tree: () => Stream.die(new Error('the scratch feed watches no checkout')) },
          { run: () => Stream.die(new Error('the scratch feed searches no content')) },
          {
            subscribe: () => Stream.die(new Error('the scratch feed opens no document')),
            save: unread('document'),
            placeOf: unread('document'),
            subscribeLoose: () => Stream.die(new Error('the scratch feed opens no document')),
            saveLoose: unread('document'),
          },
          yield* makeLooseFolders({ folders: makeFolderWatches() }),
          { of: (thread) => (thread === 'thread-1' ? Effect.succeed(scratch) : Effect.die(new Error(`no scratch for ${thread}`))) },
        );
        const frames = yield* Queue.unbounded<FolderFrame>();
        yield* Effect.forkScoped(
          Stream.runForEach(channel['scratch.subscribe']({ thread: 'thread-1', limit: 2 }), (frame) => Queue.offer(frames, frame)),
        );

        expect(yield* Queue.take(frames)).toEqual({
          directory: scratch,
          total: 3,
          entries: [
            { name: 'report.md', kind: 'file', bytes: 6, modifiedAt: 3_000, mediaType: 'text/markdown' },
            { name: 'runs', kind: 'directory', bytes: expect.any(Number), modifiedAt: 2_000 },
          ],
        });

        yield* files.writeFileString(join(scratch, 'brief.md'), 'brief');
        const written = yield* Queue.take(frames);
        expect([written.total, written.entries.map((entry) => entry.name)]).toEqual([4, ['brief.md', 'report.md']]);

        yield* files.remove(join(scratch, 'brief.md'));
        const removed = yield* Queue.take(frames);
        expect([removed.total, removed.entries.map((entry) => entry.name)]).toEqual([3, ['report.md', 'runs']]);

        const outside = yield* Effect.flip(
          Stream.runHead(channel['scratch.subscribe']({ thread: 'thread-1', path: '../elsewhere', limit: 2 })),
        );
        expect(outside).toMatchObject({ code: 'path-outside-tree' });
      }),
  );
});
