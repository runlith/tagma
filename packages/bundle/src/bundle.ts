import type { BunPlugin } from 'bun';
import { dirname, resolve } from 'node:path';
import { Data, Effect } from 'effect';
import { readComments } from '@runlith/source-comments';
import { absoluteSources } from './maps';

export class BundleRefused extends Data.TaggedError('BundleRefused')<{
  readonly entry: string;
  readonly detail: string;
}> {
  override get message(): string {
    return `${this.entry}: ${this.detail}`;
  }
}

export type BundleOptions = {
  readonly external?: readonly string[];
  readonly sourcemap?: 'inline' | 'external' | 'none';
  readonly plugins?: readonly BunPlugin[];
  readonly conditions?: readonly string[];
  readonly define?: Readonly<Record<string, string>>;
  readonly comments?: 'kept' | 'none';
  readonly minify?: boolean;
};

export type Bundled = {
  readonly name: string;
  readonly source: string;
  readonly text: string;
  readonly map: string | null;
  readonly inputs: readonly string[];
};

type Built = { readonly text: string; readonly map: string | null; readonly inputs: readonly string[] };

const BESIDE = /new URL\(\s*(["'`])\.\/([^"'`/\\]+\.(?:[cm]?[jt]s|tsx))\1\s*,\s*import\.meta\.url\s*\)/g;

const READ_AT_ONCE = 32;

const besideOf = (text: string): ReadonlySet<string> => new Set(Array.from(text.matchAll(BESIDE), (match) => match[2]!));

const OWN = /\.([cm]?[jt]s)$/u;
const KEPT = ['//!', '/*!'] as const;

type Span = { readonly start: number; readonly end: number };

const keptIn = (path: string, text: string): readonly Span[] => {
  if (!KEPT.some((opener) => text.includes(opener))) return [];
  const read = readComments(path, text);
  if (!read.lexed) throw new Error(`${path} cannot be read for its comments: ${read.reason}`);
  return read.comments.filter((comment) => KEPT.some((opener) => text.startsWith(opener, comment.start)));
};

export const keptComments = (path: string, text: string): readonly string[] =>
  keptIn(path, text).map((span) => text.slice(span.start, span.end));

const withoutKeptComments = (path: string, text: string): string => {
  let bare = '';
  let cursor = 0;
  for (const span of keptIn(path, text)) {
    bare += text.slice(cursor, span.start) + text.slice(span.start, span.end).replace(/[^\n]/gu, ' ');
    cursor = span.end;
  }
  return bare + text.slice(cursor);
};

const uncommented: BunPlugin = {
  name: 'uncommented',
  setup(plugin) {
    plugin.onLoad({ filter: OWN }, async ({ path }) => {
      if (path.includes('/node_modules/')) return undefined;
      const extension = OWN.exec(path)![1]!;
      return { contents: withoutKeptComments(path, await Bun.file(path).text()), loader: extension.endsWith('ts') ? 'ts' : 'js' };
    });
  },
};

const built = Effect.fn('bundle.build')(function* (entry: string, options: BundleOptions): Effect.fn.Return<Built, BundleRefused> {
  const from = process.cwd();
  const bare = options.comments === 'none';
  const result = yield* Effect.tryPromise({
    try: () =>
      Bun.build({
        entrypoints: [entry],
        target: 'bun',
        throw: false,
        metafile: true,
        sourcemap: options.sourcemap ?? 'none',
        external: [...(options.external ?? [])],
        plugins: [...(options.plugins ?? []), ...(bare ? [uncommented] : [])],
        conditions: [...(options.conditions ?? [])],
        define: { ...options.define },
        minify: options.minify === true ? { whitespace: true, syntax: true, identifiers: true } : { whitespace: bare },
      }),
    catch: (error) => new BundleRefused({ entry, detail: `it could not be bundled: ${String(error)}` }),
  });
  if (!result.success) return yield* new BundleRefused({ entry, detail: result.logs.map((log) => String(log)).join('; ') });
  const outputs = result.outputs.filter((one) => one.kind !== 'sourcemap');
  const [output] = outputs;
  if (output === undefined || outputs.length !== 1) {
    return yield* new BundleRefused({ entry, detail: `it produced ${outputs.length} files, and an entry bundles into one` });
  }
  const contributed = Object.values(result.metafile?.outputs ?? {})[0];
  if (contributed === undefined) return yield* new BundleRefused({ entry, detail: 'the bundler answered no record of its inputs' });
  const [text, map] = yield* Effect.tryPromise({
    try: () => Promise.all([output.text(), output.sourcemap === null ? null : output.sourcemap.text()]),
    catch: (error) => new BundleRefused({ entry, detail: `its bundle could not be read: ${String(error)}` }),
  });
  const inputs = Object.entries(contributed.inputs).flatMap(([path, input]) => (input.bytesInOutput > 0 ? [resolve(from, path)] : []));
  return { text, map: map === null ? null : absoluteSources(map, from), inputs };
});

const spelled = Effect.fn('bundle.sources')(function* (
  entry: string,
  inputs: readonly string[],
  names: ReadonlySet<string>,
): Effect.fn.Return<ReadonlyMap<string, ReadonlySet<string>>, BundleRefused> {
  const found = new Map<string, Set<string>>();
  yield* Effect.forEach(
    inputs,
    (input) =>
      Effect.tryPromise({
        try: () => Bun.file(input).text(),
        catch: (error) => new BundleRefused({ entry, detail: `${input}, which it carries, could not be read: ${String(error)}` }),
      }).pipe(
        Effect.map((text) => {
          if (!text.includes('import.meta.url')) return;
          for (const name of besideOf(text)) {
            if (!names.has(name)) continue;
            const at = found.get(name) ?? new Set<string>();
            at.add(resolve(dirname(input), name));
            found.set(name, at);
          }
        }),
      ),
    { concurrency: READ_AT_ONCE, discard: true },
  );
  return found;
});

export const bundle = Effect.fn('bundle')(function* (
  entry: string,
  name: string,
  options: BundleOptions = {},
): Effect.fn.Return<readonly Bundled[], BundleRefused> {
  const sources = new Map<string, string>([[name, resolve(entry)]]);
  const waiting = [name];
  const done: Bundled[] = [];
  for (let next = waiting.shift(); next !== undefined; next = waiting.shift()) {
    const source = sources.get(next)!;
    const one = yield* built(source, options);
    done.push({ name: next, source, text: one.text, map: one.map, inputs: one.inputs });
    const names = besideOf(one.text);
    if (names.size === 0) continue;
    const found = yield* spelled(source, one.inputs, names);
    for (const beside of names) {
      const paths = [...(found.get(beside) ?? [])];
      if (paths.length === 0) {
        return yield* new BundleRefused({
          entry: source,
          detail: `its bundle starts ./${beside} beside itself, and no source it carries names that file`,
        });
      }
      if (paths.length > 1) {
        return yield* new BundleRefused({
          entry: source,
          detail: `./${beside} names ${paths.join(' and ')}, and one directory holds one file by that name`,
        });
      }
      const path = paths[0]!;
      const held = sources.get(beside);
      if (held === undefined) {
        sources.set(beside, path);
        waiting.push(beside);
      } else if (held !== path) {
        return yield* new BundleRefused({
          entry: source,
          detail: `./${beside} names ${path}, and ${held} already stands under that name`,
        });
      }
    }
  }
  return done;
});
