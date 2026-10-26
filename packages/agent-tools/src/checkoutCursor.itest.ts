import { afterAll, expect } from 'bun:test';
import { release } from '@runlith/git/testing';
import { it } from '@runlith/effect-test';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect, Layer } from 'effect';
import { Git } from '@runlith/git/Git';
import { CheckoutBaselines } from './CheckoutBaselines';
import { CheckoutFlights } from './CheckoutFlights';
import type { Reading } from './checkoutState';
import { machineWorld } from './world/machine';
import { resolveToolOptions } from './workspace/runtime';
import { walkedSource } from './testing/changeSource';
import { checkout, options } from './testing/toolHarness';

afterAll(release);

const spoken: string[][] = [];

const services = Layer.mergeAll(
  machineWorld.files,
  machineWorld.exec,
  Layer.effect(
    Git,
    Effect.gen(function* () {
      const git = yield* Git;
      return Git.of({
        run: (args, given) => {
          spoken.push([...args]);
          return git.run(args, given);
        },
      });
    }),
  ).pipe(Layer.provide(machineWorld.git)),
);

const sh = (root: string, command: string) => Effect.promise(() => Bun.$`sh -c ${command}`.cwd(root).quiet());

const shapeOf = (reading: Reading) =>
  'unreadable' in reading ? reading : { state: [...reading.state].sort(), presence: [...reading.presence].sort(), head: reading.head };

const wholeStatus = (args: readonly string[]): boolean => args.includes('status') && !args.includes('--');

type Step = { readonly name: string; readonly act: (root: string) => Promise<unknown>; readonly whole?: true };

const STEPS: readonly Step[] = [
  { name: 'tracked file written', act: (root) => writeFile(join(root, 'a.txt'), 'changed\n') },
  {
    name: 'untracked file and directory made',
    act: async (root) => {
      await writeFile(join(root, 'new.txt'), 'new\n');
      await mkdir(join(root, 'fresh'));
      await writeFile(join(root, 'fresh', 'one'), '1\n');
    },
  },
  { name: 'tracked file deleted', act: (root) => rm(join(root, 'b.txt')) },
  { name: 'tracked file renamed', act: (root) => rename(join(root, 'c.txt'), join(root, 'c2.txt')) },
  { name: 'directory with tracked files moved', act: (root) => rename(join(root, 'dir'), join(root, 'dir2')) },
  { name: 'directory with tracked files removed', act: (root) => rm(join(root, 'other'), { recursive: true }) },
  { name: 'staged and unstaged', act: (root) => Bun.$`git add a.txt && git rm -q --cached d.txt`.cwd(root).quiet() },
  { name: 'tracked file modified', act: (root) => writeFile(join(root, 'e.txt'), 'edited\n') },
  { name: 'modified file skipped in the worktree', act: (root) => Bun.$`git update-index --skip-worktree e.txt`.cwd(root).quiet() },
  { name: 'committed', act: (root) => Bun.$`git commit -qm second`.cwd(root).quiet() },
  {
    name: 'path restored from HEAD',
    act: async (root) => {
      await writeFile(join(root, 'a.txt'), 'again\n');
      await Bun.$`git checkout -- a.txt`.cwd(root).quiet();
    },
  },
  {
    name: 'stashed',
    act: async (root) => {
      await writeFile(join(root, 'f.txt'), 'stashed\n');
      await Bun.$`git stash -q`.cwd(root).quiet();
    },
  },
  { name: 'a neighbour read status', act: (root) => Bun.$`git status`.cwd(root).quiet() },
  {
    name: 'several files written',
    act: (root) => Promise.all(Array.from({ length: 3 }, (_, at) => writeFile(join(root, 'many', `${at}.txt`), `${at}\n`))),
  },
  { name: 'unowned graph file written', act: (root) => writeFile(join(root, '.tagma', 'kept'), 'x\n') },
  { name: 'nested ignore rules changed', act: (root) => writeFile(join(root, 'sub', '.gitignore'), 'kept\n'), whole: true },
];

const committed = {
  'a.txt': 'a\n',
  'b.txt': 'b\n',
  'c.txt': 'c\n',
  'd.txt': 'd\n',
  'e.txt': 'e\n',
  'f.txt': 'f\n',
  'dir/one.txt': '1\n',
  'dir/two.txt': '2\n',
  'other/x.txt': 'x\n',
  'sub/kept': 'k\n',
  'many/.keep': '',
  '.tagma/x': 'x\n',
};

const compared = Effect.fnUntraced(function* (root: string, steps: readonly Step[] = STEPS) {
  const resolved = resolveToolOptions(options({ cwd: root, unowned: ['.tagma'] }));
  const walked = walkedSource();
  const cursor = new CheckoutBaselines(new CheckoutFlights(walked.source));
  const whole = new CheckoutBaselines(new CheckoutFlights());
  const measure = (baselines: CheckoutBaselines) => baselines.measure(root, resolved).pipe(Effect.provide(services));
  yield* measure(cursor);
  const outcomes: { name: string; equal: boolean; scoped: boolean }[] = [];
  for (const step of steps) {
    yield* Effect.promise(() => step.act(root));
    spoken.length = 0;
    const told = walked.rulesMoved();
    const throughCursor = shapeOf(yield* measure(cursor));
    const scoped = !spoken.some(wholeStatus) && walked.rulesMoved() === told;
    const wholly = shapeOf(yield* measure(whole));
    outcomes.push({ name: step.name, equal: Bun.deepEquals(throughCursor, wholly), scoped: scoped === (step.whole !== true) });
  }
  walked.lose();
  yield* Effect.promise(() => writeFile(join(root, 'a.txt'), 'after the cursor was lost\n'));
  const lostCursor = shapeOf(yield* measure(cursor));
  const lostWhole = shapeOf(yield* measure(whole));
  return { outcomes, lost: Bun.deepEquals(lostCursor, lostWhole) };
});

const failing = (found: { readonly outcomes: readonly { name: string; equal: boolean; scoped: boolean }[]; readonly lost: boolean }) => ({
  unequal: found.outcomes.filter((one) => !one.equal).map((one) => one.name),
  misread: found.outcomes.filter((one) => !one.scoped).map((one) => one.name),
  lost: found.lost,
});

it.live(
  'a reading through the change cursor equals a whole reading after each kind of change, reading status only by the changed paths',
  () =>
    Effect.gen(function* () {
      const root = yield* checkout(committed);
      expect(failing(yield* compared(root))).toEqual({ unequal: [], misread: [], lost: true });
    }),
);

it.live('a linked worktree, whose git directory stands outside it, reads through the change cursor the same as wholly', () =>
  Effect.gen(function* () {
    const main = yield* checkout(committed);
    const linked = `${main}-linked`;
    yield* sh(main, `git worktree add -q ${linked}`);
    yield* Effect.addFinalizer(() => Effect.promise(() => rm(linked, { recursive: true, force: true })));
    expect(
      failing(
        yield* compared(linked, [
          { name: 'linked file edited', act: (root) => writeFile(join(root, 'a.txt'), 'linked\n') },
          { name: 'linked HEAD moved', act: (root) => Bun.$`git add a.txt && git commit -qm linked`.cwd(root).quiet() },
        ]),
      ),
    ).toEqual({ unequal: [], misread: [], lost: true });
  }),
);
