#!/usr/bin/env bun

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { ArtifactCache } from '../src/artifact.js';

const packageRoot = join(import.meta.dir, '..');
const nativeRoot = join(packageRoot, 'native');
const buildRoot = process.env.WHISPER_BUILD_ROOT?.trim() || join(nativeRoot, '.build');
const builtEngine = join(buildRoot, 'bin', 'whisper-engine');
const outputRoot = process.env.WHISPER_OUTPUT_ROOT?.trim() || join(packageRoot, 'bin');
const engine = join(outputRoot, 'whisper-engine');
const silero = join(outputRoot, 'silero.bin');
const required = process.argv.includes('--require');
const archAt = process.argv.indexOf('--arch');
const asked = archAt < 0 ? undefined : process.argv[archAt + 1];
const arch = asked ?? process.arch;
const machine = ({ arm64: 'arm64', x64: 'x86_64' } as Readonly<Record<string, string>>)[arch];
const configuration = ['-DCMAKE_BUILD_TYPE=Release', `-DCMAKE_OSX_ARCHITECTURES=${machine}`, '-DCMAKE_OSX_DEPLOYMENT_TARGET=13.0'];
const unplaced = ['-ffile-prefix-map={build}=whisper-build', '-ffile-prefix-map={native}=whisper-native'];
const placed = unplaced.map((flag) => flag.replace('{build}', buildRoot).replace('{native}', nativeRoot)).join(' ');
const compiled = [
  `-DCMAKE_C_FLAGS=${[process.env.CFLAGS?.trim(), placed].filter(Boolean).join(' ')}`,
  `-DCMAKE_CXX_FLAGS=${[process.env.CXXFLAGS?.trim(), placed].filter(Boolean).join(' ')}`,
];
const sileroSize = 885_098;
const sileroSha256 = '2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987';
const sileroUrl = 'https://huggingface.co/ggml-org/whisper-vad/resolve/9ffd54a1e1ee413ddf265af9913beaf518d1639b/ggml-silero-v6.2.0.bin';

const absence = join(outputRoot, 'whisper-engine.absent');
const ABSENT = 3;

const absent = (reason: string): never => {
  mkdirSync(outputRoot, { recursive: true });
  writeFileSync(absence, reason);
  console.log(`[speech-whisper] ${reason}`);
  process.exit(ABSENT);
};

if (archAt >= 0 && asked === undefined) {
  console.error('[speech-whisper] --arch names no architecture');
  process.exit(1);
}
if (process.platform !== 'darwin' || machine === undefined) {
  console.log(`[speech-whisper] the engine builds on macOS for arm64 and x64, not for ${process.platform}-${arch}`);
  process.exit(required ? ABSENT : 0);
}

const inputOf = (): string => {
  const hash = createHash('sha256').update(JSON.stringify({ platform: process.platform, arch, configuration, unplaced, sileroSha256 }));
  const read = (directory: string): void => {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (entry.name === '.build') continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) read(path);
      else
        hash
          .update(relative(nativeRoot, path))
          .update('\0')
          .update(createHash('sha256').update(readFileSync(path)).digest('hex'));
    }
  };
  read(nativeRoot);
  for (const name of ['CC', 'CXX', 'CFLAGS', 'CXXFLAGS', 'LDFLAGS', 'SDKROOT', 'MACOSX_DEPLOYMENT_TARGET', 'CMAKE_TOOLCHAIN_FILE']) {
    hash.update(JSON.stringify([name, process.env[name] ?? '']));
  }
  const toolchain = process.env.CMAKE_TOOLCHAIN_FILE?.trim();
  if (toolchain) hash.update(readFileSync(resolve(nativeRoot, toolchain)));
  return hash.digest('hex');
};

const input = inputOf();
const cache = new ArtifactCache(join(nativeRoot, '.build', asked === undefined ? 'whisper.artifact' : `whisper-darwin-${arch}.artifact`));
const cached = cache.read(input);
if (cached !== null) {
  mkdirSync(outputRoot, { recursive: true });
  writeFileSync(engine, cached.engine);
  chmodSync(engine, 0o755);
  writeFileSync(silero, cached.silero, { mode: 0o644 });
  rmSync(absence, { force: true });
  console.log('[speech-whisper] restored the cached engine and Silero for these inputs');
  process.exit(0);
}

const run = (command: string, args: readonly string[], capture = false): string => {
  const result = spawnSync(command, args, { cwd: nativeRoot, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
  if (result.error !== undefined && 'code' in result.error && result.error.code === 'ENOENT') {
    absent(`${command} is not installed on the machine that built this, so the Whisper engine was not built`);
  }
  if (result.status !== 0) {
    if (capture) process.stderr.write(`${result.stderr ?? ''}${result.stdout ?? ''}`);
    process.exit(result.status ?? 1);
  }
  return result.stdout ?? '';
};

run('cmake', ['-S', nativeRoot, '-B', buildRoot, ...configuration, ...compiled]);
run('cmake', ['--build', buildRoot, '--config', 'Release', '--target', 'whisper-engine', '--parallel', '3']);

if (!existsSync(builtEngine)) {
  console.error('[speech-whisper] the built engine is missing:', builtEngine);
  process.exit(1);
}
const kind = run('file', [builtEngine], true);
if (!kind.includes(`Mach-O 64-bit executable ${machine}`)) {
  console.error(`[speech-whisper] the built engine is not an ${machine} Mach-O:`, kind.trim());
  process.exit(1);
}
const foreign = run('otool', ['-L', builtEngine], true)
  .split('\n')
  .slice(1)
  .map((line) => line.trim().split(' ')[0] ?? '')
  .filter((path) => path !== '' && !path.startsWith('/usr/lib/') && !path.startsWith('/System/Library/'));
if (foreign.length > 0) {
  console.error('[speech-whisper] the engine links non-system libraries:', foreign.join(', '));
  process.exit(1);
}

mkdirSync(outputRoot, { recursive: true });
copyFileSync(builtEngine, engine);
chmodSync(engine, 0o755);

const pinned = (bytes: Uint8Array): boolean =>
  bytes.byteLength === sileroSize && createHash('sha256').update(bytes).digest('hex') === sileroSha256;

let detector: Uint8Array | undefined;
for (const candidate of new Set([silero, join(packageRoot, 'bin', 'silero.bin')])) {
  if (!existsSync(candidate)) continue;
  const bytes = readFileSync(candidate);
  if (!pinned(bytes)) continue;
  detector = bytes;
  if (candidate !== silero) writeFileSync(silero, bytes, { mode: 0o644 });
  break;
}
if (detector === undefined) {
  const response = await fetch(sileroUrl, { redirect: 'follow' }).catch((error: unknown) =>
    absent(`the Silero voice detector could not be downloaded (${String(error)}), so the Whisper engine was not carried`),
  );
  if (!response.ok) absent(`the Silero voice detector download failed with HTTP ${response.status}, so the Whisper engine was not carried`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!pinned(bytes)) {
    console.error('[speech-whisper] the Silero download does not match its pinned size and SHA-256');
    process.exit(1);
  }
  detector = bytes;
  const partial = `${silero}.${process.pid}.partial`;
  rmSync(partial, { force: true });
  writeFileSync(partial, bytes, { mode: 0o644 });
  renameSync(partial, silero);
}

if (inputOf() === input) cache.write(input, { engine: readFileSync(engine), silero: detector });
rmSync(absence, { force: true });
console.log('[speech-whisper] wrote', engine, 'and', silero);
