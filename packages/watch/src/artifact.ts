/// <reference types="bun" />

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIBRARY } from './engine.js';

const CRATE = fileURLToPath(new URL('../native', import.meta.url));

const TARGET = join(CRATE, 'target');

const DARWIN_TRIPLES: Readonly<Record<string, string>> = { arm64: 'aarch64-apple-darwin', x64: 'x86_64-apple-darwin' };

const LIBRARY_FILE =
  process.platform === 'darwin' ? 'libwatch_engine.dylib' : process.platform === 'win32' ? 'watch_engine.dll' : 'libwatch_engine.so';

type Place = { readonly triple: string | null; readonly built: string; readonly output: string; readonly receipt: string };

const placeOf = (arch: string | undefined): Place => {
  if (arch === undefined) {
    return { triple: null, built: join(TARGET, 'release', LIBRARY_FILE), output: LIBRARY, receipt: join(TARGET, 'engine.receipt') };
  }
  const triple = process.platform === 'darwin' ? DARWIN_TRIPLES[arch] : undefined;
  if (triple === undefined) throw new Error(`the watch engine for ${arch} is declared on macOS for arm64 and x64`);
  const keyed = join(TARGET, triple);
  return {
    triple,
    built: join(keyed, 'release', LIBRARY_FILE),
    output: join(keyed, 'watch.native'),
    receipt: join(keyed, 'engine.receipt'),
  };
};

const flags = (home: string): string[] => [
  `--remap-path-prefix=${home}=~`,
  ...(process.platform === 'darwin' ? ['-Clink-arg=-Wl,-install_name,@rpath/libwatch_engine.dylib'] : []),
];

const filesUnder = (path: string): string[] =>
  readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    return entry.isDirectory() ? filesUnder(child) : [child];
  });

const recipe = (place: Place): string => {
  const hash = createHash('sha256');
  const lock = join(CRATE, '..', '..', '..', 'Cargo.lock');
  for (const file of [join(CRATE, 'Cargo.toml'), lock, ...filesUnder(join(CRATE, 'src')).sort()]) {
    hash.update(file.slice(CRATE.length));
    hash.update(readFileSync(file));
  }
  hash.update(place.triple ?? `${process.platform}-${process.arch}`);
  hash.update(JSON.stringify(flags('~')));
  return hash.digest('hex');
};

export const crateStands = (): boolean => existsSync(join(CRATE, 'Cargo.toml'));

export const buildEngine = (arch?: string): string => {
  const place = placeOf(arch);
  const wanted = recipe(place);
  if (existsSync(place.output) && existsSync(place.receipt) && readFileSync(place.receipt, 'utf8') === wanted) return place.output;
  const built = Bun.spawnSync(
    [
      'cargo',
      'build',
      '-j',
      '2',
      '--release',
      '--locked',
      '-p',
      'watch-engine',
      '--manifest-path',
      join(CRATE, 'Cargo.toml'),
      '--target-dir',
      TARGET,
      ...(place.triple === null ? [] : ['--target', place.triple]),
    ],
    { stdout: 'inherit', stderr: 'inherit', env: { ...process.env, CARGO_ENCODED_RUSTFLAGS: flags(homedir()).join('\x1f') } },
  );
  if (built.exitCode !== 0) throw new Error(`the watch engine did not build: cargo exited ${built.exitCode}`);
  mkdirSync(join(place.output, '..'), { recursive: true });
  const staged = `${place.output}.${process.pid}`;
  copyFileSync(place.built, staged);
  renameSync(staged, place.output);
  writeFileSync(place.receipt, wanted);
  return place.output;
};

if (import.meta.main) {
  const at = process.argv.indexOf('--arch');
  const arch = at < 0 ? undefined : process.argv[at + 1];
  if (at >= 0 && arch === undefined) throw new Error('--arch names no architecture');
  console.log(buildEngine(arch));
}
