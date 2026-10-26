import { expect } from 'bun:test';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { it } from '@runlith/effect-test';
import { Effect, FileSystem, Result } from 'effect';
import { accountEnvironment } from './environment';
import { HostRefused, installedProgram, openHost } from './host';

it.live(
  'private hosts authenticate, share one account database and close on their stdin leases',
  () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-opencode-host-' });
      const account = join(root, 'account');
      const firstConfig = join(root, 'first');
      const secondConfig = join(root, 'second');
      yield* files.makeDirectory(firstConfig);
      yield* files.makeDirectory(secondConfig);
      const environment: Record<string, string | undefined> = { ...process.env, OPENCODE_DISABLE_MODELS_FETCH: 'true' };
      for (const entry of accountEnvironment(account)) environment[entry.name] = entry._tag === 'Set' ? entry.value : undefined;
      const config = {
        content: JSON.stringify({
          snapshots: false,
          formatter: false,
          lsp: false,
          update: 'disable',
          share: 'disabled',
          warming: false,
          compaction: { auto: false },
        }),
        project: false,
        claude: false,
      } as const;
      let stderr = '';
      const request = <A>(run: (signal: AbortSignal) => Promise<A>) =>
        Effect.tryPromise({
          try: run,
          catch: (cause) => new HostRefused({ code: 'request-failed', message: `${String(cause)}\n${stderr}` }),
        });
      const refused = yield* Effect.scoped(
        openHost({ program: process.execPath, cwd: root, environment, config: { ...config, directory: firstConfig } }),
      ).pipe(Effect.result);
      expect(Result.isFailure(refused)).toBe(true);
      if (Result.isFailure(refused)) expect(refused.failure.code).toBe('version-unsupported');
      const hosts = yield* Effect.scoped(
        Effect.gen(function* () {
          const first = yield* openHost({
            program: installedProgram(),
            cwd: root,
            environment,
            config: { ...config, directory: firstConfig },
            onStderr: (chunk) => {
              stderr += chunk;
            },
          });
          const info = yield* request((signal) => first.client.server.info({ signal }));
          expect(info.version).toBe('2.1.3');
          const canonical = yield* files.realPath(firstConfig);
          expect(info.paths.tmp.startsWith(`${canonical}/`)).toBe(true);
          const unauthorized = yield* Effect.tryPromise(() => fetch(`${first.endpoint}api/server/info`));
          expect(unauthorized.status).toBe(401);
          const session = yield* request((signal) =>
            first.client.session.create({ location: { directory: root }, title: 'boundary session' }, { signal }),
          );
          const second = yield* openHost({
            program: installedProgram(),
            cwd: root,
            environment,
            config: { ...config, directory: secondConfig },
            onStderr: (chunk) => {
              stderr += chunk;
            },
          });
          expect(first.endpoint).not.toBe(second.endpoint);
          const restored = yield* request((signal) => second.client.session.get({ sessionID: session.id }, { signal }));
          expect(restored.id).toBe(session.id);
          expect((yield* request((signal) => first.client.session.get({ sessionID: session.id }, { signal }))).id).toBe(session.id);
          return [first, second];
        }),
      );
      for (const host of hosts) expect(yield* host.exit).toBe(0);
    }).pipe(Effect.provide(BunFileSystem.layer)),
  60_000,
);
