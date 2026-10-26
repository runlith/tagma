import * as path from 'node:path';
import { Effect, FileSystem, Layer, Option, Schema } from 'effect';
import { Tool, ToolFailed } from '@runlith/agent/tool';
import { PAGE_CURSOR, offsetPage, pageRows, readOffsetCursor, resumeOffset, type PageFamily, type PageQuestion } from '@runlith/paging';
import { runToolEffect, unboundTool } from './ToolEdge';
import { collected, folded, searchRun } from './search';
import { countMatches, matchingFiles, searchContent, type ContentQuery } from '@runlith/ripgrep/run';
import type { PreparedPath, ToolFactoryOptions } from './workspace';
import { admitPreparedPath, pathClaims, pathPreparation, resolveToolOptions } from './workspace/runtime';
import { displayPath, pageWindow, searchCount, searchedIn } from './display';
import { orAbsent } from './namespace';
import { missingPath } from './missingPath';
import { REFUSALS, refused } from './refusals';
import { DESCRIPTION_GREP } from './descriptions';
import { GREP_COUNTS, GREP_FILES, GREP_LINES, ceilingOf } from './pageFamilies';
import { ASKS_NEVER } from '@runlith/agent/permissions';
import { TOOL_OUTPUT_MAX_BYTES } from '@runlith/agent/ToolOutputSpool';

const MAX_LINE_LENGTH = 2000;
const FOOTER_BYTES = 512;
const CONTENT_BUDGET = TOOL_OUTPUT_MAX_BYTES - FOOTER_BYTES;
const STAT_CONCURRENCY = 64;

const MODES = ['content', 'files_with_matches', 'count'] as const;
type Mode = (typeof MODES)[number];

const FAMILY: Readonly<Record<Mode, PageFamily>> = { content: GREP_LINES, files_with_matches: GREP_FILES, count: GREP_COUNTS };
const CEILING: Readonly<Record<Mode, number>> = {
  content: ceilingOf(GREP_LINES),
  files_with_matches: ceilingOf(GREP_FILES),
  count: ceilingOf(GREP_COUNTS),
};
const LIMIT_CEILING = Math.max(...Object.values(CEILING));

const count = (description: string) => Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate({ description }));
const flag = (description: string) => Schema.optional(Schema.Boolean.annotate({ description }));

const grepInputSchema = Schema.Struct({
  pattern: Schema.String.check(Schema.isMinLength(1)).annotate({
    description: 'The regular expression pattern to search for in file contents',
  }),
  path: Schema.optional(
    Schema.String.annotate({ description: 'File or directory to search in (rg PATH). Defaults to the current working directory.' }),
  ),
  glob: Schema.optional(
    Schema.String.annotate({ description: 'Glob pattern to filter files (e.g. "*.js", "*.{ts,tsx}") - maps to rg --glob' }),
  ),
  type: Schema.optional(
    Schema.String.annotate({
      description: 'File type to search (rg --type), e.g. js, py, rust, go. More efficient than glob for standard file types.',
    }),
  ),
  output_mode: Schema.optional(
    Schema.Literals(MODES).annotate({
      description:
        'Output mode: "content" shows matching lines (supports before/after/context lines and line_numbers), "files_with_matches" shows file paths, "count" shows match counts per file. Defaults to "files_with_matches".',
    }),
  ),
  before: count('Number of lines to show before each match (rg -B). Requires output_mode: "content", ignored otherwise.'),
  after: count('Number of lines to show after each match (rg -A). Requires output_mode: "content", ignored otherwise.'),
  context: count('Number of lines to show before and after each match (rg -C). Requires output_mode: "content", ignored otherwise.'),
  line_numbers: flag('Show line numbers in output (rg -n). Requires output_mode: "content", ignored otherwise. Defaults to true.'),
  ignore_case: flag('Case insensitive search (rg -i)'),
  multiline: flag('Enable multiline mode where . matches newlines and patterns can span lines (rg -U --multiline-dotall). Default: false.'),
  limit: Schema.optional(
    Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(LIMIT_CEILING)).annotate({
      description: `How many rows to answer — output lines in content mode, file paths or counts otherwise: by default ${pageRows(undefined, GREP_LINES, CEILING.content)} lines or ${pageRows(undefined, GREP_FILES, CEILING.files_with_matches)} files, at most ${CEILING.content} lines or ${CEILING.files_with_matches} files. The answer ends with the total; a cut one adds the cursor that continues it.`,
    }),
  ),
  cursor: PAGE_CURSOR,
});

type Params = typeof grepInputSchema.Type;

type Search = {
  readonly resolved: ReturnType<typeof resolveToolOptions>;
  readonly root: string;
  readonly query: ContentQuery;
};

type Hit = { readonly path: string; readonly line: number; readonly text: string; readonly match: boolean };

const hitKey = (hit: Hit): string => `${hit.path}:${hit.line}`;

const REFUSED = {
  'cursor-stale': {
    code: 'cursor-stale',
    reason: 'this cursor belongs to another search; repeat the call that printed it with only the cursor added, or call with no cursor.',
  },
  moved: { code: 'cursor-stale', reason: 'the results changed since that page was answered; call again with no cursor.' },
  'bad-cursor': {
    code: 'bad-cursor',
    reason: 'this is not a cursor grep printed; hand back the cursor a cut answer printed, unchanged, or call with no cursor.',
  },
} as const;

const refuseCursor = (cursor: keyof typeof REFUSED): ToolFailed => refused(REFUSED[cursor].code, REFUSED[cursor].reason);

const absoluteIn = (root: string, found: string): string => path.resolve(root, found);

const mtimes = Effect.fn('GrepTool.mtimes')(function* (paths: readonly string[]) {
  const fs = yield* FileSystem.FileSystem;
  const times = new Map<string, number>();
  yield* Effect.forEach(
    paths,
    (filePath) =>
      Effect.map(orAbsent(fs.stat(filePath)), (info) => {
        if (info === undefined || info.type === 'Directory') return;
        times.set(
          filePath,
          Option.getOrElse(
            Option.map(info.mtime, (date) => date.getTime()),
            () => 0,
          ),
        );
      }),
    { concurrency: STAT_CONCURRENCY, discard: true },
  );
  return times;
});

const newestFirst = Effect.fn('GrepTool.newestFirst')(function* (paths: readonly string[]) {
  const times = yield* mtimes(paths);
  return paths.filter((one) => times.has(one)).sort((a, b) => (times.get(b) ?? 0) - (times.get(a) ?? 0) || (a < b ? -1 : a > b ? 1 : 0));
});

const files = Effect.fn('GrepTool.files')(function* (search: Search) {
  const run = yield* searchRun(search.resolved.world, search.root, search.resolved.searchMs);
  const events = yield* collected(matchingFiles(run, search.query));
  const found = [...new Set(events.flatMap((event) => (event._tag === 'Listed' ? [absoluteIn(search.root, event.path)] : [])))];
  return { paths: yield* newestFirst(found), partial: events.some((event) => event._tag === 'Summary' && event.partial) };
});

const counts = Effect.fn('GrepTool.counts')(function* (search: Search) {
  const run = yield* searchRun(search.resolved.world, search.root, search.resolved.searchMs);
  const events = yield* collected(countMatches(run, search.query));
  const tally = new Map<string, number>();
  for (const event of events) if (event._tag === 'Counted') tally.set(absoluteIn(search.root, event.path), event.count);
  const paths = yield* newestFirst([...tally.keys()]);
  return {
    rows: paths.map((one) => ({ path: one, count: tally.get(one) ?? 0 })),
    partial: events.some((event) => event._tag === 'Summary' && event.partial),
  };
});

type Folded = {
  readonly byFile: Map<string, { readonly lines: Map<number, Hit>; matches: number }>;
  partial: boolean;
};

const shownText = (text: string): string => (text.length > MAX_LINE_LENGTH ? `${text.substring(0, MAX_LINE_LENGTH)}...` : text.trimEnd());

const hits = Effect.fn('GrepTool.hits')(function* (search: Search) {
  const run = yield* searchRun(search.resolved.world, search.root, search.resolved.searchMs);
  const found = yield* folded(
    searchContent(run, search.query),
    (): Folded => ({ byFile: new Map(), partial: false }),
    (state, event) => {
      if (event._tag === 'Summary') state.partial = state.partial || event.partial;
      if (event._tag !== 'Match' && event._tag !== 'Context') return state;
      const path = absoluteIn(search.root, event.path);
      const file = state.byFile.get(path) ?? { lines: new Map<number, Hit>(), matches: 0 };
      state.byFile.set(path, file);
      const match = event._tag === 'Match';
      if (match) file.matches += Math.max(1, event.ranges.length);
      event.text.split('\n').forEach((text, index) => {
        const line = event.line + index;
        if (!match && file.lines.get(line)?.match === true) return;
        file.lines.set(line, { path, line, text: shownText(text), match });
      });
      return state;
    },
  );
  const order = yield* newestFirst([...found.byFile.keys()]);
  return {
    files: order.map((path) => [...(found.byFile.get(path)?.lines.values() ?? [])].sort((a, b) => a.line - b.line)),
    matches: order.reduce((sum, path) => sum + (found.byFile.get(path)?.matches ?? 0), 0),
    partial: found.partial,
  };
});

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

const FILES = ['file', 'files'] as const;

const trailer = (input: {
  readonly from: number;
  readonly shown: number;
  readonly total: number;
  readonly noun: readonly [one: string, many: string];
  readonly extra?: string;
  readonly next: string | null;
  readonly partial: boolean;
}): string => {
  const parts = [`${pageWindow(input.from, input.shown, input.total)} ${input.total === 1 ? input.noun[0] : input.noun[1]}`];
  if (input.extra !== undefined) parts.push(input.extra);
  if (input.partial) parts.push('some paths were inaccessible and skipped');
  if (input.next !== null) parts.push(`cursor="${input.next}"`);
  return `(${parts.join(' · ')})`;
};

const run = Effect.fn('GrepTool.execute')(function* (
  resolved: ReturnType<typeof resolveToolOptions>,
  params: Params,
  ctx: Tool.ToolCallOptions<PreparedPath>,
) {
  const fs = yield* FileSystem.FileSystem;
  const target = yield* admitPreparedPath(resolved, ctx.prepared, { allowMissing: true });
  const mode: Mode = params.output_mode ?? 'files_with_matches';
  const content = mode === 'content';
  const before = content ? (params.before ?? params.context ?? 0) : 0;
  const after = content ? (params.after ?? params.context ?? 0) : 0;
  const numbered = content ? (params.line_numbers ?? true) : true;
  const question: PageQuestion = {
    operation: 'grep',
    selection: {
      mode,
      pattern: params.pattern,
      path: target,
      glob: params.glob,
      type: params.type,
      ignoreCase: params.ignore_case === true,
      multiline: params.multiline === true,
      before,
      after,
      numbered,
    },
    order: FAMILY[mode].order,
  };
  const continued = params.cursor === undefined ? undefined : readOffsetCursor(params.cursor, question);
  if (continued !== undefined && 'refused' in continued) return yield* refuseCursor(continued.refused);
  const startOf = <T>(rows: readonly T[], keyOf: (row: T) => string): number | null =>
    continued === undefined ? 0 : resumeOffset(rows, keyOf, continued);

  const info = yield* orAbsent(fs.stat(target));
  if (info === undefined) {
    return yield* refused('not-found', yield* missingPath(resolved.cwd, target, params.path, 'grep path does not exist'));
  }
  const directory = info.type === 'Directory';
  const root = directory ? target : path.dirname(target);
  const search: Search = {
    resolved,
    root,
    query: {
      pattern: params.pattern,
      globs: params.glob === undefined || params.glob === '' ? undefined : [params.glob],
      types: params.type === undefined || params.type === '' ? undefined : [params.type],
      file: directory ? undefined : path.relative(root, target),
      ignoreCase: params.ignore_case === true,
      multiline: params.multiline === true,
      before,
      after,
    },
  };
  const asked = pageRows(params.limit, FAMILY[mode], CEILING[mode]);
  const shownAs = (paths: Iterable<string>) => [...new Set(paths)].map((found) => ({ path: found, as: 'found' as const }));
  const head = { title: params.pattern, subtitle: searchedIn(resolved.cwd, root) };
  const label = (file: string) => displayPath(resolved.cwd, file);

  if (mode === 'files_with_matches') {
    const found = yield* files(search);
    if (found.paths.length === 0) return nothing('No files found', found.partial, head);
    const at = startOf(found.paths, String);
    if (at === null) return yield* refuseCursor('moved');
    const cut = offsetPage({ rows: found.paths, at, asked, question, keyOf: String });
    const text = [
      ...cut.rows.map(label),
      trailer({ from: cut.from, shown: cut.rows.length, total: found.paths.length, noun: FILES, next: cut.next, partial: found.partial }),
    ].join('\n');
    return new Tool.ToolAnswer(
      text,
      {
        form: 'list',
        ...head,
        items: cut.rows.map((file) => ({ label: label(file) })),
        total: found.paths.length,
        facts: [searchCount(null, found.paths.length)],
      },
      { shown: shownAs(cut.rows) },
    );
  }

  if (mode === 'count') {
    const found = yield* counts(search);
    if (found.rows.length === 0) return nothing('No matches found', found.partial, head);
    const matches = found.rows.reduce((sum, row) => sum + row.count, 0);
    const rowKey = (row: { readonly path: string }) => row.path;
    const at = startOf(found.rows, rowKey);
    if (at === null) return yield* refuseCursor('moved');
    const cut = offsetPage({ rows: found.rows, at, asked, question, keyOf: rowKey });
    const text = [
      ...cut.rows.map((row) => `${label(row.path)}:${row.count}`),
      trailer({
        from: cut.from,
        shown: cut.rows.length,
        total: found.rows.length,
        noun: FILES,
        extra: plural(matches, 'match', 'matches'),
        next: cut.next,
        partial: found.partial,
      }),
    ].join('\n');
    return new Tool.ToolAnswer(
      text,
      {
        form: 'list',
        ...head,
        items: cut.rows.map((row) => ({ label: label(row.path), detail: String(row.count) })),
        total: found.rows.length,
        facts: [searchCount(matches, found.rows.length)],
      },
      { shown: shownAs(cut.rows.map((row) => row.path)) },
    );
  }

  const found = yield* hits(search);
  if (found.files.length === 0) return nothing('No matches found', found.partial, head);
  const contexted = before > 0 || after > 0;
  const lines = found.files.flat();
  const { matches } = found;
  const at = startOf(lines, hitKey);
  if (at === null) return yield* refuseCursor('moved');
  const rowText = (hit: Hit): string => {
    const mark = hit.match ? ':' : '-';
    const where = [directory ? label(hit.path) : undefined, numbered ? String(hit.line) : undefined].filter((part) => part !== undefined);
    return where.length === 0 ? hit.text : `${where.join(mark)}${mark}${hit.text}`;
  };
  const window = lines.slice(at, at + asked);
  const rendered: string[] = [];
  let taken = 0;
  for (let bytes = 0; taken < window.length; taken += 1) {
    const hit = window[taken] as Hit;
    const previous = taken === 0 ? undefined : window[taken - 1];
    const apart = contexted && previous !== undefined && (previous.path !== hit.path || hit.line > previous.line + 1);
    const rows = apart ? ['--', rowText(hit)] : [rowText(hit)];
    const size = rows.reduce((sum, row) => sum + Buffer.byteLength(row, 'utf8') + 1, 0);
    if (taken > 0 && bytes + size > CONTENT_BUDGET) break;
    rendered.push(...rows);
    bytes += size;
  }
  const cut = offsetPage({ rows: lines, at, asked: taken, question, keyOf: hitKey });
  const pageHits = cut.rows;
  const text = [
    ...rendered,
    trailer({
      from: cut.from,
      shown: cut.rows.length,
      total: lines.length,
      noun: ['line', 'lines'],
      extra: `${plural(matches, 'match', 'matches')} in ${plural(found.files.length, 'file', 'files')}`,
      next: cut.next,
      partial: found.partial,
    }),
  ].join('\n');
  return new Tool.ToolAnswer(
    text,
    {
      form: 'list',
      ...head,
      items: pageHits.flatMap((hit) => (hit.match ? [{ label: `${label(hit.path)}:${hit.line}`, detail: hit.text }] : [])),
      total: lines.length,
      facts: [searchCount(matches, found.files.length)],
    },
    { shown: shownAs(pageHits.map((hit) => hit.path)) },
  );
});

const nothing = (
  said: string,
  partial: boolean,
  head: { readonly title: string; readonly subtitle: string | undefined },
): Tool.ToolAnswer => {
  const text = partial ? `${said}\n(some paths were inaccessible and skipped)` : said;
  return new Tool.ToolAnswer(text, { form: 'list', ...head, items: [], total: 0, facts: [searchCount(0, 0)] });
};

export function createGrepTool(options: ToolFactoryOptions): Tool {
  const resolved = resolveToolOptions(options);
  const { world } = resolved;
  const services = world.files === undefined || world.exec === undefined ? undefined : Layer.mergeAll(world.files, world.exec);
  return Tool.make({
    approval: ASKS_NEVER,
    description: DESCRIPTION_GREP,
    refusals: REFUSALS,
    parameters: grepInputSchema,
    display: {
      streamFields: ['pattern'],
      project: (input) => ({ form: 'none', title: input.pattern, subtitle: searchedIn(resolved.cwd, input.path) }),
    },
    prepare: (input) => pathPreparation(resolved, input.path, 'read'),
    claims: (input) => pathClaims(resolved, [input.path], 'read'),
    execute: (params, ctx) =>
      services === undefined
        ? unboundTool('grep', 'filesystem and process spawner')
        : runToolEffect('grep', services, run(resolved, params, ctx), ctx),
  });
}
