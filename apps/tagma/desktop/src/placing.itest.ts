import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ELECTRON = createRequire(import.meta.url)('electron') as string;
const ARCHIVE = join(dirname(dirname(ELECTRON)), 'Resources', 'default_app.asar');

const source = (file: string): string => JSON.stringify(fileURLToPath(new URL(file, import.meta.url)));

const fixture = `
import ${source('./noAsar.ts')};
import { become } from ${source('./placing.ts')};
console.log(JSON.stringify(await become(process.env.OWN, process.env.KEPT, process.env.INSTALL_ROOT)));
`;

const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleExecutable</key><string>Electron</string><key>CFBundleIdentifier</key><string>dev.tagma.placing-test</string></dict></plist>
`;

const application = (bundle: string, carried: string): string => {
  mkdirSync(join(bundle, 'Contents/MacOS'), { recursive: true });
  mkdirSync(join(bundle, 'Contents/Resources'), { recursive: true });
  writeFileSync(join(bundle, 'Contents/MacOS/Electron'), '#!/bin/sh\n', { mode: 0o755 });
  writeFileSync(join(bundle, 'Contents/Info.plist'), PLIST);
  writeFileSync(join(bundle, 'Contents/Resources/carried'), carried);
  copyFileSync(ARCHIVE, join(bundle, 'Contents/Resources/default_app.asar'));
  const signed = spawnSync('/usr/bin/codesign', ['-s', '-', '--force', '--deep', bundle]);
  if (signed.status !== 0) throw new Error(`the fake application was not signed: ${signed.stderr.toString()}`);
  return bundle;
};

test('the window replaces its own application holding an asar archive whole, leaving nothing of the old one beside it', async () => {
  const base = mkdtempSync(join(tmpdir(), 'desktop-placing-'));
  try {
    const own = application(join(base, 'Applications', 'Tagma.app'), 'old');
    const installRoot = join(base, 'install');
    const kept = application(join(installRoot, '0.2.2', 'desktop', 'Tagma.app'), 'new');
    writeFileSync(join(base, 'fixture.ts'), fixture);
    const built = await Bun.build({ entrypoints: [join(base, 'fixture.ts')], target: 'node', format: 'esm' });
    expect(built.success, built.logs.join('\n')).toBe(true);
    const entry = join(base, 'fixture.mjs');
    await Bun.write(entry, built.outputs[0]!);

    const ran = spawnSync(ELECTRON, [entry], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', OWN: own, KEPT: kept, INSTALL_ROOT: installRoot },
      encoding: 'utf8',
    });

    expect(ran.status, ran.stderr).toBe(0);
    expect(JSON.parse(ran.stdout.trim())).toEqual({ placed: own });
    expect(readFileSync(join(own, 'Contents/Resources/carried'), 'utf8')).toBe('new');
    expect(existsSync(join(base, 'Applications', '.Tagma.app.outgoing'))).toBe(false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
