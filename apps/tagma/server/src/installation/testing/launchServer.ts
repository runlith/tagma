import { Cause, Context, Deferred, Effect, Exit, Layer, Queue } from 'effect';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connectLaunch } from '../process/launch.js';
import { expectsRelease, replaced, serving, standBy, successionLayer } from '../process/succession.js';
import { lockDataDirectory } from '../../platform/lock/dataDirectory.js';
import { Succession } from '../contract/service/succession.js';
import { STANDING_BY } from '../contract/wire/launch.js';

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
      const launch = connectLaunch(process.env);
      if (launch === undefined && process.env.LAUNCH_TEST_UNSUPERVISED !== '1') return yield* Effect.die('a server launch is required');
      const predecessor = replaced(process.env);
      const notified = expectsRelease(process.env);
      const stood = predecessor === undefined ? undefined : yield* standBy(home, predecessor, notified);
      const lock = yield* Effect.acquireRelease(
        stood === undefined ? lockDataDirectory(home) : Effect.succeed(stood.lock),
        (lock) => lock.release,
      );
      if (stood?.unreleased != null) writeFileSync(join(home, `unreleased-${process.pid}`), stood.unreleased);
      if (predecessor !== undefined && process.env.LAUNCH_TEST_FAIL_AFTER_TAKE === '1') process.exit(1);
      const succession = Context.get(
        yield* Layer.build(successionLayer(undefined, home, join(home, 'serve.log'), undefined, launch)),
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
      const stopped = yield* Deferred.make<void>();
      const door = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            hostname: '127.0.0.1',
            port: 0,
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
          const { writeFileSync } = require('node:fs');
          process.on('SIGTERM', () => { process.send?.(${JSON.stringify(STANDING_BY)}); process.exit(0); });
          writeFileSync(${JSON.stringify(marker)}, String(process.pid));
          setInterval(() => {}, 1000);
        `,
                ];
                const controller = new AbortController();
                const started = launch!.start(command, process.env, controller.signal).then(
                  () => ({ started: true }),
                  (cause: unknown) => ({ failure: String(cause) }),
                );
                if (path === '/pending') return Response.json(await started);
                const until = Date.now() + 5000;
                while (!existsSync(marker)) {
                  if (Date.now() >= until) throw new Error('the candidate did not start');
                  await Bun.sleep(20);
                }
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
          process.once('SIGTERM', stop);
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
      door.stop(true);
      if (process.env.LAUNCH_TEST_LEAVE_UNRELEASED === '1') process.exit(1);
      yield* lock.release;
      writeFileSync(join(home, `closed-${process.pid}`), 'closed');
      yield* succession.release(process.env.LAUNCH_TEST_RELEASE_FAILURE ?? null);
      yield* succession.settle;
    }),
  ),
);
process.exit(0);
