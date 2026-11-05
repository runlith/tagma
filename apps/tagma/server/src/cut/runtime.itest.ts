import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Exit } from 'effect';
import { releaseRuntime } from './runtime.js';

const name = 'bun-darwin-x64';

it.live(
  "a release carries the official Bun of its target at the checkout's packageManager version, read from its origin once and known offline after",
  () =>
    Effect.gen(function* () {
      const scratch = yield* Effect.acquireRelease(
        Effect.sync(() => realpathSync(mkdtempSync(join(tmpdir(), 'tagma-runtime-')))),
        (path) => Effect.sync(() => rmSync(path, { recursive: true, force: true })),
      );
      mkdirSync(join(scratch, name));
      writeFileSync(join(scratch, name, 'bun'), 'the official binary\n');
      expect(Bun.spawnSync(['/usr/bin/zip', '-q', '-r', `${name}.zip`, name], { cwd: scratch }).exitCode).toBe(0);
      const zip = readFileSync(join(scratch, `${name}.zip`));
      const sums = `${createHash('sha256').update(zip).digest('hex')}  ${name}.zip\n`;
      let served = 0;
      const origin = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            hostname: '127.0.0.1',
            port: 0,
            fetch: (request) => {
              const path = new URL(request.url).pathname;
              served += 1;
              if (path === '/bun-v1.2.3/SHASUMS256.txt') return new Response(sums);
              if (path === `/bun-v1.2.3/${name}.zip`) return new Response(zip);
              return new Response('Not Found', { status: 404 });
            },
          }),
        ),
        (server) => Effect.sync(() => void server.stop(true)),
      );
      const checkout = join(scratch, 'checkout');
      mkdirSync(checkout);
      writeFileSync(join(checkout, 'package.json'), JSON.stringify({ packageManager: 'bun@1.2.3' }));
      const cache = join(scratch, 'cache');
      const at = `http://127.0.0.1:${origin.port}`;
      const carried = yield* releaseRuntime(checkout, '1.2.3', name, cache, at);
      const asked = served;
      const offline = yield* releaseRuntime(checkout, '1.2.3', name, cache, 'http://127.0.0.1:1');
      const elsewhere = yield* Effect.exit(releaseRuntime(checkout, '1.2.4', name, cache, at));

      expect(readFileSync(carried, 'utf8')).toBe('the official binary\n');
      expect(asked).toBe(2);
      expect(offline).toBe(carried);
      expect(Exit.isFailure(elsewhere)).toBe(true);
    }),
);
