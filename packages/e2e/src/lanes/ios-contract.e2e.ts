import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { runRoot } from '@runlith/testbed/fixture';
import { Effect, FileSystem, Layer } from 'effect';
import { join } from 'node:path';
import { cacheDirectory } from './iosTools.ts';
import { prepareSimulator } from './simulator.ts';

const runtime = process.env.E2E_IOS_RUNTIMES?.split(',')[0] ?? '26';
const source = `import { beforeAll, afterAll, expect } from 'bun:test';
import { Schema } from ${JSON.stringify(import.meta.resolve('effect'))};
import { ios } from ${JSON.stringify(import.meta.resolve('@runlith/e2e/ios'))};
let server;
beforeAll(() => { server = Bun.serve({hostname:'127.0.0.1',port:0,fetch(request) {
  const script = new URL(request.url).pathname === '/exception'
    ? "setTimeout(() => { throw new Error('native exception marker'); }, 0)"
    : "Promise.reject(new Error('native rejection marker'))";
  return new Response('<!doctype html><title>Page errors</title><script>'+script+'</script><p>Ready</p>', {headers:{'content-type':'text/html'}});
}}); });
afterAll(async () => { await server.stop(true); });
for (const path of ['exception','rejection']) ios(path, async phone => {
  await phone.open(new URL(path, server.url).href);
  expect(await phone.evaluate('document.title', Schema.String)).toBe('Page errors');
}, {runtimes:[${JSON.stringify(runtime)}]});
`;

if (process.env.E2E_LANES === undefined || process.env.E2E_LANES.split(',').includes('ios')) {
  layer(Layer.effectDiscard(prepareSimulator({ runtime })), { excludeTestServices: true })('native page failures', (it) => {
    it.effect('the iOS registrar fails on actual page Errors and unhandled Error rejections', () =>
      Effect.gen(function* () {
        const files = yield* FileSystem.FileSystem;
        const directory = yield* files.makeTempDirectoryScoped({ prefix: 'ios-errors-' });
        const path = join(directory, 'page-errors.e2e.ts');
        yield* files.writeFileString(path, source);
        const builds = yield* cacheDirectory();
        const root = runRoot();
        if (root === undefined) return yield* Effect.die(new Error('native conformance requires a testbed run root'));
        const result = yield* Effect.tryPromise(async (signal) => {
          const child = Bun.spawn(
            [join(import.meta.dir, '../../../../node_modules/.bin/testbed'), 'e2e', '--no-isolate', '--parallel=1', path],
            {
              cwd: join(import.meta.dir, '../..'),
              env: {
                ...process.env,
                E2E_LANES: 'ios',
                E2E_IOS_BUILDS: builds,
                RUNLITH_TEST_RUN_ROOT: root,
                RUNLITH_TEST_REPORT: join(directory, 'child.jsonl'),
              },
              stdout: 'pipe',
              stderr: 'pipe',
              signal,
            },
          );
          const collect = async (stream: ReadableStream<Uint8Array>, output: NodeJS.WriteStream) => {
            const chunks: Uint8Array[] = [];
            for await (const chunk of stream) {
              output.write(chunk);
              chunks.push(chunk);
            }
            return Buffer.concat(chunks).toString();
          };
          const [stdout, stderr, code] = await Promise.all([
            collect(child.stdout, process.stdout),
            collect(child.stderr, process.stderr),
            child.exited,
          ]);
          return { code, output: stdout + stderr };
        });
        expect(result.code).toBe(1);
        expect(result.output).toMatch(/PageFailed:[^\n]*native exception marker/);
        expect(result.output).toMatch(/PageFailed:[^\n]*native rejection marker/);
      }).pipe(Effect.provide(BunFileSystem.layer)),
    );
  });
}
