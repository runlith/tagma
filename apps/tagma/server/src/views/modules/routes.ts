import { extname } from 'node:path';
import { Context, Effect } from 'effect';
import { HttpServerResponse } from 'effect/http';
import { route } from '../../platform/contract/service/route.js';
import { ViewFiles } from '../contract/service/places.js';
import { MODULES_PATH, SHEET_PATH } from '../contract/wire/modules.js';
import { CANDIDATES_PATH, type Candidates } from '../contract/wire/utilities.js';

const PART = /^(?!\.{1,2}$)[A-Za-z0-9_@.+-]+$/u;

const KEPT = 'private, max-age=31536000, immutable';

const TYPES: Readonly<Record<string, string>> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json',
  '.json': 'application/json',
};

const missing = HttpServerResponse.text('No such file of a plugin view.', { status: 404 });

const served = (path: string | null) =>
  Effect.promise(async () => {
    const file = path === null ? null : Bun.file(path);
    if (file === null || !(await file.exists())) return missing;
    return HttpServerResponse.raw(file, {
      contentType: TYPES[extname(path!)] ?? (file.type || 'application/octet-stream'),
      headers: { 'cache-control': KEPT, 'x-content-type-options': 'nosniff' },
    });
  });

const parts = (...named: readonly (string | undefined)[]): readonly string[] | null =>
  named.every((part): part is string => part !== undefined && PART.test(part)) ? named : null;

export const VIEW_ROUTES = [
  route<ViewFiles>({
    path: `${MODULES_PATH}/:plugin/:key/:file`,
    handler: (door) => {
      const files = Context.get(door, ViewFiles);
      return ({ params }) => {
        const asked = parts(params.plugin, params.key, params.file);
        return served(asked === null ? null : files.module(asked[0]!, asked[1]!, asked[2]!));
      };
    },
  }),
  route<ViewFiles>({
    path: `${SHEET_PATH}/:file`,
    handler: (door) => {
      const files = Context.get(door, ViewFiles);
      return ({ params }) => {
        const asked = parts(params.file);
        return served(asked === null ? null : files.sheet(asked[0]!));
      };
    },
  }),
  route<ViewFiles>({
    path: CANDIDATES_PATH,
    handler: (door) => {
      const files = Context.get(door, ViewFiles);
      return () =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe({ candidates: files.candidates() } satisfies Candidates, {
            headers: { 'cache-control': 'no-store' },
          }),
        );
    },
  }),
];
