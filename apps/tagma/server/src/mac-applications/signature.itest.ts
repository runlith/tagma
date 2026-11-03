import { copyFileSync, cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { RELEASE_INSIDE } from '../installation/contract/wire/layout.js';
import { signatureRefusal } from './placement.js';

const carriedRelease = (bundle: string): string => join(bundle, RELEASE_INSIDE);

const home = realpathSync(mkdtempSync(join(tmpdir(), 'tagma-signature-')));
afterAll(() => rmSync(home, { recursive: true, force: true }));
const root = join(home, '.tagma/install');

const bundle = (at: string, build: string, signed: boolean): string => {
  mkdirSync(join(at, 'Contents/MacOS'), { recursive: true });
  copyFileSync('/usr/bin/true', join(at, 'Contents/MacOS/Electron'));
  writeFileSync(
    join(at, 'Contents/Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>Electron</string><key>CFBundleIdentifier</key><string>com.runlith.tagma.${build}</string></dict></plist>`,
  );
  mkdirSync(carriedRelease(at), { recursive: true });
  writeFileSync(
    join(carriedRelease(at), 'install.json'),
    JSON.stringify({
      version: 1,
      identity: { digest: `sha256:${build.padEnd(64, '0')}`, build },
      platform: { os: 'darwin', arch: 'arm64' },
      parts: [{ role: 'runtime', path: 'bun', kind: 'file', bytes: 1, digest: `sha256:${'b'.repeat(64)}` }],
    }),
  );
  if (signed && Bun.spawnSync(['/usr/bin/codesign', '--force', '-s', '-', at]).exitCode !== 0) throw new Error(`${at} could not be signed`);
  return at;
};

const refusal = (at: string) => signatureRefusal(carriedRelease(at), root);

it.live(
  'a downloaded application is refused unless its signature verifies and names the identity of the application the current release keeps',
  () =>
    Effect.gen(function* () {
      const standing = bundle(join(root, 'v1/desktop/Tagma.app'), '1', true);
      symlinkSync('v1', join(root, 'current'));
      const same = join(home, 'copy/Tagma.app');
      cpSync(standing, same, { recursive: true, verbatimSymlinks: true });

      expect(yield* refusal(same)).toBeNull();
      expect(yield* refusal(bundle(join(home, 'unsigned/Tagma.app'), '2', false))).toContain('carries no valid signature');
      expect(yield* refusal(bundle(join(home, 'other/Tagma.app'), '3', true))).toContain('is signed as');
    }),
);
