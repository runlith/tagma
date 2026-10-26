import { Schema } from 'effect';

const segment = String.raw`(?!\.{1,2}(?:/|$))[^/\\]+`;
const path = `${segment}(?:/${segment})*`;

export const entry = Schema.String.check(Schema.isPattern(new RegExp(`^${path}/?$`))).annotate({
  description: 'A directory (ending in `/`) or a file, relative to `base`.',
});

export const base = Schema.String.check(Schema.isPattern(new RegExp(`^(?:${path})?$`))).annotate({
  description:
    'The directory the entries are relative to, from the repository root, with no leading or trailing `/`; empty for the root itself.',
});

export const filesOf = <const E extends readonly string[]>(extensions: E) =>
  Schema.Struct({
    extensions: Schema.Array(Schema.Literals(extensions)).annotate({
      description: 'The file extensions read; a changed file with any other is neither read nor failed.',
    }),
    exclude: Schema.Array(Schema.NonEmptyString).annotate({
      description: 'Glob patterns matched against the path relative to `base`; a matching file is neither read nor failed.',
    }),
  });

type Files = { readonly extensions: readonly string[]; readonly exclude: readonly string[] };

export const bare = (entry: string): string => entry.replace(/\/$/, '');

export const distinct = (entries: readonly string[]): boolean => new Set(entries.map(bare)).size === entries.length;

export const within = (part: readonly string[], whole: readonly string[]): boolean => part.every((one) => whole.includes(one));

export const sameSet = (left: readonly string[], right: readonly string[]): boolean => within(left, right) && within(right, left);

export const filesTighten = (was: Files, now: Files): boolean => within(was.extensions, now.extensions) && within(now.exclude, was.exclude);

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
