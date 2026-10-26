import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { join } from 'node:path';
import { Effect } from 'effect';
import { BINARY_PROBE, bytesDigest } from '@runlith/files/content';
import { createWriteTool } from './write';
import { answer, call, options, prepared, recorder } from './testing/toolHarness';
import { memoryFixture } from './testing/memory';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4f8AAAAASUVORK5CYII=', 'base64');

it.effect('fromFile copies a PNG byte-exact and declares a binary activity with a whole-file change', () =>
  Effect.gen(function* () {
    const { root, files, world } = yield* memoryFixture;
    const source = join(root, 'source.png');
    const destination = join(root, 'copied.png');
    yield* files.writeFile(source, png);
    const sink = recorder();
    const tool = createWriteTool(options({ cwd: root, world, changes: sink.port, comments: () => Effect.succeed('forbid') }));

    const result = yield* answer(tool, { path: destination, fromFile: source });

    expect(yield* files.readFile(destination)).toEqual(new Uint8Array(png));
    expect(result.display).toEqual({ form: 'binary', title: 'copied.png', path: 'copied.png', byteLength: png.byteLength });
    expect(sink.changes).toEqual([
      {
        origin: 'write',
        path: yield* files.realPath(destination),
        at: expect.any(Date),
        before: bytesDigest(new Uint8Array()),
        after: bytesDigest(png),
      },
    ]);

    const replacement = Buffer.from([0xff, 0xfe, 0]);
    yield* files.writeFile(source, replacement);
    const overwritten = yield* answer(tool, { path: destination, fromFile: source });
    expect(yield* files.readFile(destination)).toEqual(new Uint8Array(replacement));
    expect(overwritten.display).toMatchObject({ form: 'binary', byteLength: replacement.byteLength });
    expect(sink.changes[1]).toEqual({
      origin: 'write',
      path: yield* files.realPath(destination),
      at: expect.any(Date),
      before: bytesDigest(png),
      after: bytesDigest(replacement),
    });
  }),
);

it.effect('content with a late NUL is written as bytes without comment rewriting or line attribution', () =>
  Effect.gen(function* () {
    const { root, files, world } = yield* memoryFixture;
    const destination = join(root, 'payload.ts');
    const content = `${'x'.repeat(BINARY_PROBE)}\0// held bytes\n`;
    const bytes = Buffer.from(content, 'utf8');
    const sink = recorder();
    const tool = createWriteTool(options({ cwd: root, world, changes: sink.port, comments: () => Effect.succeed('forbid') }));

    const result = yield* answer(tool, { path: destination, content });

    expect(yield* files.readFile(destination)).toEqual(new Uint8Array(bytes));
    expect(result.display).toMatchObject({ form: 'binary', path: 'payload.ts', byteLength: bytes.byteLength });
    expect(sink.changes[0]).toEqual({
      origin: 'write',
      path: yield* files.realPath(destination),
      at: expect.any(Date),
      before: bytesDigest(new Uint8Array()),
      after: bytesDigest(bytes),
    });
  }),
);

it.effect('fromFile compares raw source bytes at execution and refuses a changed undecodable source', () =>
  Effect.gen(function* () {
    const { root, files, world } = yield* memoryFixture;
    const source = join(root, 'source.dat');
    const destination = join(root, 'copy.dat');
    yield* files.writeFile(source, Buffer.from([0xff]));
    const tool = createWriteTool(options({ cwd: root, world }));
    const input = { path: destination, fromFile: source };
    const preparation = yield* prepared(tool, input);
    yield* files.writeFile(source, Buffer.from([0xfe]));

    const result = yield* call(tool, input, preparation);

    expect(result).toContain('holds different bytes');
    expect(yield* files.exists(destination)).toBe(false);
  }),
);

it.effect('fromFile retains UTF-8 BOM and CRLF bytes when replacing a binary file with text', () =>
  Effect.gen(function* () {
    const { root, files, world } = yield* memoryFixture;
    const source = join(root, 'source.txt');
    const destination = join(root, 'copy.txt');
    const text = Buffer.from('\uFEFFone\r\ntwo\r\n');
    yield* files.writeFile(source, text);
    yield* files.writeFile(destination, png);
    const sink = recorder();
    const tool = createWriteTool(options({ cwd: root, world, changes: sink.port }));

    const result = yield* answer(tool, { path: destination, fromFile: source });

    expect(yield* files.readFile(destination)).toEqual(new Uint8Array(text));
    expect(result.display).toMatchObject({ form: 'code', text: '\uFEFFone\r\ntwo\r\n' });
    expect(sink.changes[0]).toEqual({
      origin: 'write',
      path: yield* files.realPath(destination),
      at: expect.any(Date),
      before: bytesDigest(png),
      after: bytesDigest(text),
    });
  }),
);
