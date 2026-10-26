import { writeSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { SourceMap, type SourceMapping } from 'node:module';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import type { BunPlugin } from 'bun';
import type { Answer, Job, Place } from './protocol.js';
import { baseOf, candidatesOf, isRelative, keyLine, specifierLine } from './sources.js';

type Origin = { readonly _tag: 'version'; readonly path: string } | { readonly _tag: 'door' } | { readonly _tag: 'entry' };

const BUNDLE = 'tagma-config-bundle.js';

const LOADERS: Readonly<Record<string, 'ts' | 'tsx' | 'js' | 'jsx' | 'json'>> = {
  '.ts': 'ts',
  '.mts': 'ts',
  '.cts': 'ts',
  '.tsx': 'tsx',
  '.js': 'js',
  '.mjs': 'js',
  '.cjs': 'js',
  '.jsx': 'jsx',
  '.json': 'json',
};

const PRELUDE = `(() => {
  const differs = ' would make one tagma.config.ts answer differently on every run';
  const refuse = (what) => function () { throw new Error(what + differs); };
  const Real = Date;
  function Frozen(...args) {
    if (new.target === undefined || args.length === 0) throw new Error((new.target === undefined ? 'Date()' : 'new Date()') + ' reads the clock, which' + differs);
    return new Real(...args);
  }
  Frozen.prototype = Real.prototype;
  Real.prototype.constructor = Frozen;
  Frozen.UTC = Real.UTC;
  Frozen.parse = Real.parse;
  Frozen.now = refuse('Date.now() reads the clock, which');
  globalThis.Date = Frozen;
  Math.random = refuse('Math.random()');
  if (typeof Temporal === 'object') {
    for (const name of Object.getOwnPropertyNames(Temporal.Now)) {
      Object.defineProperty(Temporal.Now, name, { value: refuse('Temporal.Now.' + name + '() reads the clock, which') });
    }
  }
  const formats = Intl.DateTimeFormat.prototype;
  const format = Object.getOwnPropertyDescriptor(formats, 'format').get;
  const parts = formats.formatToParts;
  const dated = (date, what) => { if (date === undefined) throw new Error(what + ' without a date reads the clock, which' + differs); };
  Object.defineProperty(formats, 'format', { get() { const bound = format.call(this); return (date) => { dated(date, 'Intl.DateTimeFormat format()'); return bound(date); }; } });
  formats.formatToParts = function (date) { dated(date, 'Intl.DateTimeFormat formatToParts()'); return parts.call(this, date); };
})();`;

const RESULT = `JSON.stringify(globalThis.__config, function (key, value) {
  const kind = typeof value;
  const named = key === '' ? 'the default export' : key;
  if (kind === 'function' || kind === 'symbol') {
    globalThis.__offending = key;
    throw new TypeError(named + ' is a ' + kind + ', which is no data: call it or leave it out');
  }
  if (kind === 'object' && value !== null && !Array.isArray(value)) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      globalThis.__offending = key;
      throw new TypeError(named + ' is a ' + (prototype.constructor?.name ?? 'object') + ', which is no plain data' + (typeof value.then === 'function' ? ': a config is synchronous data' : ''));
    }
  }
  return value;
})`;

function said(answer: Answer): never {
  const bytes = new TextEncoder().encode(`${JSON.stringify(answer)}\n`);
  for (let written = 0; written < bytes.length;) written += writeSync(1, bytes, written);
  process.exit(0);
}

const job: Job = JSON.parse(await Bun.stdin.text());
const absent = new Set(job.absent);
const root = await mkdtemp(join(tmpdir(), 'tagma-config-'));
const origins = new Map<string, Origin>();
const loaded = new Set<string>();
const missed = new Set<string>();
const wanted = new Set<string>();
const refusals: Place[] = [];
const entry = `${root}/tagma-config-entry.ts`;
origins.set(entry, { _tag: 'entry' });

const versionPath = (path: string): string => {
  const virtual = `${root}/${path}`;
  origins.set(virtual, { _tag: 'version', path });
  return virtual;
};

const doorPath = (file: string): string => {
  const virtual = `door/${file}`;
  origins.set(virtual, { _tag: 'door' });
  return virtual;
};

const fileOf = (virtual: string): string => {
  const origin = origins.get(virtual);
  return origin?._tag === 'version'
    ? origin.path
    : origin?._tag === 'door'
      ? `@runlith/tagma (${virtual.slice('door/'.length)})`
      : job.entry;
};

const textOf = (virtual: string): string => {
  const origin = origins.get(virtual);
  if (origin?._tag === 'version') return job.files[origin.path] ?? '';
  if (origin?._tag === 'door') return Object.values(job.doors).find((door) => `door/${door.file}` === virtual)?.text ?? '';
  return '';
};

const refused = (importer: string, specifier: string, reason: string) => {
  refusals.push({ file: fileOf(importer), line: specifierLine(textOf(importer), specifier), reason });
  return { path: specifier, namespace: 'refused' };
};

const doors = Object.keys(job.doors);

const resolving: BunPlugin = {
  name: 'tagma-config',
  setup(build) {
    build.onResolve({ filter: /.*/ }, ({ path: specifier, importer, kind }) => {
      if (kind === 'entry-point-build') return { path: entry, namespace: 'entry' };
      const door = job.doors[specifier];
      if (door !== undefined) return { path: doorPath(door.file), namespace: 'door' };
      const origin = origins.get(importer);
      if (isRelative(specifier) && origin?._tag === 'door') {
        const file = posix.basename(specifier).replace(/\.js$/u, '.ts');
        if (Object.values(job.doors).some((one) => one.file === file)) return { path: doorPath(file), namespace: 'door' };
        return refused(importer, specifier, `${specifier} is no file of the @runlith/tagma copy Tagma carries`);
      }
      if (!isRelative(specifier)) {
        return refused(
          importer,
          specifier,
          specifier.startsWith('@runlith/tagma/')
            ? `${specifier} is no door Tagma carries; tagma.config.ts may import ${doors.join(', ')}`
            : `${specifier} (${kind}) cannot be loaded: tagma.config.ts may import only files of this version by a relative path and ${doors.join(', ')}`,
        );
      }
      const base = baseOf(origin?._tag === 'version' ? origin.path : null, specifier);
      if (base === null) return refused(importer, specifier, `${specifier} leads outside the repository`);
      const candidates = candidatesOf(base);
      const consulted: string[] = [];
      for (const candidate of candidates) {
        if (job.files[candidate] !== undefined) {
          for (const one of consulted) missed.add(one);
          loaded.add(candidate);
          return { path: versionPath(candidate), namespace: 'version' };
        }
        if (!absent.has(candidate)) {
          for (const one of candidates) if (job.files[one] === undefined && !absent.has(one)) wanted.add(one);
          return { path: specifier, namespace: 'refused' };
        }
        consulted.push(candidate);
      }
      for (const one of consulted) missed.add(one);
      return refused(importer, specifier, `${specifier} names no file of this version (looked for ${consulted.join(', ')})`);
    });
    build.onLoad({ filter: /.*/, namespace: 'entry' }, () => ({
      contents: `import config from './${job.entry}';\nglobalThis.__config = config;\n`,
      loader: 'ts',
    }));
    build.onLoad({ filter: /.*/, namespace: 'version' }, ({ path }) => {
      const origin = origins.get(path);
      const file = origin?._tag === 'version' ? origin.path : '';
      return { contents: job.files[file] ?? '', loader: LOADERS[posix.extname(file)] ?? 'ts' };
    });
    build.onLoad({ filter: /.*/, namespace: 'door' }, ({ path }) => ({ contents: textOf(path), loader: 'ts' }));
    build.onLoad({ filter: /.*/, namespace: 'refused' }, () => ({ contents: 'module.exports = {};', loader: 'js' }));
  },
};

const read = () => ({ loaded: [...loaded].sort(), missed: [...missed].sort() });

const built = await Bun.build({
  entrypoints: [entry],
  target: 'browser',
  format: 'iife',
  sourcemap: 'external',
  minify: false,
  throw: false,
  plugins: [resolving],
}).finally(() => rm(root, { recursive: true, force: true }));

if (wanted.size > 0) said({ _tag: 'wanted', paths: [...wanted].sort() });

const first = refusals.sort((a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0))[0];
if (first !== undefined) said({ _tag: 'refused', ...first, ...read() });

if (!built.success) {
  const failure = built.logs.find((log) => log.level === 'error') ?? built.logs[0];
  const position = failure?.position ?? null;
  said({
    _tag: 'refused',
    file: position === null ? job.entry : fileOf(position.file),
    line: position === null || position.line === 0 ? null : position.line,
    reason: failure?.message ?? 'tagma.config.ts could not be built',
    ...read(),
  });
}

const output = built.outputs.find((one) => one.kind === 'entry-point');
if (output === undefined) said({ _tag: 'refused', file: job.entry, line: null, reason: `${job.entry} built into no script`, ...read() });
const code = await output.text();
const map = output.sourcemap === null ? null : new SourceMap(JSON.parse(await output.sourcemap.text()));

const mapped = (entry: SourceMapping | object): entry is SourceMapping => 'originalSource' in entry && 'originalLine' in entry;

const keyed = (key: string, reason: string): Place => {
  for (const file of [job.entry, ...[...loaded].filter((one) => one !== job.entry).sort()]) {
    const line = keyLine(job.files[file] ?? '', key);
    if (line !== null) return { file, line, reason };
  }
  return { file: job.entry, line: null, reason };
};

const placed = (thrown: unknown, offending: unknown): Place => {
  let reason: string;
  let stack = '';
  try {
    reason = String(thrown);
    const carried = typeof thrown === 'object' && thrown !== null ? (thrown as { readonly stack?: unknown }).stack : undefined;
    stack = typeof carried === 'string' ? carried : '';
  } catch {
    reason = 'it threw a value whose text cannot be read';
  }
  if (typeof offending === 'string' && offending !== '') return keyed(offending, reason);
  const frame = new RegExp(`${BUNDLE.replaceAll('.', '\\.')}:(\\d+):(\\d+)`, 'u').exec(stack);
  const found = frame === null || map === null ? null : map.findEntry(Number(frame[1]) - 1, Number(frame[2]) - 1);
  if (found === null || !mapped(found)) return { file: job.entry, line: null, reason };
  const virtual = found.originalSource.slice(found.originalSource.indexOf(':') + 1);
  return { file: fileOf(virtual), line: found.originalLine + 1, reason };
};

const context = createContext(Object.create(null));
runInContext(PRELUDE, context, { filename: 'tagma-config-prelude.js' });
let json: unknown;
try {
  runInContext(code, context, { filename: BUNDLE });
  json = runInContext(RESULT, context, { filename: 'tagma-config-result.js' });
} catch (thrown) {
  said({ _tag: 'refused', ...placed(thrown, runInContext('globalThis.__offending', context)), ...read() });
}
if (typeof json !== 'string') {
  said({
    _tag: 'refused',
    file: job.entry,
    line: null,
    reason: `the default export of ${job.entry} is not data JSON can carry`,
    ...read(),
  });
}
said({ _tag: 'evaluated', value: JSON.parse(json), ...read() });
