import { expect } from 'bun:test';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { PREVIEW_BYTES } from '../../../checkout-files/contract/wire/place.js';
import { ScratchAreas } from '../../../threads/contract/service/scratch.js';
import { DoorFixture, doorFixture, projectLeaving } from '../doorFixture.js';

layer(doorFixture().pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })('file preview door', (it) => {
  it.effect('the operator resolves and reads files outside the checkout without granting writes', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const files = yield* FileSystem.FileSystem;
      const checkout = yield* world.directory('checkout');
      const project = yield* world.stealthProject(checkout);
      yield* projectLeaving(world, project);
      const outside = yield* world.directory('outside');
      const path = join(outside, 'report one.md');
      const text = '# Report\n\nThe child report.';
      yield* files.writeFileString(path, text);
      const located = yield* world.op('place_path', { path }, `project=${project}`);
      expect(located.status).toBe(200);
      expect(located.body).toMatchObject({ entry: { kind: 'file', path, bytes: Buffer.byteLength(text) }, place: null });
      const migrations = join(checkout, 'migrations');
      yield* files.makeDirectory(migrations);
      const placedAt = (asked: string) =>
        Effect.map(world.op('place_path', { path: asked }, `project=${project}`), (answer) => answer.body);
      expect(yield* placedAt(migrations)).toMatchObject({
        entry: { kind: 'directory', path: migrations },
        place: { projectId: project, path: 'migrations' },
      });
      expect(yield* placedAt(outside)).toMatchObject({ entry: { kind: 'directory', path: outside }, place: null });
      expect(yield* placedAt(join(outside, 'absent'))).toMatchObject({ entry: null, place: null });
      const read = (file: string, full = false) =>
        Effect.promise(() =>
          world.app(
            new Request(`http://tagma/api/files/preview?${new URLSearchParams({ path: file, ...(full ? { full: 'true' } : {}) })}`),
            world.routed,
          ),
        );
      const response = yield* read(path);
      expect({ status: response.status, body: yield* Effect.promise(() => response.text()) }).toEqual({ status: 200, body: text });
      expect(response.headers.get('content-security-policy')).toContain('sandbox');
      expect((yield* read(join(outside, 'absent.md'))).status).toBe(404);
      expect((yield* read(outside)).status).toBe(404);
      const linked = join(checkout, 'linked.md');
      yield* files.symlink(path, linked);
      const linkedPlace = yield* world.op('place_path', { path: linked }, `project=${project}`);
      expect(linkedPlace.body).toMatchObject({ entry: { kind: 'file', path: linked }, place: { path: 'linked.md' } });
      expect(yield* Effect.flatMap(read(linked), (answer) => Effect.promise(() => answer.text()))).toBe(text);

      const image = join(outside, 'picture.png');
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4WQAAAAASUVORK5CYII=', 'base64');
      yield* files.writeFile(image, png);
      const picture = yield* read(image);
      expect(picture.headers.get('content-type')).toBe('image/png');
      expect(new Uint8Array(yield* Effect.promise(() => picture.arrayBuffer()))).toEqual(new Uint8Array(png));

      const long = 'x'.repeat(PREVIEW_BYTES + 1);
      yield* files.writeFileString(path, long);
      const sized = (full: boolean) => Effect.flatMap(read(path, full), (answer) => Effect.promise(() => answer.arrayBuffer()));
      expect((yield* sized(false)).byteLength).toBe(PREVIEW_BYTES);
      expect((yield* sized(true)).byteLength).toBe(long.length);
    }),
  );

  it.effect("a bare name an agent left in its thread's scratch resolves from that thread only where nothing stands in the checkout", () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const files = yield* FileSystem.FileSystem;
      const checkout = yield* world.directory('checkout');
      const project = yield* world.stealthProject(checkout);
      yield* projectLeaving(world, project);
      const areas = Context.get(world.runtime.door, ScratchAreas);
      const thread = crypto.randomUUID();
      const scratch = yield* areas.ensure(thread);
      yield* Effect.addFinalizer(() => areas.release(thread));
      yield* files.writeFileString(join(scratch, 'report.md'), '# Scratch');
      const placed = (input: { readonly path: string; readonly thread?: string }) =>
        Effect.map(world.op('place_path', { ...input, from: checkout }, `project=${project}`), (answer) => answer.body);

      expect(yield* placed({ path: 'report.md', thread })).toMatchObject({
        entry: { kind: 'file', path: join(scratch, 'report.md') },
        place: null,
      });
      expect(yield* placed({ path: 'report.md' })).toMatchObject({ entry: null, place: null });
      yield* files.writeFileString(join(checkout, 'report.md'), '# Checkout');
      expect(yield* placed({ path: 'report.md', thread })).toMatchObject({
        entry: { kind: 'file', path: join(checkout, 'report.md') },
        place: { projectId: project, path: 'report.md' },
      });
    }),
  );
});
