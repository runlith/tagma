import { Effect, Schema } from 'effect';
import { Command, Flag } from 'effect/cli';
import { print, noting, refusalOf } from '../../platform/cli/verb.js';
import type { ArtifactsCli } from '../cli.js';
import { ARTIFACT_OPERATIONS } from '../contract/wire/operations.js';
import type { ArtifactRecord } from '../contract/wire/artifacts.js';

const json = Flag.Boolean('json').pipe(Flag.withDescription('machine-readable output'), Flag.withDefault(false));

const readPage = Schema.decodeUnknownResult(ARTIFACT_OPERATIONS.list_artifacts.answer);

const retryWalk = Symbol();

export const artifactsList = ({ ask }: ArtifactsCli) =>
  Command.make('artifacts', { json }, (o) =>
    Effect.gen(function* () {
      const rows: ArtifactRecord[] = [];
      let cursor: string | undefined = undefined;
      let restarted = false;
      for (;;) {
        const performed = yield* ask((door, at) =>
          door.operations.perform({
            params: { id: 'list_artifacts' },
            query: { cwd: at.cwd },
            headers: {},
            payload: cursor === undefined ? {} : { cursor },
          }),
        ).pipe(
          Effect.catch((failure) => {
            if (!restarted && refusalOf(failure)?.code === 'cursor-stale') {
              restarted = true;
              rows.length = 0;
              cursor = undefined;
              return Effect.succeed(retryWalk);
            }
            return Effect.fail(failure);
          }),
        );
        if (performed === retryWalk) continue;
        const decoded = readPage(performed);
        if (decoded._tag !== 'Success' || decoded.success.status !== 'listed' || !Array.isArray(decoded.success.artifacts)) {
          return yield* Effect.fail(new Error('list_artifacts answered outside its listed shape'));
        }
        rows.push(...decoded.success.artifacts);
        const next: unknown = decoded.success.next;
        if (next === null) break;
        if (typeof next !== 'string') {
          return yield* Effect.fail(new Error('list_artifacts answered outside its listed shape'));
        }
        cursor = next;
      }
      yield* print(o.json ? { artifacts: rows } : artifactsText(rows), o.json);
    }),
  ).pipe(
    Command.withDescription('the pages this server hosts, newest publish first'),
    noting(`A page is one self-contained file: the same bytes open from disk and can be sent to somebody as they are.
The path a row prints is where that file lives — republishing it replaces the page and keeps the URL.`),
  );

function artifactsText(rows: readonly ArtifactRecord[]): string {
  if (rows.length === 0) return 'no pages published yet';
  return rows.map(artifactLine).join('\n');
}

function artifactLine(row: ArtifactRecord): string {
  const versions = row.versions === 1 ? '' : ` · ${row.versions} versions`;
  const head = `${row.title} — ${row.url}`;
  const facts = `  ${row.publishedAt.slice(0, 16).replace('T', ' ')}${versions} · ${row.sourcePath}`;
  return row.description === null ? `${head}\n${facts}` : `${head}\n  ${row.description}\n${facts}`;
}
