import * as path from 'node:path';
import { Effect, FileSystem, Layer, Option, Schema } from 'effect';
import { Tool } from '@runlith/agent/tool';
import { toolPage } from '@runlith/agent/ToolPage';
import {
  PAGE_CURSOR,
  carriedSelection,
  keyOrder,
  page,
  pageRows,
  pastKey,
  readCursor,
  recallSelection,
  walkQuestion,
  type PageDirection,
  type PageKey,
} from '@runlith/paging';
import { ToolFailed } from '@runlith/agent/tool';
import { runToolEffect, unboundTool } from './ToolEdge';
import { collected, searchRun } from './search';
import { listFiles } from '@runlith/ripgrep/run';
import type { PreparedPath, ToolFactoryOptions } from './workspace';
import { admitPreparedPath, pathClaims, pathPreparation, resolveToolOptions } from './workspace/runtime';
import { searchedIn } from './display';
import { orAbsent } from './namespace';
import { missingPath } from './missingPath';
import { REFUSALS, refused } from './refusals';
import { DESCRIPTION_GLOB } from './descriptions';
import { GLOB, GLOB_WALK, ceilingOf, limitOf } from './pageFamilies';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '@runlith/agent/permissions';

const GLOB_CEILING = ceilingOf(GLOB);
const STAT_CONCURRENCY = 64;

const GLOB_DIRECTIONS: readonly PageDirection[] = ['desc', 'asc'];

type TimedFile = { readonly path: string; readonly mtime: number };

const globKey = (file: TimedFile): PageKey => [file.mtime, file.path];

const globOrder = keyOrder(GLOB_DIRECTIONS);

const refuseCursor = (cursor: 'bad-cursor' | 'cursor-stale'): ToolFailed =>
  refused(
    cursor,
    cursor === 'cursor-stale'
      ? 'this cursor was minted by another reading; call glob with no cursor to open a new walk.'
      : 'this is not a cursor glob answered; hand back the cursor a page printed, unchanged, or call with no cursor.',
  );

const globInputSchema = Schema.Struct({
  pattern: Schema.optional(
    Schema.String.annotate({
      description: 'The glob pattern to match files against. Omit it only beside the cursor a page printed.',
    }),
  ),
  path: Schema.optional(
    Schema.String.annotate({
      description:
        'The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter "undefined" or "null" - simply omit it for the default behavior. Must be a valid directory path if provided. Beside a cursor, an omitted path stays in the directory that walk searched.',
    }),
  ),
  limit: limitOf(GLOB),
  cursor: PAGE_CURSOR,
});

type Params = typeof globInputSchema.Type;

const rgFiles = Effect.fn('GlobTool.rgFiles')(function* (resolved: ReturnType<typeof resolveToolOptions>, cwd: string, pattern: string) {
  const search = yield* searchRun(resolved.world, cwd, resolved.searchMs);
  const events = yield* collected(listFiles(search, pattern));
  const paths = events.flatMap((event) => (event._tag === 'Listed' ? [event.path] : []));
  return { paths, partial: events.some((event) => event._tag === 'Summary' && event.partial) };
});

const run = Effect.fn('GlobTool.execute')(function* (
  resolved: ReturnType<typeof resolveToolOptions>,
  params: Params,
  ctx: Tool.ToolCallOptions<PreparedPath>,
) {
  const fs = yield* FileSystem.FileSystem;
  const search = yield* admitPreparedPath(resolved, ctx.prepared, { allowMissing: true });

  const carried = params.pattern === undefined && params.cursor !== undefined ? recallSelection(GLOB_WALK, params.cursor) : undefined;
  if (carried !== undefined && 'refused' in carried) return yield* refuseCursor(carried.refused);
  const pattern = params.pattern ?? carried?.selection.pattern;
  if (pattern === undefined) return yield* refused('call-shape', 'pattern is required');
  const question = walkQuestion(GLOB_WALK, { pattern, path: search });
  const continued = params.cursor === undefined ? undefined : readCursor(params.cursor, question);
  if (continued !== undefined && 'refused' in continued) return yield* refuseCursor(continued.refused);

  const info = yield* orAbsent(fs.stat(search));
  if (info === undefined) {
    return yield* refused(
      'not-found',
      yield* missingPath(resolved.cwd, search, params.path ?? carriedSelection(GLOB_WALK, params.cursor)?.path, 'glob path does not exist'),
    );
  }
  if (info.type !== 'Directory') {
    return yield* refused('wrong-kind', `glob path must be a directory: ${search}`);
  }

  const walk = yield* rgFiles(resolved, search, pattern);
  const relPaths = walk.paths;
  const files = yield* Effect.forEach(
    relPaths,
    (rel) => {
      const full = path.resolve(search, rel);
      return Effect.map(orAbsent(fs.stat(full)), (info) =>
        info === undefined
          ? undefined
          : {
              path: full,
              mtime: Option.getOrElse(
                Option.map(info.mtime, (date) => date.getTime()),
                () => 0,
              ),
            },
      );
    },
    { concurrency: STAT_CONCURRENCY },
  ).pipe(Effect.map((timed) => timed.filter((file) => file !== undefined)));
  files.sort((a, b) => globOrder(globKey(a), globKey(b)));

  const rest = continued === undefined ? files : pastKey(files, globKey, GLOB_DIRECTIONS, continued.at);
  const cut = page({
    rows: rest,
    asked: pageRows(params.limit, GLOB, GLOB_CEILING),
    keyOf: globKey,
    question,
    total: files.length,
    reason: walk.partial ? 'partial-walk' : undefined,
  });
  const skipped = 'some paths were inaccessible and skipped';
  return toolPage({
    rows: cut.rows.map((file) => ({ label: file.path })),
    total: files.length,
    order: 'newest first',
    note: walk.partial ? skipped : undefined,
    next: cut.next === null ? undefined : `glob(cursor="${cut.next}")`,
    empty: continued === undefined ? (walk.partial ? `No files found\n${skipped}` : 'No files found') : 'No files past this cursor',
    title: pattern,
    subtitle: searchedIn(resolved.cwd, search),
  });
});

export function createGlobTool(options: ToolFactoryOptions): Tool {
  const resolved = resolveToolOptions(options);
  const { world } = resolved;
  const services = world.files === undefined || world.exec === undefined ? undefined : Layer.mergeAll(world.files, world.exec);
  const globTool = Tool.make({
    approval: ASKS_NEVER,
    description: DESCRIPTION_GLOB,
    refusals: REFUSALS,
    parameters: globInputSchema,
    display: {
      streamFields: ['pattern', 'cursor'],
      project: (input) => ({
        form: 'none',
        title: input.pattern ?? carriedSelection(GLOB_WALK, input.cursor)?.pattern,
        subtitle: searchedIn(resolved.cwd, input.path ?? carriedSelection(GLOB_WALK, input.cursor)?.path),
      }),
    },
    prepare: (input) => pathPreparation(resolved, input.path ?? carriedSelection(GLOB_WALK, input.cursor)?.path, 'read'),
    claims: (input) => pathClaims(resolved, [input.path ?? carriedSelection(GLOB_WALK, input.cursor)?.path], 'read'),
    execute: (params, ctx) =>
      services === undefined
        ? unboundTool('glob', 'filesystem and process spawner')
        : runToolEffect('glob', services, run(resolved, params, ctx), ctx),
  });
  return globTool;
}
