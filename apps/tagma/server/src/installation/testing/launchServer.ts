import { Cause, Context, Deferred, Effect, Exit, Layer, Queue } from 'effect';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeProcessChain } from '../process/chain.js';
import { testProcesses } from './processes.js';
import { connectLaunch } from '../process/launch.js';
import { expectsRelease, replaced, serving, standBy, successionLayer } from '../process/succession.js';
import { lockDataDirectory } from '../../platform/lock/dataDirectory.js';
import { Succession } from '../contract/service/succession.js';
import { STANDING_BY } from '../contract/wire/launch.js';
import { takeActive } from '../setup/active.js';
import { junctionDirectory } from '../contract/wire/junction.js';
import { Processes } from '@runlith/execution-host/ProcessReader';

const home = process.env.LAUNCH_TEST_HOME;
if (home === undefined) throw new Error('LAUNCH_TEST_HOME is required');

await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      if (process.argv.includes('--after-disconnect')) {
        yield* Effect.promise(
          () =>
            new Promise<void>((resolve) => {
              process.once('disconnect', () => resolve());
              writeFileSync(join(home, 'connecting'), String(process.pid));
            }),
        );
      }
      const native = yield* Layer.build(testProcesses);
      const launch = connectLaunch(process.env);
      if (launch === undefined && process.env.LAUNCH_TEST_UNSUPERVISED !== '1') return yield* Effect.die('a server launch is required');
      const predecessor = replaced(process.env);
      const notified = expectsRelease(process.env);
      const stood =
        predecessor === undefined
          ? undefined
          : yield* standBy(home, predecessor, notified, launch?.chained ?? true).pipe(Effect.provide(native));
      const lock = yield* Effect.acquireRelease(
        stood === undefined ? lockDataDirectory(home) : Effect.succeed(stood.lock),
        (lock) => lock.release,
      );
      if (stood?.unreleased != null) writeFileSync(join(home, `unreleased-${process.pid}`), stood.unreleased);
      if (predecessor !== undefined && process.env.LAUNCH_TEST_FAIL_AFTER_TAKE === '1') process.exit(1);
      const chain =
        stood?.chain ??
        (yield* makeProcessChain(home, process.env.LAUNCH_TEST_CLI ?? null, launch?.chained ?? true).pipe(Effect.provide(native)));
      const own = Context.get(native, Processes).identity(process.pid);
      const active =
        process.env.LAUNCH_TEST_CLI === undefined
          ? undefined
          : takeActive(junctionDirectory(process.env)!, {
              channel: 'dev',
              cli: process.env.LAUNCH_TEST_CLI,
              url: 'http://127.0.0.1:0',
              pid: process.pid,
              birth: own._tag === 'Read' ? own.birth : undefined,
              chain: chain?.reference,
            });
      if (active !== undefined && active._tag !== 'Taken') return yield* Effect.die('the fixture did not take its active lock');
      const stopped = yield* Deferred.make<void>();
      const succession = Context.get(
        yield* Layer.build(
          successionLayer(
            undefined,
            home,
            join(home, 'serve.log'),
            (root) => join(root, 'desktop', 'carried'),
            () => {
              Deferred.doneUnsafe(stopped, Exit.void);
            },
            launch,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            chain,
          ),
        ).pipe(Effect.provide(native)),
        Succession,
      );
      const requests = yield* Effect.acquireRelease(Queue.unbounded<PromiseWithResolvers<Response>>(), Queue.shutdown);
      yield* Effect.forkScoped(
        Effect.forever(
          Effect.gen(function* () {
            const request = yield* Queue.take(requests);
            const answer = yield* Effect.exit(Effect.map(succession.restart(), Response.json));
            if (Exit.isSuccess(answer)) request.resolve(answer.value);
            else request.reject(Cause.squash(answer.cause));
          }),
        ),
      );
      const door = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            hostname: '127.0.0.1',
            port: 0,
            idleTimeout: 0,
            async fetch(request) {
              const path = new URL(request.url).pathname;
              if (path === '/fail') {
                try {
                  await launch!.start([process.execPath, '-e', 'process.exit(3)'], process.env, new AbortController().signal);
                  return new Response('unexpected successor', { status: 500 });
                } catch (cause) {
                  return Response.json({ failure: String(cause), pid: process.pid });
                }
              }
              if (path === '/cancel' || path === '/pending') {
                const marker = join(home, 'candidate');
                const command = [
                  process.execPath,
                  '-e',
                  `
          const { renameSync, writeFileSync } = require('node:fs');
          process.on('SIGTERM', () => { process.send?.(${JSON.stringify(STANDING_BY)}); process.exit(0); });
          writeFileSync(${JSON.stringify(marker)} + '.' + process.pid, String(process.pid));
          renameSync(${JSON.stringify(marker)} + '.' + process.pid, ${JSON.stringify(marker)});
          setInterval(() => {}, 1000);
        `,
                ];
                const controller = new AbortController();
                let answered = false;
                const started = launch!.start(command, process.env, controller.signal).then(
                  () => ({ started: true }),
                  (cause: unknown) => ({ failure: String(cause) }),
                );
                void started.then(() => {
                  answered = true;
                });
                if (path === '/pending') return Response.json(await started);
                while (!existsSync(marker) && !answered) await Bun.sleep(20);
                if (!existsSync(marker)) return Response.json(await started);
                const pid = Number(readFileSync(marker, 'utf8'));
                controller.abort(new Error('cancelled'));
                return Response.json({ ...(await started), pid });
              }
              if (path === '/restart') {
                const answered = Promise.withResolvers<Response>();
                Queue.offerUnsafe(requests, answered);
                return answered.promise;
              }
              return Response.json({ pid: process.pid });
            },
          }),
        ),
        (server) => Effect.sync(() => void server.stop(true)),
      );
      const stop = () => Deferred.doneUnsafe(stopped, Exit.void);
      const hangup = () => process.kill(process.pid, 'SIGTERM');
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          process.on('SIGTERM', stop);
          process.on('SIGHUP', hangup);
        }),
        () =>
          Effect.sync(() => {
            process.off('SIGTERM', stop);
            process.off('SIGHUP', hangup);
          }),
      );
      const standing = join(home, `standing-${process.pid}.json`);
      writeFileSync(standing, JSON.stringify({ pid: process.pid, port: door.port }));
      renameSync(standing, join(home, 'standing.json'));
      yield* serving(notified);
      yield* Deferred.await(stopped);
      yield* Effect.promise(() => door.stop());
      if (predecessor === undefined && process.env.LAUNCH_TEST_HOLD_CLOSE === '1') {
        writeFileSync(join(home, 'closing'), String(process.pid));
        while (!existsSync(join(home, 'close'))) yield* Effect.sleep('10 millis');
      }
      if (process.env.LAUNCH_TEST_LEAVE_UNRELEASED === '1') process.exit(1);
      if (active?._tag === 'Taken') active.release();
      yield* lock.release;
      writeFileSync(join(home, `closed-${process.pid}`), 'closed');
      yield* succession.release(process.env.LAUNCH_TEST_RELEASE_FAILURE ?? null);
      yield* succession.settle;
    }),
  ),
);
process.exit(0);
