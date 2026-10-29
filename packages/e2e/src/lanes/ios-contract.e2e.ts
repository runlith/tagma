import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { runRoot } from '@runlith/testbed/fixture';
import { Effect, FileSystem, Layer } from 'effect';
import { join } from 'node:path';
import { cacheDirectory } from './iosTools.ts';
import { prepareSimulator } from './simulator.ts';

const runtime = process.env.E2E_IOS_RUNTIMES?.split(',')[0] ?? '26';
const source = (path: 'exception' | 'rejection') => `import { beforeAll, afterAll, expect } from 'bun:test';
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
ios(${JSON.stringify(path)}, async phone => {
  await phone.open(new URL(${JSON.stringify(path)}, server.url).href);
  expect(await phone.evaluate('document.title', Schema.String)).toBe('Page errors');
}, {runtimes:[${JSON.stringify(runtime)}]});
`;

const held = `import { ios } from ${JSON.stringify(import.meta.resolve('@runlith/e2e/ios'))};
const page = '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden}#list{position:absolute;inset:0;overflow:auto}.row{height:80px;border-bottom:1px solid}</style><div id="list"></div><script>const list=document.querySelector("#list");for(let i=0;i<200;i++){const row=document.createElement("div");row.className="row";list.append(row)}list.scrollTop=4000;</script>';
ios('held failure', async phone => {
  const server = Bun.serve({hostname:'127.0.0.1',port:0,fetch:() => new Response(page,{headers:{'content-type':'text/html'}})});
  await phone.open(server.url.href);
  await phone.touch.press({x:200,y:600});
  await phone.touch.move({x:200,y:500});
  throw new Error('held failure marker');
}, {runtimes:[${JSON.stringify(runtime)}]});
`;

const nested = Effect.fn('e2e.iosNested')(function* (name: string, contents: string) {
  const files = yield* FileSystem.FileSystem;
  const directory = yield* files.makeTempDirectoryScoped({ prefix: 'ios-errors-' });
  const path = join(directory, name);
  yield* files.writeFileString(path, contents);
  const builds = yield* cacheDirectory();
  const root = runRoot();
  if (root === undefined) return yield* Effect.die(new Error('native conformance requires a testbed run root'));
  return yield* Effect.tryPromise(async (signal) => {
    const child = Bun.spawn([join(import.meta.dir, '../../../../node_modules/.bin/testbed'), 'e2e', '--no-isolate', '--parallel=1', path], {
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
    });
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
});

if (process.env.E2E_LANES === undefined || process.env.E2E_LANES.split(',').includes('ios')) {
  layer(Layer.effectDiscard(prepareSimulator({ runtime })), { excludeTestServices: true })('native page failures', (it) => {
    it.effect('a failure with the finger still down writes its page evidence', () =>
      Effect.gen(function* () {
        const result = yield* nested('held-failure.e2e.ts', held);
        expect(result.code).toBe(1);
        expect(result.output).toMatch(/held failure marker/);
        const artifacts = /Artifacts: (\S+)/.exec(result.output)?.[1];
        expect(artifacts).toBeDefined();
        const files = yield* FileSystem.FileSystem;
        expect(yield* files.exists(join(artifacts!, 'ios-recording.json'))).toBe(true);
      }).pipe(Effect.provide(BunFileSystem.layer)),
    );
    for (const path of ['exception', 'rejection'] as const)
      it.effect(`the iOS registrar fails on an actual page ${path}`, () =>
        Effect.gen(function* () {
          const result = yield* nested(`page-${path}.e2e.ts`, source(path));
          expect(result.code).toBe(1);
          expect(result.output).toMatch(new RegExp(`PageFailed:[^\\n]*native ${path} marker`));
        }).pipe(Effect.provide(BunFileSystem.layer)),
      );
  });
}
