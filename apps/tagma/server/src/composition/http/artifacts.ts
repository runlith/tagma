import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerResponse } from 'effect/http';
import type { ArtifactStore } from '../../artifacts/contract/service/shelf.js';
import type { ArtifactRecord } from '../../artifacts/contract/wire/artifacts.js';
import { pagePolicy } from '../../artifacts/contract/wire/policy.js';
import { readShelfCursor, shelfCursor } from '../../artifacts/cursor.js';
import { ARTIFACT_PREFIX } from '../../http/contract/wire/served.js';
import { rangedFile } from './ranged.js';

const VERSION_CACHE = 'private, max-age=31536000, immutable';

export type ArtifactDoor = {
  readonly index: '/' | typeof ARTIFACT_PREFIX;
  readonly sandboxed: boolean;
};

export const artifactRoutes = (store: ArtifactStore['Service'], door: ArtifactDoor) => {
  const policy = pagePolicy(door.sandboxed);
  const page = (html: string, status = 200, cache = 'no-store') =>
    HttpServerResponse.text(html, { status, contentType: 'text/html; charset=utf-8' }).pipe(
      HttpServerResponse.setHeaders({
        'content-security-policy': policy,
        'cache-control': cache,
        'referrer-policy': 'no-referrer',
      }),
    );
  const missing = page(
    '<!doctype html><meta charset="utf-8"><title>Not here</title><body style="font:14px system-ui;padding:2rem">No such page.',
    404,
  );
  const shelf = Effect.fnUntraced(
    function* (request: { readonly url: string }) {
      const cursor = new URL(request.url, 'http://localhost').searchParams.get('cursor') ?? undefined;
      const after = yield* readShelfCursor(cursor);
      const listed = yield* store.list({ limit: 50, after });
      const last = listed.rows[listed.rows.length - 1];
      const next = listed.more && last !== undefined ? `?cursor=${encodeURIComponent(shelfCursor(last.key))}` : null;
      return page(
        indexPage(
          listed.rows.map((row) => row.record),
          listed.total,
          next,
        ),
      );
    },
    Effect.catchTag('GateRefusal', (failure) =>
      Effect.succeed(
        page(
          `<!doctype html><meta charset="utf-8"><title>Artifacts</title><p>${escaped(failure.reason)}</p><a href="${door.index}">Open the shelf again</a>`,
          failure.code === 'cursor-stale' ? 409 : 400,
        ),
      ),
    ),
  );
  const pages = HttpRouter.add('GET', `${ARTIFACT_PREFIX}*`, (request) => {
    const path = new URL(request.url, 'http://localhost').pathname.split('/').filter((part) => part.length > 0);
    const [, id, marker, version, name, ...rest] = path;
    if (id === undefined && door.index === ARTIFACT_PREFIX) return shelf(request);
    if (id === undefined || (marker !== undefined && marker !== 'v') || rest.length > 0) return Effect.succeed(missing);
    if (name !== undefined) {
      const file = version === undefined ? null : store.videoFile(id, version, name);
      return file === null ? Effect.succeed(missing) : video(file, `${id}-${version}-${name}`, request.headers.range, missing);
    }
    const pinned = marker === 'v' ? version : undefined;
    return Effect.map(store.page(id, pinned), (found) =>
      found === null ? missing : pinned === undefined ? page(found.html) : page(found.html, 200, VERSION_CACHE),
    );
  });
  return door.index === '/' ? Layer.mergeAll(HttpRouter.add('GET', '/', shelf), pages) : pages;
};

const video = (path: string, download: string, range: string | undefined, missing: HttpServerResponse.HttpServerResponse) =>
  Effect.promise(async () => {
    const file = Bun.file(path);
    if (!(await file.exists())) return missing;
    return rangedFile(file, file.size, range, {
      'content-type': 'video/mp4',
      'content-disposition': `attachment; filename="${download}"`,
      'cache-control': VERSION_CACHE,
    });
  });

function indexPage(records: readonly ArtifactRecord[], total: number, next: string | null): string {
  const rows = records
    .map(
      (record) =>
        `<li><a href="${ARTIFACT_PREFIX}${escaped(record.id)}">${escaped(record.title)}</a><span>${escaped(record.publishedAt.slice(0, 16).replace('T', ' '))} · ${record.versions} version${record.versions === 1 ? '' : 's'}</span>${record.description ? `<p>${escaped(record.description)}</p>` : ''}</li>`,
    )
    .join('');
  return `<!doctype html><meta charset="utf-8"><title>Artifacts</title><style>
:root{color-scheme:light dark;--ink:#16181d;--dim:#6b7280;--ground:#fbfbfa;--line:#e6e5e1}
@media (prefers-color-scheme:dark){:root{--ink:#e9e8e4;--dim:#8b8f99;--ground:#151619;--line:#2a2c31}}
body{margin:0;padding:3rem 1.5rem;background:var(--ground);color:var(--ink);font:15px/1.5 ui-sans-serif,system-ui,sans-serif}
main{max-width:44rem;margin:0 auto}h1{font-size:1.1rem;letter-spacing:.06em;text-transform:uppercase;color:var(--dim);font-weight:600;margin:0 0 1.5rem}
ul{list-style:none;margin:0;padding:0}li{padding:.9rem 0;border-top:1px solid var(--line);display:grid;gap:.2rem}
a{color:inherit;text-decoration:none;font-weight:600}a:hover{text-decoration:underline}
span{color:var(--dim);font-size:.8rem;font-variant-numeric:tabular-nums}p{margin:.15rem 0 0;color:var(--dim);font-size:.85rem}
</style><body><main><h1>Artifacts · ${total}</h1>${rows ? `<ul>${rows}</ul>` : '<p>Nothing published yet.</p>'}${next === null ? '' : `<a href="${escaped(next)}">Next</a>`}</main>`;
}

function escaped(value: string): string {
  return value.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`);
}
