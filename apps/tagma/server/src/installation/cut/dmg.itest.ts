import { existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Layer } from 'effect';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { diskImage } from './dmg.js';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'tagma-dmg-')));
const mounted = join(home, 'mounted');
afterAll(() => {
  Bun.spawnSync(['/usr/bin/hdiutil', 'detach', mounted, '-force']);
  rmSync(home, { recursive: true, force: true });
});
const assets = resolve(import.meta.dir, '../../../../desktop/assets');
const spawning = BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));

it.live(
  'the disk image is signed, carries the application beside a link to Applications, the window it opens in and its volume icon, and leaves nothing beside it',
  () =>
    Effect.gen(function* () {
      const bundle = join(home, 'Tagma.app');
      mkdirSync(join(bundle, 'Contents/MacOS'), { recursive: true });
      writeFileSync(join(bundle, 'Contents/MacOS/Electron'), '#!/bin/sh\n');
      const image = join(home, 'Tagma.dmg');

      yield* diskImage(bundle, image, assets, 'Tagma', { identity: '-', timestamp: false }).pipe(Effect.provide(spawning));

      expect(Bun.spawnSync(['/usr/bin/codesign', '--verify', image]).exitCode).toBe(0);
      const attached = Bun.spawnSync(['/usr/bin/hdiutil', 'attach', image, '-nobrowse', '-readonly', '-mountpoint', mounted]);
      expect(attached.exitCode === 0 ? '' : attached.stderr.toString()).toBe('');
      expect(existsSync(join(mounted, 'Tagma.app/Contents/MacOS/Electron'))).toBe(true);
      expect(lstatSync(join(mounted, 'Applications')).isSymbolicLink() && readlinkSync(join(mounted, 'Applications'))).toBe(
        '/Applications',
      );
      for (const part of ['.DS_Store', '.background.tiff', '.VolumeIcon.icns']) expect(existsSync(join(mounted, part))).toBe(true);
      const info = Bun.spawnSync(['/usr/bin/xattr', '-px', 'com.apple.FinderInfo', mounted]).stdout.toString().replace(/\s/gu, '');
      expect(info.slice(16, 20)).toBe('0400');
      expect(existsSync(`${image}.rw.dmg`) || existsSync(`${image}.stage`)).toBe(false);
    }),
);
