import { RUNTIMES, runtimeNamed } from '@runlith/code-facts/runtimes';
import { Effect, Schema } from 'effect';

const segment = String.raw`(?!\.{1,2}(?:/|$))[^/\\]+`;
const path = `${segment}(?:/${segment})*`;

export const entry = Schema.String.check(Schema.isPattern(new RegExp(`^${path}/?$`, 'u'))).annotate({
  description: 'A directory (ending in `/`) or a file, relative to `base`.',
});

export const base = Schema.String.check(Schema.isPattern(new RegExp(`^(?:${path})?$`, 'u'))).annotate({
  description:
    'The directory the entries are relative to, from the repository root, with no leading or trailing `/`; empty for the root itself.',
});

export const query = Schema.String.check(Schema.isPattern(/^\?[^\s?#/]+$/u)).annotate({
  description: 'A query a bundler reads off the end of an import specifier, as written there: `?raw`, `?worker&inline`.',
});

export const runtime = Schema.NonEmptyString.check(
  Schema.makeFilter((id) =>
    runtimeNamed(id) === undefined ? `no runtime adapter is named \`${id}\`: ${RUNTIMES.map((one) => one.id).join(', ')}` : undefined,
  ),
).annotate({ description: 'A runtime adapter: it names the built-ins its runtime provides and the export conditions it reads.' });

export const runtimes = Schema.Array(runtime).annotate({
  description:
    'The runtimes the judged code runs on: a specifier one of them names a built-in is the runtime’s own, never a package or a path.',
});

export const built = Schema.Array(
  Schema.Struct({
    output: entry.check(Schema.makeFilter((path) => (path.endsWith('/') ? 'a built output names one file' : undefined))),
    source: entry.check(Schema.makeFilter((path) => (path.endsWith('/') ? 'a built source names one file' : undefined))),
    why: Schema.NonEmptyString,
  }),
).check(
  Schema.makeFilter((rows) => (new Set(rows.map((row) => row.output)).size === rows.length ? undefined : 'a built output is mapped once')),
);

export const defaulted = <S extends Schema.Top>(schema: S, value: S['Encoded']) =>
  schema.pipe(Schema.withDecodingDefaultKey(Effect.succeed(value)));

export const baseOrRoot = defaulted(base, '');

const extensionsField = <const E extends readonly string[]>(extensions: E) =>
  Schema.Array(Schema.Literals(extensions)).annotate({
    description: 'The file extensions read; a changed file with any other is neither read nor failed.',
  });

const exclude = Schema.Array(Schema.NonEmptyString).annotate({
  description: 'Glob patterns matched against the path relative to `base`; a matching file is neither read nor failed.',
});

export const filesOf = <const E extends readonly string[]>(extensions: E) =>
  Schema.Struct({ extensions: extensionsField(extensions), exclude });

export const filesOrAll = <const E extends readonly string[]>(extensions: E) =>
  defaulted(
    Schema.Struct({
      extensions: defaulted(extensionsField(extensions), extensions),
      exclude: defaulted(exclude, []),
    }).annotate({ description: 'The files read; absent, every file of the inspection’s languages.' }),
    {},
  );

type Files = { readonly extensions: readonly string[]; readonly exclude: readonly string[] };

export const bare = (entry: string): string => entry.replace(/\/$/, '');

export const distinct = (entries: readonly string[]): boolean => new Set(entries.map(bare)).size === entries.length;

const localTo = (at: string, path: string): string | undefined =>
  at === '' ? path : path.startsWith(`${at}/`) ? path.slice(at.length + 1) : undefined;

const inside = (path: string, prefix: string): boolean => path === prefix || path.startsWith(`${prefix}/`);

export const inRegion = (value: { readonly base: string; readonly region: readonly string[] }, path: string): boolean => {
  const local = localTo(value.base, path);
  return local !== undefined && value.region.some((one) => inside(local, bare(one)));
};

export const describeFiles = (at: string, selected: Files): string => {
  const read = selected.extensions.length === 0 ? 'no files' : `${selected.extensions.map((ext) => `\`${ext}\``).join(', ')} files`;
  const excluded = selected.exclude.length === 0 ? '' : `, excluding ${selected.exclude.map((glob) => `\`${glob}\``).join(', ')}`;
  return `under ${at === '' ? 'the repository root' : `\`${at}\``} over ${read}${excluded}`;
};
