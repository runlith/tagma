import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect } from 'bun:test';
import { Deferred, Effect, Exit, Fiber } from 'effect';
import { indexWrites } from '../../../platform/git/index.js';
import type { Git } from '@runlith/git/Git';
import { FILE, MINE, THEIRS, makeCheckout, CheckoutFixture, checkoutFixture, withCheckout } from '../checkoutFixture.js';
import { UNCHECKED } from '../../../enforcement/contract/wire/checks.js';
import { GateRefusal } from '../../../platform/contract/wire/refusal.js';
const incoming = Effect.fnUntraced(function* (world: Effect.Success<ReturnType<typeof makeCheckout>>, conflict = false) {
  yield* world.run(['checkout', '-qb', 'incoming']);
  writeFileSync(join(world.root, 'src/incoming.ts'), 'const incoming = 1;\n');
  mkdirSync(join(world.root, '.tagma'), { recursive: true });
  writeFileSync(join(world.root, '.tagma/incoming.json'), '{"incoming":true}\n');
  if (conflict) writeFileSync(world.file, `${['const one = 10;', ...FILE.slice(1)].join('\n')}\n`);
  yield* world.run(['add', '--', 'src', '.tagma']);
  yield* world.run(['commit', '-qm', 'incoming']);
  const tip = yield* world.run(['rev-parse', 'HEAD']);
  yield* world.run(['checkout', '-q', 'main']);
  if (conflict) writeFileSync(world.file, `${['const one = 100;', ...FILE.slice(1)].join('\n')}\n`);
  else writeFileSync(join(world.root, 'src/local.ts'), 'const local = 1;\n');
  yield* world.run(['add', '--', 'src']);
  yield* world.run(['commit', '-qm', 'local']);
  const head = yield* world.run(['rev-parse', 'HEAD']);
  const merge = world.run(['merge', '--no-commit', '--no-ff', 'incoming']);
  if (conflict) expect(yield* Effect.flip(merge)).toMatchObject({ _tag: 'OwnGitFailed', ran: true });
  else yield* merge;
  return { head, tip };
});
layer(checkoutFixture, { excludeTestServices: true })('checkout', (it) => {
  it.effect(
    'submit_work concludes a resolved merge with its incoming tree and the working file it carries, every writer’s lines in it',
    () =>
      withCheckout((checkout) =>
        Effect.fnUntraced(function* () {
          const world = checkout;
          const { head, tip } = yield* incoming(world, true);
          const resolved = ['const one = 42;', 'const two = 22;', ...FILE.slice(2)];
          writeFileSync(world.file, `${resolved.join('\n')}\n`);
          yield* world.run(['add', '--', 'src/a.ts']);
          writeFileSync(world.file, `${['const one = 100;', ...FILE.slice(1)].join('\n')}\n`);
          yield* world.wrote(THEIRS, ['const one = 100;', ...FILE.slice(1, 4), 'const five = 55;']);
          yield* world.wrote(MINE, ['const one = 100;', 'const two = 23;', ...FILE.slice(2, 4), 'const five = 55;']);
          const working = readFileSync(world.file, 'utf8');
          writeFileSync(join(world.root, 'src/after.ts'), 'const after = 1;\n');
          const index = yield* world.run(['rev-parse', '--path-format=absolute', '--git-path', 'index']);
          const publishing = yield* Deferred.make<void>();
          let mergeAtStage: boolean | null = null;
          const staging = yield* Effect.forkChild(
            Effect.andThen(
              Deferred.await(publishing),
              indexWrites.hold(
                index,
                Effect.gen(function* () {
                  mergeAtStage = existsSync(join(world.root, '.git/MERGE_HEAD'));
                  yield* world.run(['add', '--', 'src/after.ts']);
                }),
              ),
            ),
          );
          const concurrent: Git['Service'] = {
            run: (args, options) =>
              args.includes('update-ref')
                ? Effect.andThen(Deferred.succeed(publishing, undefined), Effect.andThen(Effect.yieldNow, world.git.run(args, options)))
                : world.git.run(args, options),
          };
          const answer = yield* world
            .submit(MINE, { git: concurrent })
            .pipe(Effect.ensuring(Effect.andThen(Deferred.succeed(publishing, undefined), Effect.orDie(Fiber.join(staging)))));
          expect(mergeAtStage as boolean | null).toBe(false);
          expect(answer.status).toBe('landed');
          if (answer.status !== 'landed') return;
          expect(yield* world.run(['rev-list', '--parents', '-1', 'HEAD'])).toBe(`${answer.commit} ${head} ${tip}`);
          expect(yield* world.committed()).toEqual(['const one = 100;', 'const two = 23;', ...FILE.slice(2, 4), 'const five = 55;']);
          expect(answer.carried).toEqual([{ path: 'src/a.ts', holders: [THEIRS] }]);
          expect(yield* world.run(['show', 'HEAD:src/incoming.ts'])).toBe('const incoming = 1;');
          expect(yield* world.run(['show', 'HEAD:.tagma/incoming.json'])).toBe('{"incoming":true}');
          expect(existsSync(join(world.root, '.git/MERGE_HEAD'))).toBe(false);
          expect(yield* world.run(['diff', '--cached', '--name-only'])).toBe('src/after.ts');
          expect(yield* world.run(['ls-tree', '--name-only', 'HEAD', '--', 'src/after.ts'])).toBe('');
          expect(readFileSync(world.file, 'utf8')).toBe(working);
          const rows = yield* world.rows();
          expect(rows.map((row) => row.commit)).toEqual([answer.commit, answer.commit]);
        })(),
      ),
  );
  it.effect('submit_work names unresolved merge paths and preserves the open merge and index', () =>
    withCheckout((checkout) =>
      Effect.fnUntraced(function* () {
        const world = checkout;
        const { head, tip } = yield* incoming(world, true);
        const index = yield* world.run(['ls-files', '--stage', '-z']);
        const working = readFileSync(world.file, 'utf8');
        const outcome = yield* Effect.provide(Effect.result(world.submitAs(MINE, { paths: ['src'] })), world.context);
        expect(outcome._tag).toBe('Failure');
        if (outcome._tag !== 'Failure') return;
        expect(outcome.failure).toBeInstanceOf(GateRefusal);
        if (!(outcome.failure instanceof GateRefusal)) return;
        expect(outcome.failure.code).toBe('tree-mid-merge');
        expect(outcome.failure.reason).toContain('src/a.ts');
        expect(yield* world.run(['rev-parse', 'HEAD'])).toBe(head);
        expect(yield* world.run(['rev-parse', 'MERGE_HEAD'])).toBe(tip);
        expect(yield* world.run(['ls-files', '--stage', '-z'])).toBe(index);
        expect(readFileSync(world.file, 'utf8')).toBe(working);
        yield* world.run(['merge', '--abort']);
      })(),
    ),
  );
  it.effect(
    'incoming changes a named landing carries are gated, and an interrupted merge publication resumes its tail without another commit',
    () =>
      withCheckout((checkout) =>
        Effect.fnUntraced(function* () {
          const world = checkout;
          const { head, tip } = yield* incoming(world);
          const index = yield* world.run(['write-tree']);
          const outcome = yield* Effect.provide(
            Effect.result(
              world.submitAs(MINE, {
                paths: ['src'],
                checks: {
                  before: (subject) =>
                    subject.kind !== 'tree'
                      ? Effect.succeed(UNCHECKED)
                      : Effect.gen(function* () {
                          const incoming = yield* Effect.orDie(world.run(['show', `${subject.built}:src/incoming.ts`]));
                          return incoming === 'const incoming = 1;'
                            ? {
                                ...UNCHECKED,
                                refused: {
                                  code: 'rule-violated' as const,
                                  reason: 'incoming violates the gate',
                                  unblock: ['fix src/incoming.ts'],
                                },
                              }
                            : UNCHECKED;
                        }),
                  after: () => Effect.void,
                },
              }),
            ),
            world.context,
          );
          expect(outcome._tag).toBe('Failure');
          if (outcome._tag !== 'Failure') return;
          expect(outcome.failure).toBeInstanceOf(GateRefusal);
          if (!(outcome.failure instanceof GateRefusal)) return;
          expect(outcome.failure.code).toBe('rule-violated');
          expect(yield* world.run(['rev-parse', 'HEAD'])).toBe(head);
          expect(yield* world.run(['rev-parse', 'MERGE_HEAD'])).toBe(tip);
          expect(yield* world.run(['write-tree'])).toBe(index);
          let cut = false;
          const interrupted: Git['Service'] = {
            run: (args, options) => {
              if (cut || !args.includes('update-ref')) return world.git.run(args, options);
              cut = true;
              return Effect.flatMap(world.git.run(args, options), () => Effect.interrupt);
            },
          };
          const ended = yield* Effect.provide(Effect.exit(world.submitAs(MINE, { git: interrupted, paths: ['src'] })), world.context);
          expect(Exit.isFailure(ended)).toBe(true);
          const commit = yield* world.run(['rev-parse', 'HEAD']);
          expect(yield* world.run(['rev-list', '--parents', '-1', 'HEAD'])).toBe(`${commit} ${head} ${tip}`);
          expect(yield* world.run(['rev-parse', 'MERGE_HEAD'])).toBe(tip);
          yield* world.run(['branch', 'alternate', commit]);
          yield* world.run(['symbolic-ref', 'HEAD', 'refs/heads/alternate']);
          const moved = yield* Effect.provide(Effect.result(world.submitAs(MINE, { paths: ['src'] })), world.context);
          expect(moved._tag).toBe('Failure');
          if (moved._tag !== 'Failure') return;
          expect(moved.failure instanceof GateRefusal ? moved.failure.code : moved.failure).toBe('landing-busy');
          expect(yield* world.run(['rev-parse', 'MERGE_HEAD'])).toBe(tip);
          yield* world.run(['symbolic-ref', 'HEAD', 'refs/heads/main']);
          expect(yield* world.submit(MINE)).toEqual({ status: 'nothing' });
          expect(yield* world.run(['rev-parse', 'HEAD'])).toBe(commit);
          expect(existsSync(join(world.root, '.git/MERGE_HEAD'))).toBe(false);
          expect(yield* world.run(['diff', '--cached', '--name-only'])).toBe('');
        })(),
      ),
  );
});
