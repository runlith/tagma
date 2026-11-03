import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { downloadArtifact } from '@electron/get';
import { absoluteSources } from '@runlith/bundle/maps';
import { isMachO, type Signing, signCode } from '@runlith/codesign/codesign';
import { HOST_REFUSAL_ENV, type HostRefusal } from '@tagma/server/installation/contract/wire/hostRefusal';
import { CHANNEL as DEVELOPER_CHANNEL } from '@tagma/server/composition/developer/channel';
import {
  AUDIO_HELPER,
  BUILD_INPUTS_ENV,
  BUILD_MAPS_ENV,
  BUILD_TARGET_ENV,
  buildConditionsIn,
  hostBundle,
  HOST_ASSETS_ENV,
  HOST_CHANNEL_ENV,
  HOST_MAIN,
  RELEASE_INSIDE,
  RELEASE_NUMBER_ENV,
  SIGNING_IDENTITY_ENV,
  sourceMapOriginIn,
} from '@tagma/server/installation/contract/wire/layout';
import { DESKTOP, EXECUTIONS } from '@tagma/server/installation/contract/wire/manifest';
import { EXECUTIONS_RUNTIME } from '@tagma/server/installation/contract/wire/archive';
import { signingIdentity, signingNotice } from '@tagma/server/cut/signing';
import { channelSchema } from '@tagma/server/installation/contract/wire/channel';
import { Effect, Layer, Schema } from 'effect';
import { type BuildOptions, build, context } from 'esbuild';
import { KEYCHAIN_ADDON } from '../src/browser/keychain.js';
import { CHANNEL_DEFINE } from '../src/channel.js';
import { INPUT_EXECUTABLE, INPUT_HELPER } from '../src/helper.js';
import { SWIPE_ADDON } from '../src/swipe.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const givenChannel = process.env[HOST_CHANNEL_ENV]?.trim();
const CHANNEL = givenChannel ? Schema.decodeUnknownSync(Schema.fromJsonString(channelSchema))(givenChannel) : DEVELOPER_CHANNEL;
const assets = process.env[HOST_ASSETS_ENV]?.trim() || join(packageRoot, 'assets');
const DESKTOP_INPUT = resolve(packageRoot, '..', '..', '..', 'packages', 'desktop-input');
const watching = process.argv.includes('--watch');

const embedded = !process.argv.includes('--unembedded');

const JIT = 'com.apple.security.cs.allow-jit';
const UNTEAMED_LIBRARIES = 'com.apple.security.cs.disable-library-validation';
const MICROPHONE = 'com.apple.security.device.audio-input';
const CAMERA = 'com.apple.security.device.camera';
const ICON = 'Tagma.icns';
const ICON_CATALOG = 'Assets.car';
const ICON_NAME = 'AppIcon';

const APPLICATION_ENTITLEMENTS = [JIT, UNTEAMED_LIBRARIES, MICROPHONE, CAMERA] as const;

const HELPER_ENTITLEMENTS: Readonly<Record<string, readonly string[]>> = {
  [`${AUDIO_HELPER}.app`]: [MICROPHONE],
  [`${INPUT_HELPER}.app`]: [],
  'Electron Helper.app': [JIT, UNTEAMED_LIBRARIES, MICROPHONE, CAMERA],
  'Electron Helper (Renderer).app': [JIT, UNTEAMED_LIBRARIES],
  'Electron Helper (Plugin).app': [JIT, UNTEAMED_LIBRARIES],
  'Electron Helper (GPU).app': [UNTEAMED_LIBRARIES],
};

class Refused extends Error {
  constructor(readonly refusal: HostRefusal) {
    super(refusal.detail);
  }
}

const USAGE = {
  NSMicrophoneUsageDescription: `${CHANNEL.name} listens to your microphone while you speak to it or record a voice note.`,
  NSAudioCaptureUsageDescription: `${CHANNEL.name} records the sound your Mac plays while you ask it to capture system audio.`,
  NSCameraUsageDescription: `${CHANNEL.name} lets a page in its built-in browser use your camera when you allow that site.`,
} as const;

const out = resolve(process.env.TAGMA_HOST_OUT?.trim() || join(packageRoot, 'dist'));
const release = process.env.TAGMA_HOST_RELEASE?.trim() || null;
const conditions = buildConditionsIn(process.env);
const appDir = join(out, 'app');
const mapsTo = process.env[BUILD_MAPS_ENV]?.trim() || null;
const inputsTo = process.env[BUILD_INPUTS_ENV]?.trim() || null;
const releaseNumber = process.env[RELEASE_NUMBER_ENV]?.trim() || null;
const target = process.env[BUILD_TARGET_ENV]?.trim() || null;
const targetArch = target === null ? null : (/^darwin-(arm64|x64)$/u.exec(target)?.[1] ?? null);
const carried = new Set<string>();

try {
  if (target !== null && targetArch === null) {
    throw new Refused({ detail: `${BUILD_TARGET_ENV}=${target} names no target: darwin-arm64 or darwin-x64`, unblock: [] });
  }
  const signing = !watching && process.platform === 'darwin' ? await signer() : null;
  mkdirSync(appDir, { recursive: true });

  const windowBehavior = resolve(packageRoot, '..', '..', '..', 'packages', 'window-behavior');
  run(process.execPath, ['run', '--cwd', windowBehavior, 'build'], true);
  run(process.execPath, ['run', '--cwd', DESKTOP_INPUT, 'build:js'], true);
  if (process.platform === 'darwin') {
    buildAddon('keychain.c', KEYCHAIN_ADDON, ['-framework', 'Security', '-framework', 'CoreFoundation']);
    buildAddon('swipe.m', SWIPE_ADDON, ['-fobjc-arc', '-framework', 'AppKit']);
  }

  const bundles: BuildOptions[] = [
    bundleOptions('main.ts', join(out, HOST_MAIN), 'esm'),
    bundleOptions('preload.ts', join(appDir, 'preload.cjs'), 'cjs'),
  ];

  if (watching) {
    for (const options of bundles) await (await context(options)).watch();
  } else {
    for (const options of bundles) await build(options);
  }

  if (inputsTo !== null) {
    mkdirSync(dirname(inputsTo), { recursive: true });
    writeFileSync(inputsTo, JSON.stringify([...carried].sort()));
  }

  writeFileSync(
    join(appDir, 'package.json'),
    `${JSON.stringify({ name: 'tagma', private: true, version: releaseNumber ?? '0.1.0', main: 'main.mjs', type: 'module' }, null, 2)}\n`,
  );

  if (signing !== null) await standApplication(signing);
} catch (error) {
  refuse(
    error instanceof Refused
      ? error.refusal
      : { detail: error instanceof Error ? error.message : String(error), unblock: ['fix what it names, then build again'] },
  );
}

console.log(`[tagma-host] ${watching ? `watching the bundles of ${CHANNEL.name}` : CHANNEL.name} in ${out}`);

function bundleOptions(entry: string, outfile: string, format: 'esm' | 'cjs'): BuildOptions {
  return {
    bundle: true,
    entryPoints: [join(packageRoot, 'src', entry)],
    external: ['electron'],
    conditions: conditions.length === 0 ? undefined : [...conditions, 'module'],
    define: { [CHANNEL_DEFINE]: JSON.stringify(CHANNEL) },
    format,
    outfile,
    platform: 'node',
    sourcemap: mapsTo === null ? true : 'external',
    metafile: inputsTo !== null,
    minify: releaseNumber !== null,
    legalComments: releaseNumber === null ? undefined : 'none',
    target: 'node22',
    write: false,
    plugins: [
      {
        name: 'write-what-moved',
        setup(plugin) {
          plugin.onEnd((result) => {
            for (const output of Object.values(result.metafile?.outputs ?? {})) {
              for (const [input, carrying] of Object.entries(output.inputs)) if (carrying.bytesInOutput > 0) carried.add(resolve(input));
            }
            for (const file of result.outputFiles ?? []) {
              const shelved = mapsTo !== null && file.path.endsWith('.map');
              const path = shelved ? join(mapsTo, relative(out, file.path)) : file.path;
              const contents = shelved
                ? Buffer.from(absoluteSources(file.text, dirname(file.path), sourceMapOriginIn(process.env)))
                : Buffer.from(file.contents);
              if (existsSync(path) && readFileSync(path).equals(contents)) continue;
              mkdirSync(dirname(path), { recursive: true });
              writeFileSync(path, contents);
            }
          });
        },
      },
    ],
  };
}

async function standApplication(fingerprint: string): Promise<void> {
  const target = join(out, hostBundle(CHANNEL.name));
  rmSync(target, { recursive: true, force: true });
  if (targetArch === null) {
    const electronApp = resolve(electronBinary(), '..', '..', '..');
    if (run('cp', ['-Rc', electronApp, target]) !== 0) run('cp', ['-R', electronApp, target], true);
  } else {
    await unpackElectron(targetArch, target);
  }

  if (embedded) cpSync(appDir, join(target, 'Contents', 'Resources', 'app'), { recursive: true });

  const plist = join(target, 'Contents', 'Info.plist');
  plistSet(plist, 'CFBundleIdentifier', CHANNEL.bundleId);
  plistSet(plist, 'CFBundleName', CHANNEL.name);
  plistSet(plist, 'CFBundleDisplayName', CHANNEL.name);
  plistSet(plist, 'LSMinimumSystemVersion', '13.0');
  cpSync(join(assets, ICON), join(target, 'Contents', 'Resources', ICON));
  cpSync(join(assets, ICON_CATALOG), join(target, 'Contents', 'Resources', ICON_CATALOG));
  plistSet(plist, 'CFBundleIconFile', ICON);
  plistSet(plist, 'CFBundleIconName', ICON_NAME);
  if (releaseNumber !== null) {
    plistSet(plist, 'CFBundleVersion', releaseNumber);
    plistSet(plist, 'CFBundleShortVersionString', releaseNumber);
  }
  for (const [key, text] of Object.entries(USAGE)) plistSet(plist, key, text);

  embedAudio(target);
  embedInput(target);
  if (release !== null) embedRelease(release, join(target, RELEASE_INSIDE));
  const signing = { identity: fingerprint, timestamp: releaseNumber !== null };
  for (const code of nestedCode(join(target, 'Contents'))) sign(code, signing, entitlementsOf(code));
  sign(target, signing, APPLICATION_ENTITLEMENTS);
}

function buildAddon(source: string, addon: string, linked: readonly string[]): void {
  const flags = ['-bundle', '-undefined', 'dynamic_lookup', '-O2', '-arch', 'arm64', '-arch', 'x86_64', '-mmacosx-version-min=13.0'];
  run('clang', [...flags, ...linked, '-o', join(appDir, addon), join(packageRoot, 'native', source)], true);
}

async function unpackElectron(arch: string, into: string): Promise<void> {
  const require = createRequire(import.meta.url);
  const { version } = require('electron/package.json') as { readonly version: string };
  const checksums = require('electron/checksums.json') as Record<string, string>;
  const zip = await downloadArtifact({ version, platform: 'darwin', arch, artifactName: 'electron', checksums });
  const unpacked = `${into}.unpacked`;
  rmSync(unpacked, { recursive: true, force: true });
  try {
    run('/usr/bin/ditto', ['-x', '-k', zip, unpacked], true);
    renameSync(join(unpacked, 'Electron.app'), into);
  } finally {
    rmSync(unpacked, { recursive: true, force: true });
  }
}

function embedAudio(target: string): void {
  const source = resolve(packageRoot, '..', '..', '..', 'packages', 'audio-darwin');
  run(process.execPath, [join(source, 'scripts', 'build-native.mjs'), ...(targetArch === null ? [] : ['--arch', targetArch])], true);
  const contents = join(target, 'Contents', 'Helpers', `${AUDIO_HELPER}.app`, 'Contents');
  mkdirSync(join(contents, 'MacOS'), { recursive: true });
  mkdirSync(join(contents, 'Resources'), { recursive: true });
  const built = targetArch === null ? join(source, 'bin') : join(source, 'bin', `darwin-${targetArch}`);
  cpSync(join(built, 'audio-helper'), join(contents, 'MacOS', 'audio-helper'));
  cpSync(join(source, 'native', 'LICENSE'), join(contents, 'Resources', 'LICENSE'));
  const plist = join(contents, 'Info.plist');
  cpSync(join(source, 'native', 'Info.plist'), plist);
  plistSet(plist, 'CFBundleIdentifier', `${CHANNEL.bundleId}.audio`);
  plistSet(plist, 'CFBundleName', `${CHANNEL.name} Audio`);
  plistSet(plist, 'CFBundleDisplayName', `${CHANNEL.name} Audio`);
  for (const [key, text] of Object.entries(USAGE)) plistSet(plist, key, text);
}

function embedRelease(from: string, into: string): void {
  rmSync(into, { recursive: true, force: true });
  mkdirSync(into, { recursive: true });
  for (const name of readdirSync(from)) {
    if (name === DESKTOP) continue;
    if (name === EXECUTIONS) {
      mkdirSync(join(into, name));
      for (const inner of readdirSync(join(from, name))) {
        if (`${name}/${inner}` !== EXECUTIONS_RUNTIME) clone(join(from, name, inner), join(into, name, inner));
      }
      continue;
    }
    clone(join(from, name), join(into, name));
  }
}

function clone(from: string, to: string): void {
  if (run('cp', ['-Rc', from, to]) !== 0) run('cp', ['-R', from, to], true);
}

function embedInput(target: string): void {
  run(process.execPath, [join(DESKTOP_INPUT, 'scripts', 'build-native.mjs'), '--require-darwin'], true);
  const contents = join(target, 'Contents', 'Helpers', `${INPUT_HELPER}.app`, 'Contents');
  mkdirSync(join(contents, 'MacOS'), { recursive: true });
  cpSync(join(DESKTOP_INPUT, 'bin', INPUT_EXECUTABLE), join(contents, 'MacOS', INPUT_EXECUTABLE));
  const plist = join(contents, 'Info.plist');
  cpSync(join(DESKTOP_INPUT, 'native', 'Info.plist'), plist);
  plistSet(plist, 'CFBundleIdentifier', `${CHANNEL.bundleId}.input`);
  plistSet(plist, 'CFBundleName', `${CHANNEL.name} Input`);
  plistSet(plist, 'CFBundleDisplayName', `${CHANNEL.name} Input`);
}

async function signer(): Promise<string> {
  const named = process.env[SIGNING_IDENTITY_ENV]?.trim();
  if (named) return named;
  const machine = BunChildProcessSpawner.layer.pipe(Layer.provideMerge(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));
  const found = await Effect.runPromise(Effect.result(signingIdentity).pipe(Effect.provide(machine)));
  if (found._tag === 'Failure') throw new Refused({ detail: found.failure.detail, unblock: found.failure.unblock });
  console.log(`[tagma-host] ${signingNotice(found.success)}`);
  return found.success.fingerprint;
}

function nestedCode(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (path.endsWith(`/${RELEASE_INSIDE}`)) continue;
    if (entry.isDirectory()) {
      found.push(...nestedCode(path));
      if (entry.name.endsWith('.app') || entry.name.endsWith('.framework')) found.push(path);
    } else if (entry.isFile() && isMachO(path) && !bundleMain(path)) {
      found.push(path);
    }
  }
  return found;
}

function bundleMain(path: string): boolean {
  const parent = dirname(path);
  const grand = dirname(parent);
  if (basename(grand) === 'Versions' && dirname(grand).endsWith('.framework')) {
    return basename(path) === basename(dirname(grand), '.framework');
  }
  if (basename(parent) !== 'MacOS' || basename(grand) !== 'Contents') return false;
  const plist = join(grand, 'Info.plist');
  const damaged = (why: string) =>
    new Refused({
      detail: `${plist} cannot be read, so which file in it is the bundle's own executable is unknown: ${why}`,
      unblock: ['reinstall Electron with bun install so its app is whole, then build again'],
    });
  const read = spawnSync('plutil', ['-convert', 'json', '-o', '-', plist], { encoding: 'utf8' });
  if (read.status !== 0) throw damaged(read.stderr?.trim() || read.error?.message || `plutil exited ${read.status}`);
  let parsed: { readonly CFBundleExecutable?: unknown };
  try {
    parsed = JSON.parse(read.stdout) as { readonly CFBundleExecutable?: unknown };
  } catch (error) {
    throw damaged(`plutil answered no JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const named = parsed.CFBundleExecutable;
  return (typeof named === 'string' ? named : basename(dirname(grand), '.app')) === basename(path);
}

function entitlementsOf(code: string): readonly string[] {
  if (!code.endsWith('.app')) return [];
  const named = HELPER_ENTITLEMENTS[basename(code)];
  if (named !== undefined) return named;
  throw new Refused({
    detail: `${code} is a helper whose entitlements are not named, and signing it with none would hide what it needs`,
    unblock: [
      `name the entitlements of ${basename(code)} in HELPER_ENTITLEMENTS of apps/tagma/desktop/scripts/build-host.ts, then build again`,
    ],
  });
}

function sign(code: string, signing: Signing, entitlements: readonly string[]): void {
  const signed = signCode(code, signing, entitlements);
  if (signed._tag === 'Signed') return;
  throw new Refused({
    detail: `codesign could not sign ${code} with the signing identity ${signing.identity}: ${signed.detail}`,
    unblock: [
      `let /usr/bin/codesign use the private key of the signing identity ${signing.identity} — answer "Always Allow" when macOS asks, or add /usr/bin/codesign under the key's Access Control in Keychain Access, and unlock the login keychain if it is locked — then build again`,
      ...(signing.timestamp
        ? ['a release signature carries a secure timestamp from timestamp.apple.com: reach the network, then cut again']
        : []),
    ],
  });
}

function refuse(refusal: HostRefusal): never {
  console.error(`[tagma-host] ${refusal.detail}\n${refusal.unblock.map((way) => `  - ${way}`).join('\n')}`);
  const file = process.env[HOST_REFUSAL_ENV]?.trim();
  if (file) writeFileSync(file, JSON.stringify(refusal));
  process.exit(1);
}

function electronBinary(): string {
  const require = createRequire(import.meta.url);
  try {
    return require('electron') as string;
  } catch {
    run(process.execPath, [join(dirname(require.resolve('electron/package.json')), 'install.js')], true);
    return require('electron') as string;
  }
}

function plistSet(plist: string, key: string, value: string): void {
  run('plutil', ['-replace', key, '-string', value, plist], true);
}

function run(command: string, args: readonly string[], required = false): number {
  const result = spawnSync(command, [...args], { stdio: required ? 'inherit' : 'ignore' });
  const code = result.status ?? 1;
  if (required && code !== 0) {
    throw new Refused({
      detail: `${command} ${args.join(' ')} ${result.error ? `could not run: ${result.error.message}` : `exited ${code}`}`,
      unblock: [`fix what ${basename(command)} printed above it, then build again`],
    });
  }
  return code;
}
