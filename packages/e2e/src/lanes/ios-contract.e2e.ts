import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { afterEach, beforeEach, describe, expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { runRoot } from '@runlith/testbed/fixture';
import { Cause, Deferred, Effect, Fiber, FileSystem, Layer, type Scope } from 'effect';
import { join } from 'node:path';
import { fixtureHooks, onFailure, recordedFixture } from '../artifacts.ts';
import { cacheDirectory } from './iosTools.ts';
import { prepareSimulator } from './simulator.ts';

type Source = (gate: string) => string;
type Result = { readonly code: number; readonly output: string };
type Child = {
  readonly ready: Effect.Effect<void, Cause.UnknownError>;
  readonly run: Effect.Effect<Result, Cause.UnknownError>;
};
type Start = 'run' | 'cancel';
const runtime = process.env.E2E_IOS_RUNTIMES?.split(',')[0] ?? '26';
const ready = (gate: string) => `const started = await fetch(${JSON.stringify(gate)}, {method:'POST'});
  if (!started.ok) throw new Error('native fixture closed before its scenario');`;
const source = (path: 'exception' | 'rejection', gate: string) => `import { beforeAll, afterAll, expect } from 'bun:test';
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
  ${ready(gate)}
  await phone.open(new URL(${JSON.stringify(path)}, server.url).href);
  expect(await phone.evaluate('document.title', Schema.String)).toBe('Page errors');
}, {runtimes:[${JSON.stringify(runtime)}]});
`;

const held: Source = (gate) => `import { ios } from ${JSON.stringify(import.meta.resolve('@runlith/e2e/ios'))};
import { Schema } from ${JSON.stringify(import.meta.resolve('effect'))};
const page = '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden}#list{position:absolute;inset:0;overflow:auto}.row{height:80px;border-bottom:1px solid}</style><div id="list"></div><script>const list=document.querySelector("#list");for(let i=0;i<200;i++){const row=document.createElement("div");row.className="row";list.append(row)}list.scrollTop=4000;window.moved=new Promise(resolve=>list.addEventListener("touchmove",event=>{if(event.isTrusted)resolve()},{once:true,passive:true}));</script>';
ios('held failure', async phone => {
  ${ready(gate)}
  const server = Bun.serve({hostname:'127.0.0.1',port:0,fetch:() => new Response(page,{headers:{'content-type':'text/html'}})});
  await phone.open(server.url.href);
  await phone.touch.press({x:200,y:600});
  await phone.touch.move({x:200,y:500});
  await phone.evaluate('window.moved', Schema.Void);
  throw new Error('held failure marker');
}, {runtimes:[${JSON.stringify(runtime)}]});
`;

const nested = Effect.fn('e2e.iosNestedSetup')(function* (name: string, source: Source, artifacts: string) {
  const files = yield* FileSystem.FileSystem;
  const directory = yield* files.makeTempDirectoryScoped({ prefix: 'ios-errors-' });
  const waiting = yield* Deferred.make<void>();
  const proceed = Promise.withResolvers<Start>();
  const server = yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch() {
          Deferred.doneUnsafe(waiting, Effect.void);
          return proceed.promise.then((state) => new Response(state, { status: state === 'run' ? 200 : 410 }));
        },
      }),
    ),
    (server) => Effect.promise(() => server.stop(true)),
  );
  const path = join(directory, name);
  yield* files.writeFileString(path, source(server.url.href));
  const builds = yield* cacheDirectory();
  const root = runRoot();
  if (root === undefined) return yield* Effect.die(new Error('native conformance requires a testbed run root'));
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const collect = async (stream: ReadableStream<Uint8Array>, output: NodeJS.WriteStream, chunks: Uint8Array[]) => {
    for await (const chunk of stream) {
      output.write(chunk);
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString();
  };
  const unhook = onFailure(async () => {
    await Bun.write(join(artifacts, 'nested.log'), Buffer.concat([...stdout, ...stderr]));
  });
  yield* Effect.addFinalizer(() => Effect.sync(unhook));
  const completed = yield* Effect.forkScoped(
    Effect.tryPromise(async (signal) => {
      const child = Bun.spawn(
        [join(import.meta.dir, '../../../../node_modules/.bin/testbed'), 'e2e', '--no-isolate', '--parallel=1', path],
        {
          cwd: join(import.meta.dir, '../..'),
          env: {
            ...process.env,
            E2E_LANES: 'ios',
            E2E_IOS_BUILDS: builds,
            RUNLITH_TEST_RUN_ROOT: root,
            RUNLITH_TEST_REPORT: join(artifacts, 'child.jsonl'),
          },
          stdout: 'pipe',
          stderr: 'pipe',
          signal,
        },
      );
      const [out, err, code] = await Promise.all([
        collect(child.stdout, process.stdout, stdout),
        collect(child.stderr, process.stderr, stderr),
        child.exited,
      ]);
      return { code, output: out + err };
    }).pipe(Effect.withSpan('e2e.iosNested')),
  );
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => proceed.resolve('cancel')).pipe(Effect.andThen(Fiber.join(completed)), Effect.asVoid, Effect.orDie),
  );
  const child: Child = {
    ready: Effect.raceFirst(
      Deferred.await(waiting),
      Fiber.join(completed).pipe(
        Effect.flatMap((result) =>
          Effect.die(new Error(`native child exited before its fixture was ready (${result.code})\n${result.output}`)),
        ),
      ),
    ),
    run: Effect.sync(() => proceed.resolve('run')).pipe(Effect.andThen(Fiber.join(completed))),
  };
  return child;
});

if (process.env.E2E_LANES === undefined || process.env.E2E_LANES.split(',').includes('ios')) {
  layer(Layer.effectDiscard(prepareSimulator({ runtime })), { excludeTestServices: true })('native page failures', (it) => {
    const scenario = <E>(
      title: string,
      file: string,
      source: Source,
      check: (result: Result) => Effect.Effect<void, E, Scope.Scope | FileSystem.FileSystem>,
    ) => {
      describe.serial(() => {
        const fixture = recordedFixture(title, (artifacts) =>
          nested(file, source, artifacts).pipe(
            Effect.tap((child) => child.ready),
            Effect.provide(BunFileSystem.layer),
          ),
        );
        const hooks = fixtureHooks(fixture);
        beforeEach(hooks.setup, Infinity);
        it.effect(
          title,
          () => fixture.run((child) => Effect.flatMap(child.run, check).pipe(Effect.provide(BunFileSystem.layer))),
          Infinity,
        );
        afterEach(hooks.close, Infinity);
      });
    };
    scenario('a failure with the finger still down writes its page evidence', 'held-failure.e2e.ts', held, (result) =>
      Effect.gen(function* () {
        expect(result.code).toBe(1);
        expect(result.output).toMatch(/held failure marker/);
        const artifacts = /Artifacts: (\S+)/.exec(result.output)?.[1];
        expect(artifacts).toBeDefined();
        const files = yield* FileSystem.FileSystem;
        expect(yield* files.exists(join(artifacts!, 'ios-recording.json'))).toBe(true);
      }),
    );
    for (const path of ['exception', 'rejection'] as const)
      scenario(
        `the iOS registrar fails on an actual page ${path}`,
        `page-${path}.e2e.ts`,
        (gate) => source(path, gate),
        (result) =>
          Effect.gen(function* () {
            expect(result.code).toBe(1);
            expect(result.output).toMatch(new RegExp(`PageFailed:[^\\n]*native ${path} marker`));
          }),
      );
  });
}
