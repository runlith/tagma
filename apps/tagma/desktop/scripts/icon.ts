import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const assets = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const out = mkdtempSync(join(tmpdir(), 'tagma-icon-'));

try {
  const compiled = Bun.spawnSync(
    [
      'xcrun',
      'actool',
      join(assets, 'AppIcon.icon'),
      '--compile',
      out,
      '--platform',
      'macosx',
      '--minimum-deployment-target',
      '13.0',
      '--app-icon',
      'AppIcon',
      '--output-partial-info-plist',
      join(out, 'partial.plist'),
      '--output-format',
      'human-readable-text',
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  const made = ['Assets.car', 'AppIcon.icns'].every((name) => existsSync(join(out, name)));
  if (compiled.exitCode !== 0 || !made) {
    console.error(`${compiled.stdout.toString()}${compiled.stderr.toString()}`);
    console.error('actool did not compile AppIcon.icon: it needs Xcode 26 or newer (xcode-select -p names the one in use)');
    process.exit(1);
  }
  copyFileSync(join(out, 'Assets.car'), join(assets, 'Assets.car'));
  copyFileSync(join(out, 'AppIcon.icns'), join(assets, 'Tagma.icns'));
  console.log(`[tagma-icon] Assets.car and Tagma.icns written to ${assets}`);
} finally {
  rmSync(out, { recursive: true, force: true });
}
