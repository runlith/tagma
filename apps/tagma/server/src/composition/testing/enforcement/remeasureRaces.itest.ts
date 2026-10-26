import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { commitOf } from '@runlith/git/repository';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Context, Deferred, Effect, Exit, FileSystem, Layer, Queue, Schema, Scope, Stream, Tracer } from 'effect';
import { Blocks } from '../../../graph/contract/service/blocks.js';
import { lawEnforcementSchema } from '../../../graph/contract/wire/enforcement.js';
import type { HeadMoved } from '../../../workspace/contract/service/checkouts.js';
import { QUIET_CHECKOUTS } from '../../../enforcement/testing/doubles.js';
import {
  driverOver,
  enforcementApplied,
  enforcementBaseOf,
  journalOver,
  ruleRemeasured,
  withLanes,
  workerLanes,
} from '../../../enforcement/testing/wiring.js';
import { demoGraphLayer, gitEffect, withDemo } from '../graphFixture.js';

layer(Layer.merge(demoGraphLayer(), BunFileSystem.layer), { excludeTestServices: true })('remeasurement races', (it) => {
  it.effect(
    'a reset during ledger publication is remeasured and late attribution respects a confirmed absence',
    () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const files = yield* FileSystem.FileSystem;
          const root = demo.demoRoot;
          const clean = 'export const a = 1;\n';
          const crossing = `${clean}export const b = 2;\n`;
          const put = (text: string) => files.writeFileString(join(root, 'src/model.ts'), text);
          const commit = Effect.fnUntraced(function* () {
            yield* gitEffect(root, ['add', '.']);
            yield* gitEffect(root, ['commit', '-qm', 'step']);
            const head = yield* commitOf(demo.graph.git, root, 'HEAD');
            if (head === null) return yield* Effect.die('a committed fixture has no HEAD');
            return head;
          });
          yield* files.makeDirectory(join(root, 'src'));
          yield* put(clean);
          yield* gitEffect(root, ['init', '-q', '-b', 'main']);
          yield* gitEffect(root, ['config', 'user.email', 'tagma@test']);
          yield* gitEffect(root, ['config', 'user.name', 'tagma']);
          const seed = yield* commit();
          const workers = yield* Effect.acquireRelease(
            Effect.sync(() => workerLanes('race-inspection')),
            (workers) => Effect.sync(() => workers.close()),
          );
          const context = withLanes(demo.context, workers);
          const rule = yield* demo.graph.blocks.create({ projectId: demo.projectId, tags: ['rule'], title: 'Small files' });
          const name = yield* demo.nameOf(rule.id);
          demo.described.set('small', {
            builtin: 'size',
            params: {
              base: 'src',
              files: { extensions: ['.ts'], exclude: [] },
              thresholds: [{ glob: '**', metric: 'non-import', lines: 1 }],
            },
          });
          yield* enforcementApplied(rule, {
            strictness: 'gate',
            inspection: 'small',
            on: [{ op: 'submit_work', phase: 'before' }],
            caller: null,
            subjectOf: () => 'tree',
            base: yield* enforcementBaseOf(rule),
          }).pipe(Effect.provide(context));
          const selected = yield* Queue.unbounded<void>();
          const changed = yield* Queue.unbounded<void>();
          const entered = yield* Deferred.make<void>();
          const release = yield* Deferred.make<void>();
          let pause = true;
          const blocks = Blocks.of({
            ...demo.graph.blocks,
            setEnforcement: (input) =>
              input.op === 'remeasure' && pause
                ? Effect.gen(function* () {
                    pause = false;
                    yield* Deferred.succeed(entered, undefined);
                    yield* Deferred.await(release);
                    return yield* demo.graph.blocks.setEnforcement(input);
                  })
                : demo.graph.blocks.setEnforcement(input),
          });
          const tracer = Tracer.make({
            span: (options) => {
              const span = new Tracer.NativeSpan(options);
              const end = span.end.bind(span);
              span.end = (at, exit) => {
                end(at, exit);
                if (span.name === 'enforcement.chosenRules') Queue.offerUnsafe(selected, undefined);
              };
              return span;
            },
          });
          const observed = context.pipe(Context.add(Blocks, blocks), Context.add(Tracer.Tracer, tracer));
          yield* Effect.acquireRelease(
            demo.graph.feed.subscribe(demo.projectId, (frame) => {
              if (frame.type === 'change' && frame.events.some((event) => event.op === 'remeasure')) Queue.offerUnsafe(changed, undefined);
            }),
            (unsubscribe) => Effect.sync(unsubscribe),
          );
          const moves = yield* Queue.unbounded<HeadMoved>();
          const memory = join(demo.fixture.root, 'enforcing.json');
          yield* files.writeFileString(memory, JSON.stringify([{ projectId: demo.projectId, root }]));
          const scope = yield* Scope.fork(yield* Effect.scope);
          yield* driverOver({
            graphOf: () => Effect.succeed(observed),
            memory,
            delayMs: 0,
            checkouts: { ...QUIET_CHECKOUTS, headMoved: () => Stream.fromQueue(moves) },
          }).pipe(Effect.withTracer(tracer), Scope.provide(scope));
          yield* Queue.take(selected);
          yield* put(crossing);
          const first = yield* commit();
          yield* Queue.offer(moves, { checkout: root, head: first });
          yield* Deferred.await(entered);
          yield* Queue.take(selected);
          yield* gitEffect(root, ['update-ref', 'refs/heads/main', seed]);
          yield* Queue.offer(moves, { checkout: root, head: seed });
          yield* Queue.take(selected);
          yield* Deferred.succeed(release, undefined);
          yield* Queue.take(changed).pipe(Effect.timeout('5 seconds'));
          yield* Queue.take(changed).pipe(Effect.timeout('5 seconds'));
          expect((yield* demo.graph.blocks.blockById(rule.id)).fields.enforcement).toMatchObject({ escaped: [] });
          yield* Scope.close(scope, Exit.void);
          yield* gitEffect(root, ['update-ref', 'refs/heads/main', first]);
          yield* put(clean);
          yield* commit();
          yield* ruleRemeasured(demo.projectId, name).pipe(Effect.provide(context));
          yield* put(crossing);
          const repeated = yield* commit();
          const journal = journalOver(demo.graph.store.db, demo.graph.units);
          const removed = yield* Queue.unbounded<void>();
          const driver = yield* driverOver({
            graphOf: () => Effect.succeed(context),
            delayMs: 0,
            journal: { ...journal, remove: (key) => journal.remove(key).pipe(Effect.tap(() => Queue.offer(removed, undefined))) },
          });
          const land = (commit: string) =>
            driver.landed('submit_work', {
              kind: 'tree',
              projectId: demo.projectId,
              root,
              commit,
              paths: ['src/model.ts'],
              carried: [
                {
                  rule: name,
                  title: rule.title,
                  fingerprint: 'model.ts',
                  file: 'src/model.ts',
                  line: 1,
                  message: 'too large',
                  generalFix: 'split the subject',
                  holders: ['prior-holder'],
                },
              ],
            });
          yield* land(first);
          yield* Queue.take(removed);
          const read = Effect.fnUntraced(function* () {
            return yield* Schema.decodeUnknownEffect(lawEnforcementSchema)(
              (yield* demo.graph.blocks.blockById(rule.id)).fields.enforcement,
            );
          });
          expect((yield* read()).escaped.map(({ commit, holder }) => ({ commit, holder }))).toEqual([
            { commit: repeated, holder: undefined },
          ]);
          yield* land(repeated);
          yield* Queue.take(removed);
          expect((yield* read()).escaped.map(({ commit, holder }) => ({ commit, holder }))).toEqual([
            { commit: repeated, holder: 'prior-holder' },
          ]);
        }),
      ),
    30_000,
  );
});
