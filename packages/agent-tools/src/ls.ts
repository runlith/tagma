import { join } from 'node:path';
import { Effect, FileSystem, Schema } from 'effect';
import { Tool } from '@runlith/agent/tool';
import {
  PAGE_CURSOR,
  carriedSelection,
  keyOrder,
  page,
  pageRows,
  pastKey,
  readCursor,
  walkQuestion,
  type PageDirection,
  type PageKey,
} from '@runlith/paging';
import { ToolFailed } from '@runlith/agent/tool';
import { runToolEffect, unboundTool } from './ToolEdge';
import type { PreparedPath, ToolFactoryOptions } from './workspace';
import { admitPreparedPath, pathClaims, pathPreparation, resolveToolOptions } from './workspace/runtime';
import { displayCount, displayPath } from './display';
import { orAbsent } from './namespace';
import { missingPath } from './missingPath';
import { REFUSALS, refused } from './refusals';
import { LISTING, LS_WALK, ceilingOf, limitOf } from './pageFamilies';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '@runlith/agent/permissions';

const LS_CEILING = ceilingOf(LISTING);

const LISTING_DIRECTIONS: readonly PageDirection[] = ['asc'];

const entryKey = (entry: string): PageKey => [entry];

const entryOrder = keyOrder(LISTING_DIRECTIONS);

const refuseCursor = (cursor: 'bad-cursor' | 'cursor-stale'): ToolFailed =>
  refused(
    cursor,
    cursor === 'cursor-stale'
      ? 'this cursor was minted by another reading; call ls with no cursor to open a new walk.'
      : 'this is not a cursor ls answered; hand back the cursor a page printed, unchanged, or call with no cursor.',
  );

const parameters = Schema.Struct({
  path: Schema.optional(
    Schema.String.annotate({
      description:
        'Directory to list (relative to workspace root or absolute). Defaults to workspace root. Beside a cursor, an omitted path stays in the listed directory.',
    }),
  ),
  limit: limitOf(LISTING),
  cursor: PAGE_CURSOR,
});

type Args = typeof parameters.Type;

const run = Effect.fn('LsTool.execute')(function* (
  resolved: ReturnType<typeof resolveToolOptions>,
  params: Args,
  prepared: PreparedPath | undefined,
) {
  const fs = yield* FileSystem.FileSystem;
  const target = yield* admitPreparedPath(resolved, prepared, { allowMissing: true });
  const question = walkQuestion(LS_WALK, { path: target });
  const continued = params.cursor === undefined ? undefined : readCursor(params.cursor, question);
  if (continued !== undefined && 'refused' in continued) return yield* refuseCursor(continued.refused);

  const entries = yield* orAbsent(fs.readDirectory(target)).pipe(
    Effect.catchIf(
      (error) => error.reason._tag === 'BadResource',
      () => refused('wrong-kind', `${displayPath(resolved.cwd, target)} is not a directory; read it with the read tool.`),
    ),
  );
  if (entries === undefined) {
    return yield* refused(
      'not-found',
      yield* missingPath(resolved.cwd, target, params.path ?? carriedSelection(LS_WALK, params.cursor)?.path, 'ls path does not exist'),
    );
  }
  const items = yield* Effect.forEach(
    entries,
    (entry) => Effect.map(orAbsent(fs.stat(join(target, entry))), (info) => (info?.type === 'Directory' ? `${entry}/` : entry)),
    { concurrency: 'unbounded' },
  );
  items.sort((a, b) => entryOrder(entryKey(a), entryKey(b)));
  const rest = continued === undefined ? items : pastKey(items, entryKey, LISTING_DIRECTIONS, continued.at);
  const cut = page({
    rows: rest,
    asked: pageRows(params.limit, LISTING, LS_CEILING),
    keyOf: entryKey,
    question,
    total: items.length,
  });
  const tail =
    cut.next === null
      ? `\n(${items.length} entries)`
      : `\n(Showing ${cut.shown} of ${items.length} entries · next: ls(cursor="${cut.next}"))`;
  const output = [`<path>${target}</path>`, '<entries>', cut.rows.join('\n'), tail, '</entries>'].join('\n');
  return new Tool.ToolAnswer(output, {
    form: 'list',
    title: displayPath(resolved.cwd, target),
    items: cut.rows.map((entry) => ({ label: entry })),
    total: items.length,
    facts: [displayCount('entries', items.length)],
  });
});

export function createLsTool(options: ToolFactoryOptions): Tool {
  const resolved = resolveToolOptions(options);
  const { world } = resolved;
  const lsTool = Tool.make({
    approval: ASKS_NEVER,
    description:
      'List directory contents (one entry per line; trailing `/` marks directories), sorted by name. Answers a page; the footer carries the total and the cursor that continues the listing.',
    refusals: REFUSALS,
    parameters,
    display: {
      streamFields: ['path', 'cursor'],
      project: (input) => ({
        form: 'none',
        title: displayPath(resolved.cwd, input.path ?? carriedSelection(LS_WALK, input.cursor)?.path ?? resolved.cwd),
      }),
    },
    prepare: (input) => pathPreparation(resolved, input.path ?? carriedSelection(LS_WALK, input.cursor)?.path, 'read'),
    claims: (input) => pathClaims(resolved, [input.path ?? carriedSelection(LS_WALK, input.cursor)?.path], 'read'),
    execute: (params, call) =>
      world.files === undefined
        ? unboundTool('ls', 'filesystem')
        : runToolEffect('ls', world.files, run(resolved, params, call.prepared), call),
  });
  return lsTool;
}
