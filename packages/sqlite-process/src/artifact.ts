import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { Schema } from 'effect';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIBRARY_NAME, SOURCE_DIGEST, SOURCE_ARCHIVE as ARCHIVE } from './engine.js';
const AMALGAMATION = 'sqlite-amalgamation-3530400';
const ORIGIN = `https://sqlite.org/2026/${AMALGAMATION}.zip`;
const FLAGS = [
  'SQLITE_THREADSAFE=2',
  'SQLITE_ENABLE_API_ARMOR',
  'SQLITE_ENABLE_COLUMN_METADATA',
  'SQLITE_ENABLE_DBSTAT_VTAB',
  'SQLITE_ENABLE_FTS3',
  'SQLITE_ENABLE_FTS3_PARENTHESIS',
  'SQLITE_ENABLE_FTS4',
  'SQLITE_ENABLE_FTS5',
  'SQLITE_ENABLE_MATH_FUNCTIONS',
  'SQLITE_ENABLE_NORMALIZE',
  'SQLITE_ENABLE_PREUPDATE_HOOK',
  'SQLITE_ENABLE_RTREE',
  'SQLITE_ENABLE_SESSION',
  'SQLITE_ENABLE_SNAPSHOT',
  'SQLITE_ENABLE_STMT_SCANSTATUS',
  'SQLITE_MAX_VARIABLE_NUMBER=500000',
  'SQLITE_DEFAULT_SYNCHRONOUS=2',
  'SQLITE_DEFAULT_WAL_SYNCHRONOUS=2',
  'SQLITE_DEFAULT_CKPTFULLFSYNC=1',
];

export const carrier = {
  path: fileURLToPath(new URL('./child.ts', import.meta.url)),
  role: 'carrier' as const,
};

export type EngineAsset = {
  readonly path: string;
  readonly name: string;
  readonly digest: string;
  readonly role: 'carrier';
};

const hash = (bytes: Uint8Array, algorithm = 'sha256'): string => createHash(algorithm).update(bytes).digest('hex');
const receipt = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ recipe: Schema.String, digest: Schema.String })));
const present = async (path: string): Promise<Uint8Array | undefined> => {
  try {
    return await readFile(path);
  } catch (cause) {
    if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return undefined;
    throw cause;
  }
};

type EnginePlace = { readonly archive: string; readonly library: string };

const HOME: EnginePlace = { archive: ARCHIVE, library: fileURLToPath(new URL('./sqlite.native', import.meta.url)) };

const extract = async (archive: string, name: string): Promise<Uint8Array> => {
  const child = Bun.spawn(['unzip', '-p', archive, `${AMALGAMATION}/${name}`], { stdout: 'pipe', stderr: 'pipe' });
  const [bytes, trouble, code] = await Promise.all([new Response(child.stdout).bytes(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(`The SQLite source ${name} could not be extracted: ${trouble}`);
  return bytes;
};

const MACHINE_ARCHES: Readonly<Record<string, string>> = { arm64: 'arm64', x64: 'x86_64' };

export const buildEngine = async (arch?: string, place: EnginePlace = HOME): Promise<EngineAsset> => {
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    throw new Error(`The SQLite native build is not declared for ${process.platform}.`);
  }
  const machine = arch === undefined ? undefined : MACHINE_ARCHES[arch];
  if (arch !== undefined && (process.platform !== 'darwin' || machine === undefined)) {
    throw new Error(`The SQLite native build for ${arch} is declared on macOS for arm64 and x64.`);
  }
  const archive = hash(await readFile(place.archive));
  if (archive !== '1e71ddf93849c6a6ecf58b827c0692073d2dd7ee40196158068f7b29f422e87d') {
    throw new Error(`The fixed SQLite source archive has digest ${archive}.`);
  }
  const root =
    arch === undefined
      ? join(dirname(place.archive), 'build', `${process.platform}-${process.arch}`)
      : join(dirname(place.archive), 'build', 'targets', `${process.platform}-${arch}`);
  const path = arch === undefined ? place.library : join(root, LIBRARY_NAME);
  const named = [
    ...(process.platform === 'darwin' ? [`-Wl,-install_name,@rpath/${LIBRARY_NAME}`] : []),
    ...(machine === undefined ? [] : ['-arch', machine]),
  ];
  const recipe = hash(new TextEncoder().encode(JSON.stringify([SOURCE_DIGEST, FLAGS, named, process.platform, arch ?? process.arch])));
  const stamp = join(root, 'receipt.json');
  const held = await present(stamp);
  if (held !== undefined) {
    const saved = receipt(new TextDecoder().decode(held));
    const bytes = await present(path);
    if (saved.recipe === recipe && bytes !== undefined && saved.digest === `sha256:${hash(bytes)}`) {
      return { path, name: LIBRARY_NAME, digest: saved.digest, role: 'carrier' };
    }
  }
  const source = await extract(place.archive, 'sqlite3.c');
  const digest = hash(source, 'sha3-256');
  if (digest !== SOURCE_DIGEST) throw new Error(`The SQLite source digest is ${digest}; expected ${SOURCE_DIGEST}.`);
  await mkdir(root, { recursive: true });
  const work = await mkdtemp(join(root, 'compile-'));
  try {
    await writeFile(join(work, 'sqlite3.c'), source);
    await writeFile(join(work, 'sqlite3.h'), await extract(place.archive, 'sqlite3.h'));
    const output = join(work, LIBRARY_NAME);
    const child = Bun.spawn(
      [
        'cc',
        '-O2',
        ...(process.platform === 'darwin' ? ['-dynamiclib'] : ['-shared', '-fPIC']),
        ...named,
        `-ffile-prefix-map=${work}=sqlite`,
        ...FLAGS.map((flag) => `-D${flag}`),
        join(work, 'sqlite3.c'),
        '-o',
        output,
        '-lm',
        '-lpthread',
      ],
      { stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' },
    );
    const code = await child.exited;
    if (code !== 0) throw new Error(`The SQLite native build ended with code ${code}.`);
    const digestOfAsset = `sha256:${hash(await readFile(output))}`;
    await rename(output, path);
    const receiptPath = join(work, 'receipt.json');
    await writeFile(receiptPath, JSON.stringify({ recipe, digest: digestOfAsset }));
    await rename(receiptPath, stamp);
    return { path, name: LIBRARY_NAME, digest: digestOfAsset, role: 'carrier' };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
};

if (import.meta.main) {
  if (process.argv[2] === '--fetch') {
    const response = await fetch(ORIGIN, { redirect: 'error' });
    if (!response.ok) throw new Error(`The fixed SQLite source returned ${response.status}.`);
    await mkdir(dirname(ARCHIVE), { recursive: true });
    await writeFile(ARCHIVE, await response.bytes());
  }
  console.log(JSON.stringify(await buildEngine()));
}
