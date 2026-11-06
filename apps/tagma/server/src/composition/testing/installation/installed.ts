import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { gitLayer } from '@runlith/git/Git';
import { Effect, Layer } from 'effect';
import { type ReleaseLanded, releaseInstallation } from '../../../cut/release.js';
import { inertPlatform } from '../../../cut/testing/platform.js';
import { partsAt } from '../../../installation/closure/read.js';
import { writeInstallation } from '../../../installation/closure/write.js';
import type { Channel } from '../../../installation/contract/wire/channel.js';
import { MIGRATIONS } from '../../../installation/contract/wire/manifest.js';
import { testProcesses } from '../../../installation/testing/processes.js';
import { hostBinary, hostBundle } from '../../../mac-applications/bundle.js';
import { openVersion } from '../../../platform/lock/versionedDirectories.js';
import { DEVELOPER } from '../../developer/build.js';

const spawning = BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));
const machine = Layer.mergeAll(BunFileSystem.layer, spawning, gitLayer.pipe(Layer.provide(spawning)));

export const LEAVING_MIGRATION = '29991231000000_only_the_leaving_build';
const LEAVING_SQL =
  'ALTER TABLE `meta` ADD `only_leaving` text;--> statement-breakpoint\nCREATE TABLE `only_leaving` (`id` integer PRIMARY KEY);';

const PLIST = `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>Electron</string><key>CFBundleIdentifier</key><string>dev.tagma.installed-world</string></dict></plist>`;

const wrote = (path: string, text: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

const hostScript = (bundle: string): string => `import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
const app = process.env.TAGMA_HOST_OUT + '/' + ${JSON.stringify(bundle)};
mkdirSync(app + '/Contents/MacOS', { recursive: true });
writeFileSync(app + '/Contents/MacOS/Electron', '#!/bin/sh\\n');
chmodSync(app + '/Contents/MacOS/Electron', 0o755);
writeFileSync(app + '/Contents/Info.plist', ${JSON.stringify(PLIST)});
`;

export const checkoutInstalled = Effect.fn('installedWorld.checkout')(function* (root: string, channel: Channel, build?: string) {
  const desktop = join(root, 'desktop');
  const app = join(root, 'app');
  wrote(join(desktop, 'package.json'), '{"name":"@tagma/desktop"}\n');
  wrote(join(desktop, 'scripts/build-host.ts'), hostScript(hostBundle(channel.name)));
  wrote(
    join(app, 'package.json'),
    '{"name":"@tagma/app","scripts":{"build":"mkdir -p \\"$TAGMA_SURFACE_OUT\\" && echo ok > \\"$TAGMA_SURFACE_OUT/index.html\\""}}\n',
  );
  const { modules } = yield* Effect.promise(() => DEVELOPER.parts());
  const landed = yield* releaseInstallation(
    join(root, 'install'),
    join(root, 'bin/tagma'),
    { HOME: join(root, 'home'), SHELL: '/bin/zsh', PATH: process.env.PATH },
    {
      ...DEVELOPER.cut,
      channel,
      client: { root: app, config: null },
      roots: { ...DEVELOPER.cut.roots, desktop },
      platform: {
        ...inertPlatform,
        application: (name) => ({ bundle: hostBundle(name), binary: hostBinary(name) }),
        signer: Effect.succeed({ fingerprint: '-', name: 'test', created: false }),
        notice: () => 'unsigned',
      },
      steps: { graph: [], journal: [] },
      stores: modules.flatMap((module) => module.stores ?? []),
      processes: testProcesses,
    },
    null,
  ).pipe(Effect.provide(machine));
  if (build === undefined) return landed;
  return { ...landed, manifest: yield* writeInstallation(landed.root, landed.manifest.platform, build, landed.manifest.parts) };
}, Effect.provide(BunFileSystem.layer));

export const leavingCopy = Effect.fn('installedWorld.leaving')(function* (landed: ReleaseLanded, build: string) {
  const version = `${landed.version}-leaving`;
  const root = openVersion(dirname(landed.root), version);
  rmSync(root, { recursive: true, force: true });
  cpSync(landed.root, root, { recursive: true, verbatimSymlinks: true });
  wrote(join(root, MIGRATIONS, LEAVING_MIGRATION, 'migration.sql'), LEAVING_SQL);
  const carried = yield* partsAt(root, 'migrations', join(MIGRATIONS, LEAVING_MIGRATION, 'migration.sql'));
  yield* writeInstallation(root, landed.manifest.platform, build, [...landed.manifest.parts, ...carried]);
  return { version, root, build };
}, Effect.provide(BunFileSystem.layer));
