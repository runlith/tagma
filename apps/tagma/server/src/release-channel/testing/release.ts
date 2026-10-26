import { createHash } from 'node:crypto';
import { chmodSync, cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Effect, FileSystem } from 'effect';
import { partsAt } from '../../installation/closure/read.js';
import { writeInstallation } from '../../installation/closure/write.js';
import type { Applications } from '../../installation/contract/service/applications.js';
import { RELEASE_INSIDE } from '../../installation/contract/wire/layout.js';
import { type InstallationPlatform, type InstallationRole, type IrreversibleChange } from '../../installation/contract/wire/manifest.js';
import { EXECUTIONS_RUNTIME } from '../../installation/contract/wire/archive.js';

const ENTRY = fileURLToPath(new URL('./entry.ts', import.meta.url));

const LAYOUT: ReadonlyArray<readonly [InstallationRole, string]> = [
  ['runtime', 'bun'],
  ['cli', 'bin/cli'],
  ['server', 'bin/server'],
  ['migrations', 'drizzle'],
  ['surface', 'surface'],
  ['executions', 'executions'],
];

const written = (dir: string, path: string, text: string, mode = 0o600): void => {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), text);
  chmodSync(join(dir, path), mode);
};

export const carriedIn = (bundle: string): string => join(bundle, RELEASE_INSIDE);

export const signedBundle = (bundle: string): void => {
  written(
    bundle,
    'Contents/Info.plist',
    `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>Electron</string><key>CFBundleIdentifier</key><string>com.runlith.tagma.synthetic</string></dict></plist>`,
  );
  const signed = Bun.spawnSync(['/usr/bin/codesign', '--force', '--deep', '-s', '-', bundle]);
  if (signed.exitCode !== 0) throw new Error(`${bundle} could not be signed: ${signed.stderr.toString()}`);
};

export type SyntheticRuntime = { readonly platform: InstallationPlatform; readonly executable: string };

export const syntheticReleaseEffect = Effect.fn('releaseFixture.build')(function* (
  bundle: string,
  build: string,
  irreversible?: ReadonlyArray<IrreversibleChange>,
  runtime: SyntheticRuntime = { platform: { os: process.platform, arch: process.arch }, executable: process.execPath },
) {
  const files = yield* FileSystem.FileSystem;
  const dir = carriedIn(bundle);
  const write = Effect.fn('releaseFixture.write')(function* (path: string, text: string, mode = 0o600) {
    yield* files.makeDirectory(dirname(path), { recursive: true });
    yield* files.writeFileString(path, text);
    yield* files.chmod(path, mode);
  });
  yield* write(join(bundle, 'Contents/MacOS/Electron'), '#!/bin/sh\n', 0o700);
  yield* write(join(dir, 'bun'), `#!/bin/sh\nexec '${runtime.executable}' "$@"\n`, 0o700);
  yield* write(join(dir, 'bin/cli/main.js'), `await import(${JSON.stringify(ENTRY)});\n`);
  yield* write(join(dir, 'bin/server/http.js'), `export const build = ${JSON.stringify(build)};\n`);
  yield* write(join(dir, 'drizzle/0000_base.sql'), 'select 1;\n');
  yield* write(join(dir, 'surface/index.html'), `<p>${build}</p>\n`);
  yield* write(join(dir, 'executions/artifact.json'), '{}\n');
  yield* files.copyFile(join(dir, 'bun'), join(dir, EXECUTIONS_RUNTIME));
  const parts = yield* Effect.forEach(LAYOUT, ([role, path]) => partsAt(dir, role, path));
  const manifest = yield* writeInstallation(dir, runtime.platform, build, parts.flat(), undefined, undefined, irreversible);
  yield* files.remove(join(dir, EXECUTIONS_RUNTIME));
  return manifest;
});

export const trustedApplications: Applications = {
  carrier: (dir) => (dir.endsWith(`.app/${RELEASE_INSIDE}`) ? dir.slice(0, -RELEASE_INSIDE.length - 1) : null),
  carried: (dir) => {
    const bundles = readdirSync(dir).filter((name) => name.endsWith('.app'));
    return bundles.length === 1 ? carriedIn(join(dir, bundles[0]!)) : null;
  },
  verify: async () => null,
  copy: async (bundle, to) => {
    rmSync(to, { recursive: true, force: true });
    mkdirSync(dirname(to), { recursive: true });
    cpSync(bundle, to, { recursive: true, verbatimSymlinks: true });
  },
  unquarantine: async () => null,
  clearPlace: () => undefined,
  forget: () => undefined,
  signature: async () => null,
};

export type Packed = { readonly file: string; readonly sha256: string; readonly size: number };

export const packRelease = (bundle: string, file: string): Packed => {
  const packed = Bun.spawnSync(['/usr/bin/tar', '-czf', file, '-C', dirname(bundle), basename(bundle)], {
    env: { ...process.env, COPYFILE_DISABLE: '1' },
  });
  if (packed.exitCode !== 0) throw new Error(`tar left with ${packed.exitCode}: ${packed.stderr.toString()}`);
  const bytes = readFileSync(file);
  return { file, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
};
