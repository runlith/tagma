import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Data, Effect } from 'effect';

class FilesUnread extends Data.TaggedError('FilesUnread')<{ readonly root: string; readonly reason: string }> {}

const VIEWS = 'ui';
const PASSED_OVER = new Set(['node_modules', '.git']);
const IGNORE_FILE = '.gitignore';

type Rule = { readonly glob: Bun.Glob; readonly negated: boolean; readonly anchored: boolean; readonly directories: boolean };

export type CodeFilter = {
  readonly counts: (path: string, directory: boolean) => boolean;
  readonly moves: (path: string) => boolean;
};

const ruleOf = (line: string): Rule | null => {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith('#')) return null;
  const negated = trimmed.startsWith('!');
  const body = negated ? trimmed.slice(1) : trimmed;
  const directories = body.endsWith('/');
  const bare = directories ? body.slice(0, -1) : body;
  const anchored = bare.includes('/');
  const pattern = bare.startsWith('/') ? bare.slice(1) : bare;
  return pattern === '' ? null : { glob: new Bun.Glob(pattern), negated, anchored, directories };
};

const filterOf = (rules: readonly Rule[]): CodeFilter => {
  const ignored = (path: string, directory: boolean): boolean => {
    const name = path.slice(path.lastIndexOf('/') + 1);
    let held = false;
    for (const rule of rules) {
      if (rule.directories && !directory) continue;
      if (rule.glob.match(rule.anchored ? path : name)) held = !rule.negated;
    }
    return held;
  };
  const counts = (path: string, directory: boolean): boolean => {
    const parts = path.split('/');
    if (parts[0] === VIEWS && (parts.length > 1 || directory)) return false;
    if (parts.some((part) => PASSED_OVER.has(part))) return false;
    for (let at = 1; at <= parts.length; at += 1) {
      if (ignored(parts.slice(0, at).join('/'), at < parts.length || directory)) return false;
    }
    return true;
  };
  return { counts, moves: (path) => path === IGNORE_FILE || counts(path, false) };
};

const absent = (error: unknown): boolean => typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';

export const codeFilterOf = (root: string): Effect.Effect<CodeFilter, FilesUnread> =>
  Effect.tryPromise({
    try: async () => {
      const text = await readFile(join(root, IGNORE_FILE), 'utf8').then(
        (read) => read,
        (error: unknown) => {
          if (absent(error)) return '';
          throw error;
        },
      );
      return filterOf(text.split(/\r?\n/u).flatMap((line) => ruleOf(line) ?? []));
    },
    catch: (error) =>
      new FilesUnread({ root, reason: `${IGNORE_FILE} could not be read: ${error instanceof Error ? error.message : String(error)}` }),
  }).pipe(Effect.withSpan('pluginHost.codeFilterOf'));

const walk = async (root: string, at: string, filter: CodeFilter, into: string[]): Promise<void> => {
  const entries = await readdir(join(root, at), { withFileTypes: true });
  for (const entry of entries) {
    const inside = at === '' ? entry.name : `${at}/${entry.name}`;
    if (entry.isDirectory()) {
      if (filter.counts(inside, true)) await walk(root, inside, filter, into);
      continue;
    }
    if (!entry.isFile() || !filter.counts(inside, false)) continue;
    const measured = await stat(join(root, inside));
    into.push(`${inside}\u0000${measured.size}\u0000${measured.mtimeMs}`);
  }
};

export const revisionOf = (root: string, filter: CodeFilter): Effect.Effect<string, FilesUnread> =>
  Effect.tryPromise({
    try: async () => {
      const lines: string[] = [];
      await walk(root, '', filter, lines);
      lines.sort();
      return createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 16);
    },
    catch: (error) =>
      new FilesUnread({ root, reason: `its files could not be read: ${error instanceof Error ? error.message : String(error)}` }),
  }).pipe(Effect.withSpan('pluginHost.revisionOf'));
