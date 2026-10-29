import { beforeAll } from 'bun:test';
import { join, resolve } from 'node:path';
import { kind, once, open, runKind, shared, own, type Taking } from '@runlith/testbed/worlds';
import { Context, Effect } from 'effect';
import { build, preview } from 'vite';

const bundle = runKind('e2e/StandBundle', (configFile: string, directory: string) =>
  Effect.promise(async () => {
    const outDir = join(directory, 'surface');
    await build({ configFile, logLevel: 'warn', build: { outDir, emptyOutDir: true } });
    return outDir;
  }),
);

const makeStand = Effect.fn('e2e.stand')(function* (configFile: string) {
  const { value: outDir } = yield* once(bundle, configFile);
  const served = yield* Effect.acquireRelease(
    Effect.promise(() =>
      preview({ configFile, build: { outDir }, preview: { host: '127.0.0.1', port: 0, open: false }, logLevel: 'error' }),
    ),
    (server) => Effect.promise(() => server.close()),
  );
  served.httpServer.unref();
  const address = served.httpServer.address();
  if (address === null || typeof address === 'string') return yield* Effect.die(new Error('the stand opened no loopback socket'));
  const origin = `http://127.0.0.1:${address.port}`;
  return { url: (path = '/') => new URL(path, origin).href };
});

class ServedStand extends Context.Service<ServedStand, Effect.Success<ReturnType<typeof makeStand>>>()('e2e/Stand') {}
const servedStand = kind(ServedStand, (configFile: string) => makeStand(configFile));

export const serveStand = (configFile: string, taking: Taking = {}) =>
  taking.own === undefined ? shared(servedStand, resolve(configFile)) : own(servedStand, resolve(configFile), taking.own);

export type Stand = { readonly url: (path?: string) => string };

export const stand = (configFile: string): Stand => {
  let served: Stand | undefined;
  beforeAll(async () => {
    served = await open(servedStand, resolve(configFile));
  });
  return {
    url: (path) => {
      if (served === undefined) throw new Error('the stand is not serving before its build hook');
      return served.url(path);
    },
  };
};
