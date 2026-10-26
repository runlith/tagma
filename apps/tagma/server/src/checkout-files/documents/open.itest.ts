import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { symlink } from 'node:fs/promises';
import { Deferred, Effect, Stream } from 'effect';
import { applyLineEdits } from '@runlith/files/lines';
import { bytesDigest } from '@runlith/files/content';
import type { DocumentFrame } from '../contract/wire/document.js';
import { feeding, filesWorld, worldLayers } from '../testing/world.js';

const replay = (text: string, frame: DocumentFrame): string => {
  if (frame.kind === 'whole') return frame.text;
  if (frame.kind !== 'change') return text;
  const rebuilt = applyLineEdits(text, frame.edits);
  return rebuilt._tag === 'Success' ? rebuilt.success : text;
};

it.live('a document normalizes text and deltas, and reports binary, missing and undecodable files without losing its mode', () =>
  Effect.gen(function* () {
    const { place, documents, write, files, paths, root } = yield* filesWorld;
    yield* write('notes.txt', 'one\r\ntwo\r\n');
    const frames = yield* feeding(documents.subscribe(place, 'notes.txt'));
    expect(yield* frames.next).toEqual({
      kind: 'whole',
      digest: bytesDigest(new TextEncoder().encode('one\r\ntwo\r\n')),
      text: 'one\ntwo\n',
      readOnly: null,
      size: 10,
    });
    yield* write('notes.txt', 'one\r\nTWO\r\nthree\r\n');
    const changed = yield* frames.until((frame) => frame.kind !== 'whole');
    expect(changed.kind).toBe('change');
    expect(replay('one\ntwo\n', changed)).toBe('one\nTWO\nthree\n');
    yield* files.writeFile(paths.join(root, 'notes.txt'), new Uint8Array([0, 1, 2, 3]));
    expect((yield* frames.until((frame) => frame.kind !== 'change')).kind).toBe('binary');
    yield* files.remove(paths.join(root, 'notes.txt'));
    expect((yield* frames.until((frame) => frame.kind !== 'binary')).kind).toBe('gone');
    yield* files.makeDirectory(paths.join(root, 'folder'));
    expect((yield* (yield* feeding(documents.subscribe(place, 'folder'))).next).kind).toBe('unreadable');
    yield* write('mode.txt', 'caf\u00e9\n');
    const mode = yield* feeding(documents.subscribe(place, 'mode.txt'));
    expect(yield* mode.next).toMatchObject({ kind: 'whole', readOnly: null, text: 'caf\u00e9\n' });
    yield* files.writeFile(paths.join(root, 'mode.txt'), Uint8Array.from([0xef, 0xbb, 0xbf, 0x63, 0x61, 0x66, 0xe9, 0x0a]));
    const odd = yield* mode.until((frame) => frame.kind !== 'whole' || frame.readOnly !== null);
    expect(odd).toMatchObject({ kind: 'whole', readOnly: 'undecodable' });
    expect(odd.kind === 'whole' && odd.text.startsWith('\uFEFF')).toBe(false);
  }).pipe(Effect.provide(worldLayers)),
);

it.live('a document opened through a symlink follows its target, and both paths share what the target does', () =>
  Effect.gen(function* () {
    const { place, documents, write, paths, root } = yield* filesWorld;
    yield* write('real/target.txt', 'a\n');
    yield* Effect.promise(() => symlink('real/target.txt', paths.join(root, 'link.txt')));
    const viaLink = yield* feeding(documents.subscribe(place, 'link.txt'));
    const direct = yield* feeding(documents.subscribe(place, 'real/target.txt'));
    expect(yield* viaLink.next).toMatchObject({ kind: 'whole', text: 'a\n' });
    expect(yield* direct.next).toMatchObject({ kind: 'whole', text: 'a\n' });
    yield* write('real/target.txt', 'a\nb\n');
    const seenViaLink = yield* viaLink.until((frame) => frame.kind !== 'whole');
    const seenDirect = yield* direct.until((frame) => frame.kind !== 'whole');
    expect(replay('a\n', seenViaLink)).toBe('a\nb\n');
    expect(replay('a\n', seenDirect)).toBe('a\nb\n');
  }).pipe(Effect.provide(worldLayers)),
);

it.live('an event on one path refreshes that path alone among open documents', () =>
  Effect.gen(function* () {
    const { place, documents, write, statted } = yield* filesWorld;
    const open = ['docs/first.txt', 'docs/second.txt'];
    for (const path of open) yield* write(path, `${path}\n`);
    const feeds = yield* Effect.forEach(open, (path) => feeding(documents.subscribe(place, path)));
    yield* Effect.forEach(feeds, (feed) => feed.next);
    const before = statted.length;
    yield* write('docs/second.txt', 'docs/second.txt\nmore\n');
    expect((yield* feeds[1]!.until((frame) => frame.kind !== 'whole')).kind).toBe('change');
    expect(new Set(statted.slice(before))).toEqual(new Set([`${place.path}/docs/second.txt`]));
  }).pipe(Effect.provide(worldLayers)),
);

it.live('a subscriber that falls behind receives a whole file instead of its backlog, and replay still yields the file', () =>
  Effect.gen(function* () {
    const { place, documents, write } = yield* filesWorld;
    yield* write('busy.txt', 'start\n');
    const probe = yield* feeding(documents.subscribe(place, 'busy.txt'));
    yield* probe.next;
    const gate = yield* Deferred.make<void>();
    let passed = 0;
    const slow = yield* feeding(
      documents
        .subscribe(place, 'busy.txt')
        .pipe(Stream.mapEffect((frame) => (passed++ < 1 ? Effect.succeed(frame) : Effect.as(Deferred.await(gate), frame)))),
    );
    const got: DocumentFrame[] = [yield* slow.next];
    const writes = 34;
    let text = 'start\n';
    for (let at = 0; at < writes; at += 1) {
      text += `line ${at}\n`;
      yield* write('busy.txt', text);
      yield* probe.until((frame) => frame.kind === 'change');
    }
    yield* Deferred.succeed(gate, undefined);
    while (got.reduce(replay, '') !== text) got.push(yield* slow.next);
    expect(got.length).toBeLessThan(writes);
    expect(got.slice(1).some((frame) => frame.kind === 'whole')).toBe(true);
  }).pipe(Effect.provide(worldLayers)),
);
