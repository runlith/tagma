import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { Effect, FileSystem } from 'effect';
import { Message } from '@runlith/llm/schema/messages';
import { makeThreadAttachments } from './attachments.js';

const PIXEL = new Uint8Array([137, 80, 78, 71]);
const gone = `/api/threads/thread-1/attachments/00000000-0000-7000-8000-000000000000.png`;
const told = (message: Message | undefined): string =>
  message?.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n') ?? '';
const opened = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const root = yield* files.makeTempDirectoryScoped({ prefix: 'thread-attachments-' });
  const store = yield* makeThreadAttachments({ root });
  return { files, root, store };
});

layer(BunFileSystem.layer, { excludeTestServices: true })('thread attachments', (it) => {
  it.effect('bytes return under an id naming their media type and deletion removes them', () =>
    Effect.gen(function* () {
      const { store } = yield* opened;
      const kept = yield* store.keep('thread-1', { mediaType: 'image/png', bytes: PIXEL });
      expect(kept.id).toMatch(/^[0-9a-f-]{36}\.png$/);
      expect(kept.url).toBe(`/api/threads/thread-1/attachments/${kept.id}`);
      const read = yield* store.read('thread-1', kept.id);
      expect(read.mediaType).toBe('image/png');
      expect([...read.bytes]).toEqual([...PIXEL]);
      yield* store.deleteThread('thread-1');
      expect(yield* Effect.flip(store.read('thread-1', kept.id))).toMatchObject({
        _tag: 'ThreadStorageFailed',
        cause: { _tag: 'ThreadAttachmentMissing' },
      });
    }),
  );

  it.effect('an attachment id or thread id escaping its directory is a typed refusal', () =>
    Effect.gen(function* () {
      const { store } = yield* opened;
      const kept = yield* store.keep('thread-1', { mediaType: 'image/png', bytes: PIXEL });
      for (const [thread, id] of [
        ['thread-1', '../../etc/passwd'],
        ['../thread-1', kept.id],
      ] as const) {
        expect(yield* Effect.flip(store.read(thread, id))).toMatchObject({
          _tag: 'ThreadStorageFailed',
          cause: { _tag: 'ThreadAttachmentMissing' },
        });
      }
    }),
  );

  it.effect('a picture hydrates to its bytes and its disk address while a missing picture becomes text', () =>
    Effect.gen(function* () {
      const { files, root, store } = yield* opened;
      const kept = yield* store.keep('thread-1', { mediaType: 'image/png', bytes: PIXEL });
      const [message] = yield* store.hydrate('thread-1', [Message.user([{ type: 'media', mediaType: 'image/png', data: kept.url }])]);
      expect(message?.content.map((part) => part.type)).toEqual(['media', 'text']);
      const path = join(root, 'thread-1', kept.id);
      expect(told(message)).toContain(path);
      expect([...(yield* files.readFile(path))]).toEqual([...PIXEL]);
      const [missing] = yield* store.hydrate('thread-1', [
        Message.user([{ type: 'media', mediaType: 'image/png', data: gone, filename: 'shot.png' }]),
      ]);
      expect(missing?.content.map((part) => part.type)).toEqual(['text']);
      expect(told(missing)).toContain('shot.png');
    }),
  );

  it.effect('a fork reads its own bytes but names the source until that source is deleted', () =>
    Effect.gen(function* () {
      const { root, store } = yield* opened;
      const kept = yield* store.keep('source', { mediaType: 'image/png', bytes: PIXEL });
      yield* store.copyForThread('source', 'fork');
      const inherited = [Message.user([{ type: 'media' as const, mediaType: 'image/png', data: kept.url }])];
      expect(told((yield* store.hydrate('fork', inherited))[0])).toContain(join(root, 'source', kept.id));
      yield* store.deleteThread('source');
      const [own] = yield* store.hydrate('fork', inherited);
      const part = own?.content[0];
      expect(part?.type).toBe('media');
      if (part?.type !== 'media' || !(part.data instanceof Uint8Array)) return yield* Effect.die('the fork picture lost its bytes');
      expect([...part.data]).toEqual([...PIXEL]);
      expect(told(own)).toContain(join(root, 'fork', kept.id));
    }),
  );

  it.effect('a PDF stays under its cleaned filename, reaches the model by path and survives a fork', () =>
    Effect.gen(function* () {
      const { files, root, store } = yield* opened;
      const bytes = new TextEncoder().encode('%PDF-1.4\n%%EOF\n');
      const kept = yield* store.keep('thread-1', { mediaType: 'application/pdf', bytes, name: '../Договор\n№5' });
      const [resolved] = yield* store.resolve('thread-1', 'owner', [{ id: kept.id }]);
      expect([resolved?.mediaType, resolved?.filename, resolved?.text]).toEqual(['application/pdf', 'Договор_№5.pdf', undefined]);
      const path = join(root, 'thread-1', kept.id.replace('.pdf', ''), 'Договор_№5.pdf');
      expect([...(yield* files.readFile(path))]).toEqual([...bytes]);
      const reference = Message.user([{ type: 'media', mediaType: 'application/pdf', data: kept.url, filename: 'Договор_№5.pdf' }]);
      const [message] = yield* store.hydrate('thread-1', [reference]);
      expect(message?.content.map((part) => part.type)).toEqual(['text']);
      expect(told(message)).toContain(path);
      yield* store.copyForThread('thread-1', 'fork');
      yield* store.deleteThread('thread-1');
      expect(told((yield* store.hydrate('fork', [reference]))[0])).toContain(
        join(root, 'fork', kept.id.replace('.pdf', ''), 'Договор_№5.pdf'),
      );
      expect((yield* store.read('fork', kept.id)).name).toBe('Договор_№5.pdf');
    }),
  );

  it.effect('pictures in a tool result hydrate to data URLs and missing ones become text', () =>
    Effect.gen(function* () {
      const { store } = yield* opened;
      const kept = yield* store.keep('thread-1', { mediaType: 'image/png', bytes: PIXEL });
      const history = [
        Message.tool({
          id: 'call-1',
          name: 'read',
          result: {
            type: 'content',
            value: [
              { type: 'text', text: 'two pictures' },
              { type: 'file', uri: kept.url, mime: 'image/png', name: 'kept.png' },
              { type: 'file', uri: gone, mime: 'image/png', name: 'gone.png' },
            ],
          },
        }),
      ];
      const part = (yield* store.hydrate('thread-1', history))[0]?.content[0];
      if (part?.type !== 'tool-result' || part.result.type !== 'content') return yield* Effect.die('the tool result lost its content');
      const [text, picture, missing] = part.result.value;
      expect(text).toEqual({ type: 'text', text: 'two pictures' });
      expect(picture).toMatchObject({
        type: 'file',
        mime: 'image/png',
        uri: `data:image/png;base64,${Buffer.from(PIXEL).toString('base64')}`,
      });
      expect(missing?.type).toBe('text');
    }),
  );

  it.effect('a markdown document carries its heading and text in the recorded reference', () =>
    Effect.gen(function* () {
      const { store } = yield* opened;
      const text = '# Call 14:02\n\nMe: ship it';
      const kept = yield* store.keep('thread-1', { mediaType: 'text/markdown', bytes: new TextEncoder().encode(text) });
      const [resolved] = yield* store.resolve('thread-1', 'owner', [{ id: kept.id }]);
      expect([resolved?.mediaType, resolved?.filename, resolved?.text]).toEqual(['text/markdown', 'Call 14:02', text]);
    }),
  );
});
