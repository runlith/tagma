import { expect } from 'bun:test';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import type { Spot, Subject } from '@runlith/navigation/adapter';
import { type Checkout, Launcher, type Process } from '@runlith/navigation/engine';
import type { Position, Verdict } from '@runlith/navigation/verdict';
import { layer } from '@runlith/effect-test';
import { Context, Effect, FileSystem, Layer, Path, Schedule } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { ENGINE, launcherLayer } from './launcher';

class Sample extends Context.Service<
  Sample,
  { readonly root: string; readonly process: Process; readonly checkout: Checkout; readonly baseline: string }
>()('test/navigation-ts/Sample') {}

const FILES = ['svc/lifecycle.ts', 'svc/use.ts', 'svc/fixture.ts', 'old/legacy.ts', 'bare/pad.ts', 'gen/page.ts'];

const platform = BunChildProcessSpawner.layer.pipe(Layer.provideMerge(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));

const settled = (checkout: Checkout) =>
  Effect.andThen(
    Effect.scoped(Effect.flatMap(checkout.ready, (served) => served.adapter.locate(STOP))),
    checkout.ready.pipe(
      Effect.flatMap((served) =>
        served.snapshot.changed.length === 0 && !served.warming ? Effect.succeed(served) : Effect.fail('warming' as const),
      ),
      Effect.retry(Schedule.spaced('50 millis')),
    ),
  );

const sample = Layer.effect(
  Sample,
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const launcher = yield* Launcher;
    const root = path.join(yield* files.realPath(yield* files.makeTempDirectoryScoped()), 'repo');
    yield* files.copy(path.join(import.meta.dir, '..', 'sample'), root);
    for (const project of ['old', 'gen'])
      yield* files.rename(path.join(root, project, 'settings.json'), path.join(root, project, 'tsconfig.json'));
    yield* files.writeFileString(path.join(root, '.gitignore'), '.svelte-kit\nnode_modules\n');
    yield* files.makeDirectory(path.join(root, 'svc', 'node_modules'));
    yield* files.symlink(
      yield* files.realPath(path.join(import.meta.dir, '..', 'node_modules', 'effect')),
      path.join(root, 'svc', 'node_modules', 'effect'),
    );
    yield* spawner.string(ChildProcess.make('git', ['init', '-q'], { cwd: root }));
    yield* git(root, ['add', '-A']);
    yield* git(root, ['commit', '-qm', 'baseline']);
    const baseline = (yield* git(root, ['rev-parse', 'HEAD'])).trim();
    const process = yield* launcher.open({ base: root, memory: 2 ** 31, cpus: 2 });
    const checkout = yield* process.checkout(root);
    yield* Effect.scoped(checkout.ready);
    return { root, process, checkout, baseline };
  }),
).pipe(Layer.provideMerge(launcherLayer({ runtime: process.execPath, entry: ENGINE, compiler: null })), Layer.provideMerge(platform));

const positionsOf = Effect.fnUntraced(function* (root: string, name: string) {
  const files = yield* FileSystem.FileSystem;
  const pattern = new RegExp(`(?<![\\w$])${name}(?![\\w$])`, 'g');
  const found: Position[] = [];
  for (const path of FILES) {
    const lines = (yield* files.readFileString(`${root}/${path}`)).split('\n');
    lines.forEach((text, index) => {
      for (const match of text.matchAll(pattern)) found.push({ path, line: index + 1, column: match.index + 1 });
    });
  }
  return found;
});

const shown = (verdict: Verdict): string => {
  if (verdict._tag === 'use') return `${verdict.kind}${verdict.within === null ? '' : ` in ${verdict.within}`}`;
  if (verdict._tag === 'other') return `other ${verdict.symbol}`;
  if (verdict._tag === 'unverified') return `unverified ${verdict.reason}`;
  return 'text';
};

const judged = Effect.fnUntraced(function* (subject: Subject) {
  const { root, checkout } = yield* Sample;
  const positions = yield* positionsOf(root, subject.name);
  const { adapter } = yield* checkout.ready;
  const judgement = yield* adapter.judge({ subject: subject.id, positions });
  return {
    verdicts: Object.fromEntries(
      positions.map((at, index) => [`${at.path}:${at.line}:${at.column}`, shown(judgement.verdicts[index] as Verdict)]),
    ),
    aliases: judgement.aliases,
  };
});

const located = Effect.fnUntraced(function* (spot: Spot) {
  const { checkout } = yield* Sample;
  const { adapter } = yield* checkout.ready;
  const { subjects } = yield* adapter.locate(spot);
  expect(subjects.length).toBe(1);
  return subjects[0] as Subject;
});

const STOP: Spot = { _tag: 'member', owner: { path: 'svc/lifecycle.ts', line: 3, name: 'Lifecycle' }, member: 'stop' };

const git = Effect.fnUntraced(function* (cwd: string, args: readonly string[]) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return yield* spawner.string(ChildProcess.make('git', ['-c', 'user.name=sample', '-c', 'user.email=sample@local', ...args], { cwd }));
});

const resetSample = Effect.gen(function* () {
  const sample = yield* Sample;
  yield* git(sample.root, ['reset', '-q', '--hard', sample.baseline]);
  yield* git(sample.root, ['clean', '-qfdx', '-e', 'svc/node_modules/effect']);
  yield* sample.checkout.touch({ _tag: 'rescan' });
  yield* settled(sample.checkout);
  return sample;
});

const verdictsAt = Effect.fnUntraced(function* (root: string, checkout: Checkout) {
  const { adapter } = yield* settled(checkout);
  const [stop] = (yield* adapter.locate(STOP)).subjects;
  const positions = yield* positionsOf(root, 'stop');
  const judgement = yield* adapter.judge({ subject: (stop as Subject).id, positions });
  return Object.fromEntries(
    positions.map((at, index) => [`${at.path}:${at.line}:${at.column}`, shown(judgement.verdicts[index] as Verdict)]),
  );
});

const movedTo = Effect.fnUntraced(function* (root: string, checkout: Checkout) {
  yield* checkout.touch({ _tag: 'head' });
  return yield* verdictsAt(root, checkout);
});

const rescanned = Effect.fnUntraced(function* (root: string, checkout: Checkout) {
  yield* checkout.touch({ _tag: 'rescan' });
  return yield* verdictsAt(root, checkout);
});

const inserted = (text: string, lines: number) =>
  text.replace("  yield* lifecycle.stop('done');", `${"  yield* Effect.log('first');\n".repeat(lines)}  yield* lifecycle.stop('done');`);

layer(sample, { excludeTestServices: true })('the TypeScript engine', (it) => {
  it.effect('a member of an Effect service owner is found through its Service shape with every kind of place', () =>
    Effect.gen(function* () {
      yield* resetSample;
      const stop = yield* located(STOP);
      expect(stop.declarations.map((at) => `${at.path}:${at.line}:${at.column}`)).toEqual(['svc/lifecycle.ts:6:14']);
      const { verdicts, aliases } = yield* judged(stop);
      expect(verdicts).toEqual({
        'svc/lifecycle.ts:6:14': 'declaration in Lifecycle',
        'svc/lifecycle.ts:12:3': 'implementation',
        'svc/use.ts:7:20': 'call in run',
        'svc/use.ts:8:11': 'alias in run',
        'svc/use.ts:9:10': 'call in run',
        'svc/use.ts:10:11': 'alias in run',
        'svc/use.ts:15:21': 'other (object literals)',
        'svc/use.ts:16:32': 'other (object literals)',
        'svc/use.ts:17:23': 'text',
        'svc/fixture.ts:18:14': 'implementation',
        'svc/fixture.ts:18:42': 'type',
        'old/legacy.ts:1:14': 'unverified degraded',
        'old/legacy.ts:3:24': 'unverified degraded',
      });
      expect(aliases.map((alias) => alias.name)).toEqual(['halt']);
      const halt = yield* judged(aliases[0] as Subject);
      expect(halt.verdicts).toEqual({ 'svc/use.ts:10:17': 'alias in run', 'svc/use.ts:11:10': 'call in run' });
      const { adapter } = yield* (yield* Sample).checkout.ready;
      expect(yield* adapter.locate({ ...STOP, member: 'absent' })).toEqual({ subjects: [], resolved: true });
    }),
  );

  it.effect('an export rename and a value carried out through a returned object are aliases of their source', () =>
    Effect.gen(function* () {
      yield* resetSample;
      const helper = yield* judged(yield* located({ _tag: 'at', path: 'svc/fixture.ts', line: 4, name: 'helper' }));
      expect(helper.verdicts).toEqual({ 'svc/fixture.ts:4:14': 'declaration', 'svc/fixture.ts:6:10': 'alias' });
      const aid = yield* judged(helper.aliases[0] as Subject);
      expect(aid.verdicts).toEqual({ 'svc/use.ts:2:10': 'import', 'svc/use.ts:12:10': 'call in run', 'svc/fixture.ts:6:20': 'alias' });
      const asked = yield* judged(yield* located({ _tag: 'at', path: 'svc/use.ts', line: 12, name: 'aid' }));
      expect([asked.verdicts['svc/use.ts:12:10'], asked.aliases.map((alias) => alias.name)]).toEqual(['call in run', ['helper']]);
      const make = yield* judged(yield* located({ _tag: 'at', path: 'svc/fixture.ts', line: 9, name: 'make' }));
      expect(make.verdicts).toEqual({
        'svc/fixture.ts:9:9': 'declaration in fixture',
        'svc/fixture.ts:10:12': 'alias in fixture',
        'svc/fixture.ts:14:11': 'alias in made',
        'svc/fixture.ts:15:10': 'call in made',
      });
    }),
  );

  it.effect('a line that drifted far from its symbol still finds it in the file, and an ambiguous name answers every symbol', () =>
    Effect.gen(function* () {
      const { checkout } = yield* resetSample;
      const { adapter } = yield* checkout.ready;
      const drifted = yield* located({ _tag: 'at', path: 'svc/fixture.ts', line: 1, name: 'fixture' });
      expect([drifted.line, drifted.declarations.map((at) => `${at.path}:${at.line}:${at.column}`)]).toEqual([8, ['svc/fixture.ts:8:14']]);
      const several = (yield* adapter.locate({ _tag: 'at', path: 'svc/use.ts', line: 1, name: 'stop' })).subjects;
      const declared = several.flatMap((subject) => subject.declarations.map((at) => `${at.path}:${at.line}:${at.column}`));
      expect([several.length > 1, declared.includes('svc/lifecycle.ts:6:14'), declared.includes('svc/use.ts:15:21')]).toEqual([
        true,
        true,
        true,
      ]);
    }),
  );

  it.effect(
    'an edit is answered from the new snapshot once absorbed, a file the engine never reads is no lag, and a question holding the old snapshot keeps its revision',
    () =>
      Effect.gen(function* () {
        const { root, checkout } = yield* resetSample;
        const files = yield* FileSystem.FileSystem;
        const before = yield* checkout.ready;
        expect(before.snapshot.problems.map((one) => `${one.project} ${one.problem}`).toSorted()).toEqual([
          'bare/tsconfig.json dependencies',
          'gen/tsconfig.json generated',
          'old/tsconfig.json degraded',
        ]);
        const stop = (yield* before.adapter.locate(STOP)).subjects[0] as Subject;
        const old = yield* positionsOf(root, 'stop');
        yield* files.writeFileString(`${root}/notes.md`, 'stop\n');
        yield* checkout.touch({ _tag: 'paths', paths: ['notes.md'] });
        const unread = yield* checkout.ready;
        expect([unread.snapshot.changed, unread.warming]).toEqual([[], false]);
        const use = `${root}/svc/use.ts`;
        yield* files.writeFileString(
          use,
          `${yield* files.readFileString(use)}export const late = Effect.flatMap(Life, (life) => life.stop('late'));\n`,
        );
        yield* checkout.touch({ _tag: 'paths', paths: ['svc/use.ts'] });
        const touched = yield* checkout.ready;
        expect([touched.snapshot.changed, touched.warming]).toEqual([['svc/use.ts'], true]);
        const absorbed = yield* settled(checkout);
        const fresh = yield* positionsOf(root, 'stop');
        const after = yield* absorbed.adapter.judge({ subject: stop.id, positions: fresh });
        expect(shown(after.verdicts[fresh.findIndex((at) => at.path === 'svc/use.ts' && at.line === 18)] as Verdict)).toBe('call in late');
        const held = yield* before.adapter.judge({ subject: stop.id, positions: old });
        expect([absorbed.snapshot.revision === before.snapshot.revision, held.verdicts.length]).toEqual([false, old.length]);
      }),
  );

  it.effect('a project the recent questions left closed is judged with the edits made to it while closed', () =>
    Effect.gen(function* () {
      const { root, checkout } = yield* resetSample;
      const files = yield* FileSystem.FileSystem;
      const helper = yield* located({ _tag: 'at', path: 'svc/fixture.ts', line: 4, name: 'helper' });
      const pad = `${root}/bare/pad.ts`;
      yield* files.writeFileString(
        pad,
        `${yield* files.readFileString(pad)}import { helper } from '../svc/fixture';\nexport const twice = () => helper() * 2;\n`,
      );
      yield* checkout.touch({ _tag: 'paths', paths: ['bare/pad.ts'] });
      yield* settled(checkout);
      const { verdicts } = yield* judged(helper);
      expect([verdicts['bare/pad.ts:2:10'], verdicts['bare/pad.ts:3:28']]).toEqual(['import', 'call in twice']);
      const declared = yield* judged(yield* located({ _tag: 'at', path: 'bare/pad.ts', line: 1, name: 'pad' }));
      expect(declared.verdicts).toEqual({ 'bare/pad.ts:1:14': 'declaration' });
    }),
  );

  it.effect(
    'a worktree with its own edit and dependencies is served by the same engine, first from the base with its differences changed, then from a layer of its own, and from the base again once it rests',
    () =>
      Effect.gen(function* () {
        const { root, process } = yield* resetSample;
        const files = yield* FileSystem.FileSystem;
        yield* git(root, ['add', '-A']);
        yield* git(root, ['commit', '-qm', 'sample', '--allow-empty']);
        const tree = `${root}-tree`;
        yield* git(root, ['worktree', 'add', '-q', '--detach', tree, 'HEAD']);
        const kit = Effect.fnUntraced(function* (at: string, inner: string, declared: string) {
          yield* files.makeDirectory(`${at}/svc/node_modules/kit/node_modules/inner`, { recursive: true });
          yield* files.writeFileString(
            `${at}/svc/node_modules/kit/package.json`,
            '{"name":"kit","version":"2.0.0","types":"index.d.ts"}\n',
          );
          yield* files.writeFileString(`${at}/svc/node_modules/kit/index.d.ts`, "export { tool } from 'inner';\n");
          yield* files.writeFileString(
            `${at}/svc/node_modules/kit/node_modules/inner/package.json`,
            `{"name":"inner","version":"${inner}","types":"index.d.ts"}\n`,
          );
          yield* files.writeFileString(`${at}/svc/node_modules/kit/node_modules/inner/index.d.ts`, declared);
        });
        yield* kit(root, '1.0.0', 'export declare const tool: () => number;\n');
        yield* kit(tree, '2.0.0', 'export declare const spare: 1;\nexport declare const tool: () => string;\n');
        yield* files.symlink(yield* files.realPath(`${root}/svc/node_modules/effect`), `${tree}/svc/node_modules/effect`);
        yield* files.writeFileString(`${tree}/bun.lock`, '{"lockfileVersion":1}\n');
        const use = `${tree}/svc/use.ts`;
        yield* files.writeFileString(
          use,
          `${yield* files.readFileString(use)}import { tool } from 'kit';\nexport const tooled = tool();\nexport const branch = Effect.flatMap(Life, (life) => life.stop('branch'));\n`,
        );
        const worktree = yield* process.checkout(tree);
        const borrowed = yield* worktree.ready;
        expect(borrowed.snapshot.changed.toSorted()).toEqual(['bun.lock', 'svc/use.ts']);
        const stop = (yield* borrowed.adapter.locate(STOP)).subjects[0] as Subject;
        const own = yield* settled(worktree);
        const positions = yield* positionsOf(tree, 'stop');
        const judgement = yield* own.adapter.judge({ subject: stop.id, positions });
        expect(shown(judgement.verdicts[positions.findIndex((at) => at.path === 'svc/use.ts' && at.line === 20)] as Verdict)).toBe(
          'call in branch',
        );
        const [tool] = (yield* own.adapter.locate({ _tag: 'at', path: 'svc/use.ts', line: 19, name: 'tool' })).subjects;
        const declared = tool?.declarations.map((at) => `${at.path}:${at.line}`) ?? [];
        expect(declared).toEqual(['svc/node_modules/kit/node_modules/inner/index.d.ts:2']);
        const again = yield* own.adapter.locate({
          _tag: 'at',
          path: 'svc/node_modules/kit/node_modules/inner/index.d.ts',
          line: 2,
          name: 'tool',
        });
        expect(again.subjects.length).toBe(1);
        yield* worktree.rest;
        const rested = yield* worktree.ready.pipe(
          Effect.flatMap((served) => (served.snapshot.changed.length > 0 ? Effect.succeed(served) : Effect.fail('own' as const))),
          Effect.retry(Schedule.spaced('50 millis')),
        );
        expect(rested.snapshot.changed.toSorted()).toEqual(['bun.lock', 'svc/use.ts']);
      }),
  );

  it.effect('a moved HEAD alone brings the base to its tree after a commit, a reset and a file returned to its content at HEAD', () =>
    Effect.gen(function* () {
      const { root, checkout } = yield* resetSample;
      const files = yield* FileSystem.FileSystem;
      const use = `${root}/svc/use.ts`;
      const original = yield* files.readFileString(use);
      yield* git(root, ['add', '-A']);
      yield* git(root, ['commit', '-qm', 'base', '--allow-empty']);
      const first = (yield* git(root, ['rev-parse', 'HEAD'])).trim();
      yield* checkout.touch({ _tag: 'head' });
      yield* checkout.ready;
      yield* files.writeFileString(use, inserted(original, 1));
      yield* checkout.touch({ _tag: 'paths', paths: ['svc/use.ts'] });
      yield* settled(checkout);
      yield* git(root, ['checkout', '--', 'svc/use.ts']);
      yield* files.writeFileString(`${root}/bare/pad.ts`, `${yield* files.readFileString(`${root}/bare/pad.ts`)}export const more = 1;\n`);
      yield* git(root, ['commit', '-qam', 'pad']);
      expect((yield* movedTo(root, checkout))['svc/use.ts:7:20']).toBe('call in run');
      yield* files.writeFileString(use, inserted(original, 1));
      yield* git(root, ['commit', '-qam', 'first']);
      expect((yield* movedTo(root, checkout))['svc/use.ts:8:20']).toBe('call in run');
      yield* git(root, ['reset', '-q', '--hard', first]);
      const reset = yield* movedTo(root, checkout);
      expect([reset['svc/use.ts:7:20'], reset]).toEqual(['call in run', yield* rescanned(root, checkout)]);
    }),
  );

  it.effect('a rescan before any question names a file the snapshot holds edited though it returned to its content at HEAD', () =>
    Effect.gen(function* () {
      const { root, checkout } = yield* resetSample;
      const files = yield* FileSystem.FileSystem;
      const use = `${root}/svc/use.ts`;
      const original = yield* files.readFileString(use);
      yield* git(root, ['add', '-A']);
      yield* git(root, ['commit', '-qm', 'rescanned', '--allow-empty']);
      yield* checkout.touch({ _tag: 'head' });
      yield* files.writeFileString(use, inserted(original, 1));
      yield* checkout.touch({ _tag: 'paths', paths: ['svc/use.ts'] });
      yield* settled(checkout);
      yield* files.writeFileString(use, original);
      yield* checkout.touch({ _tag: 'rescan' });
      expect((yield* checkout.ready).snapshot.changed).toContain('svc/use.ts');
    }),
  );

  it.effect('a worktree whose HEAD moves keeps its own snapshot in step with its tree', () =>
    Effect.gen(function* () {
      const { root, process } = yield* resetSample;
      const files = yield* FileSystem.FileSystem;
      const tree = `${root}-moved`;
      yield* git(root, ['worktree', 'add', '-q', '--detach', tree, 'HEAD']);
      const use = `${tree}/svc/use.ts`;
      const original = yield* files.readFileString(use);
      yield* files.writeFileString(use, inserted(original, 1));
      yield* git(tree, ['commit', '-qam', 'one']);
      const one = (yield* git(tree, ['rev-parse', 'HEAD'])).trim();
      const worktree = yield* process.checkout(tree);
      yield* (yield* worktree.ready).adapter.locate(STOP);
      expect((yield* verdictsAt(tree, worktree))['svc/use.ts:8:20']).toBe('call in run');
      yield* files.writeFileString(use, inserted(original, 2));
      yield* git(tree, ['commit', '-qam', 'two']);
      expect((yield* movedTo(tree, worktree))['svc/use.ts:9:20']).toBe('call in run');
      yield* git(tree, ['reset', '-q', '--hard', one]);
      const reset = yield* movedTo(tree, worktree);
      expect([reset['svc/use.ts:8:20'], reset]).toEqual(['call in run', yield* rescanned(tree, worktree)]);
    }),
  );

  it.effect("a worktree's changed lockfile brings the new declarations of a dependency it installed over its own", () =>
    Effect.gen(function* () {
      const { root, process } = yield* resetSample;
      const files = yield* FileSystem.FileSystem;
      const tree = `${root}-installed`;
      yield* git(root, ['add', '-A']);
      yield* git(root, ['commit', '-qm', 'installed', '--allow-empty']);
      yield* git(root, ['worktree', 'add', '-q', '--detach', tree, 'HEAD']);
      const gear = `${tree}/svc/node_modules/gear`;
      yield* files.makeDirectory(gear, { recursive: true });
      yield* files.symlink(yield* files.realPath(`${root}/svc/node_modules/effect`), `${tree}/svc/node_modules/effect`);
      yield* files.writeFileString(`${gear}/package.json`, '{"name":"gear","version":"1.0.0","types":"index.d.ts"}\n');
      yield* files.writeFileString(`${gear}/index.d.ts`, 'export declare const gear: () => number;\n');
      yield* files.writeFileString(`${tree}/svc/geared.ts`, "import { gear } from 'gear';\nexport const geared = gear();\n");
      yield* files.writeFileString(`${tree}/bun.lock`, '{"lockfileVersion":1,"gear":"1.0.0"}\n');
      const worktree = yield* process.checkout(tree);
      yield* (yield* worktree.ready).adapter.locate(STOP);
      const declared = Effect.fnUntraced(function* () {
        const { adapter } = yield* settled(worktree);
        const [found] = (yield* adapter.locate({ _tag: 'at', path: 'svc/geared.ts', line: 2, name: 'gear' })).subjects;
        return found?.declarations.map((at) => `${at.path}:${at.line}`);
      });
      expect(yield* declared()).toEqual(['svc/node_modules/gear/index.d.ts:1']);
      yield* files.writeFileString(`${gear}/package.json`, '{"name":"gear","version":"2.0.0","types":"index.d.ts"}\n');
      yield* files.writeFileString(`${gear}/index.d.ts`, 'export declare const spare: 1;\nexport declare const gear: () => number;\n');
      yield* files.writeFileString(`${tree}/bun.lock`, '{"lockfileVersion":1,"gear":"2.0.0"}\n');
      yield* worktree.touch({ _tag: 'paths', paths: ['bun.lock'] });
      expect(yield* declared()).toEqual(['svc/node_modules/gear/index.d.ts:2']);
    }),
  );

  it.effect("a changed lockfile in the base brings its installed dependencies' new declarations", () =>
    Effect.gen(function* () {
      const { root, checkout } = yield* resetSample;
      const files = yield* FileSystem.FileSystem;
      const gear = `${root}/svc/node_modules/gear`;
      yield* files.makeDirectory(gear, { recursive: true });
      yield* files.writeFileString(`${gear}/package.json`, '{"name":"gear","version":"1.0.0","types":"index.d.ts"}\n');
      yield* files.writeFileString(`${gear}/index.d.ts`, 'export declare const gear: () => number;\n');
      yield* files.writeFileString(`${root}/svc/geared.ts`, "import { gear } from 'gear';\nexport const geared = gear();\n");
      yield* checkout.touch({ _tag: 'paths', paths: ['svc/geared.ts'] });
      const declared = Effect.fnUntraced(function* () {
        const { adapter } = yield* settled(checkout);
        const [found] = (yield* adapter.locate({ _tag: 'at', path: 'svc/geared.ts', line: 2, name: 'gear' })).subjects;
        return found?.declarations.map((at) => `${at.path}:${at.line}`);
      });
      expect(yield* declared()).toEqual(['svc/node_modules/gear/index.d.ts:1']);
      yield* files.writeFileString(`${gear}/index.d.ts`, 'export declare const spare: 1;\nexport declare const gear: () => number;\n');
      yield* files.writeFileString(`${root}/bun.lock`, '{"lockfileVersion":1,"gear":"2.0.0"}\n');
      yield* checkout.touch({ _tag: 'paths', paths: ['bun.lock'] });
      expect(yield* declared()).toEqual(['svc/node_modules/gear/index.d.ts:2']);
    }),
  );
});
