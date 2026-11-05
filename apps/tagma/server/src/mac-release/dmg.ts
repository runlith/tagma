import { copyFileSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { Effect } from 'effect';
import type { ChildProcessSpawner } from 'effect/process';
import { type Signing, signCode } from '@runlith/codesign/codesign';
import { cloneTree } from '../platform/durable/clone.js';
import { output } from '../cut/command.js';

const HAS_CUSTOM_ICON = `${'0'.repeat(16)}0400${'0'.repeat(44)}`;

const ran = (command: string, args: readonly string[], cwd: string): Effect.Effect<void, string, ChildProcessSpawner.ChildProcessSpawner> =>
  output(command, args, cwd, {}).pipe(
    Effect.mapError((failure) => failure.detail),
    Effect.flatMap((answer) =>
      answer.status === 0 ? Effect.void : Effect.fail(`${basename(command)} ${args[0]} exited ${answer.status}: ${answer.text.trim()}`),
    ),
  );

export const diskImage = Effect.fn('installation.diskImage')(
  function* (bundle: string, image: string, assets: string, volume: string, signing: Signing) {
    const stage = `${image}.stage`;
    const writable = `${image}.rw.dmg`;
    const mounted = `${image}.mount`;
    yield* Effect.try({
      try: () => {
        for (const path of [stage, writable, mounted, image]) rmSync(path, { recursive: true, force: true });
        mkdirSync(stage, { recursive: true });
        symlinkSync('/Applications', join(stage, 'Applications'));
        copyFileSync(join(assets, 'dmg-background.tiff'), join(stage, '.background.tiff'));
        copyFileSync(join(assets, 'dmg-window.DS_Store'), join(stage, '.DS_Store'));
        copyFileSync(join(assets, 'Tagma.icns'), join(stage, '.VolumeIcon.icns'));
      },
      catch: (cause) => `the disk image could not be staged in ${stage}: ${String(cause)}`,
    });
    const at = dirname(image);
    yield* cloneTree(bundle, join(stage, basename(bundle))).pipe(Effect.mapError((failure) => failure.message));
    yield* ran(
      '/usr/bin/hdiutil',
      ['create', '-volname', volume, '-srcfolder', stage, '-fs', 'HFS+', '-format', 'UDRW', '-ov', writable],
      at,
    );
    yield* Effect.acquireUseRelease(
      ran('/usr/bin/hdiutil', ['attach', writable, '-nobrowse', '-noverify', '-noautoopen', '-mountpoint', mounted], at),
      () => ran('/usr/bin/xattr', ['-wx', 'com.apple.FinderInfo', HAS_CUSTOM_ICON, mounted], at),
      () => Effect.orDie(ran('/usr/bin/hdiutil', ['detach', mounted, '-force'], at)),
    );
    yield* ran('/usr/bin/hdiutil', ['convert', writable, '-format', 'UDZO', '-imagekey', 'zlib-level=9', '-o', image], at);
    const signed = signCode(image, signing);
    if (signed._tag === 'Refused') return yield* Effect.fail(`${basename(image)} could not be signed: ${signed.detail}`);
  },
  (effect, bundle, image, assets, volume, signing) =>
    effect.pipe(
      Effect.ensuring(
        Effect.sync(() => {
          for (const path of [`${image}.stage`, `${image}.rw.dmg`, `${image}.mount`]) rmSync(path, { recursive: true, force: true });
        }),
      ),
    ),
);
