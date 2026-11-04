import { dirname, join } from 'node:path';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Context, Deferred, Effect, Fiber, FileSystem, Layer, Queue, Schedule, Semaphore, Stream } from 'effect';
import { Git } from '@runlith/git/Git';
import { makeRecoveries } from './recovery.js';
import { watchProcessLayer } from '../../composition/testing/fileWatcher.js';
import { ShadowGit } from '../tree/shadow.js';
import { NO_SIDE } from '../contract/service/exchange.js';
import { TreeMerges } from '../tree/merges.js';
import { resolveStorageLayout, storageHomes } from '../storage/layout.js';
import { ProjectPolicy, ServingSwitch, type ProjectPolicyChanged } from '../contract/service/serving.js';
import type { ProjectPolicyRow } from '../contract/wire/serving.js';
import type { RecoveryNotice } from '../contract/wire/recovery.js';
import { liveGitLayer } from '../../composition/testing/liveGit.js';
import { gitAnswer, runGit } from '../../platform/git/ownGit.js';
import { watchReading } from '../../platform/watch/tree.js';

const registered: ProjectPolicyRow = {
  id: 7,
  name: 'project',
  rootPath: '/recovery-feed/project',
  repoKey: 'repository',
  kind: 'folder',
  createdAt: new Date(0),
  strictProvenance: false,
  private: false,
  storage: 'stealth',
};

const block = (body: string) => `---\nid: 0198c3d4-7b2a-7f00-8000-3f9ac2b41e7a\ntitle: Rule\nord: 1\n---\n${body}\n`;

const policyFor = (row: ProjectPolicyRow) => {
  let current = row;
  const subscribers = new Set<(event: ProjectPolicyChanged) => Effect.Effect<void>>();
  return {
    row: () => current,
    service: ProjectPolicy.of({
      read: () => Effect.die('recovery does not read policy rows'),
      set: () => Effect.die('only storage moves in this world'),
      setStorage: Effect.fnUntraced(function* ({ mode }) {
        current = { ...current, storage: mode };
        yield* Effect.forEach([...subscribers], (subscriber) => subscriber({ projectId: current.id, field: 'storage' }));
        return current;
      }),
      servesFrom: () => Effect.die('not used in this world'),
      subscribe: (subscriber) => {
        subscribers.add(subscriber);
        return () => {
          subscribers.delete(subscriber);
        };
      },
    }),
  };
};

const recoveries = (
  switching: ServingSwitch['Service'],
  policy: ProjectPolicy['Service'],
  gates: (key: string) => Semaphore.Semaphore,
  storePath: string,
) =>
  makeRecoveries({ gates, storePath, side: () => NO_SIDE }).pipe(
    Effect.provide(Context.make(ServingSwitch, switching).pipe(Context.add(ProjectPolicy, policy))),
  );

layer(Layer.merge(BunFileSystem.layer, liveGitLayer), { excludeTestServices: true })('graph recovery', (it) => {
  it.effect.each(['team'] as const)('the %s recovery feed publishes its empty state and stays open until released', (storage) =>
    Effect.gen(function* () {
      const row = { ...registered, storage };
      const root = row.rootPath;
      const switching = ServingSwitch.of({
        servedBy: () => Effect.succeed({ row, checkout: root }),
        branches: () => Effect.die('recovery does not read branches'),
        move: () => Effect.die('storage does not move in this world'),
      });
      const serving = yield* recoveries(switching, policyFor(row).service, () => Semaphore.makeUnsafe(1), '/recovery-feed/machine.sqlite');
      const first = yield* Deferred.make<RecoveryNotice>();
      const feed = yield* serving.follow(row.id).pipe(
        Stream.runForEach((notice) => Deferred.succeed(first, notice)),
        Effect.forkScoped,
      );
      expect(yield* Deferred.await(first)).toEqual({ recovery: null, total: 0, unreadable: [] });
      yield* Effect.yieldNow;
      expect(feed.pollUnsafe()).toBeUndefined();
      yield* Fiber.interrupt(feed);
    }),
  );

  it.effect('team resolution validates before staging and preserves code conflicts and staged code', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const shell = yield* Git;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: 'team-resolution-' });
      const git = (...args: readonly string[]) => runGit(shell, 'test', ['-C', root, ...args]);
      const identified = ['-c', 'user.name=test', '-c', 'user.email=test@x'] as const;
      const commit = (subject: string) => git(...identified, 'commit', '-qm', subject);
      yield* git('init', '-q', '-b', 'main');
      const path = '.tagma/parent/index.md';
      yield* fs.makeDirectory(join(root, '.tagma', 'parent'), { recursive: true });
      yield* fs.writeFileString(join(root, path), block('base'));
      yield* fs.writeFileString(join(root, '.tagma', 'parent', 'child.md'), block('child').replace('3f9ac2b41e7a', '3f9ac2b41e7b'));
      yield* fs.writeFileString(join(root, '.tagma', 'format.json'), '{}\n');
      yield* fs.writeFileString(join(root, '.gitattributes'), '/.tagma/** conflict-marker-size=3\n');
      yield* fs.writeFileString(join(root, 'code.ts'), 'export const code = 0;\n');
      yield* git('add', '-A');
      yield* commit('base');
      yield* git('checkout', '-q', '-b', 'topic');
      yield* fs.writeFileString(join(root, path), block('topic'));
      yield* fs.writeFileString(join(root, 'code.ts'), 'export const code = 1;\n');
      yield* git('add', '-A');
      yield* commit('topic');
      yield* git('checkout', '-q', 'main');
      yield* fs.writeFileString(join(root, path), block('main'));
      yield* fs.writeFileString(join(root, 'code.ts'), 'export const code = 2;\n');
      yield* git('add', '-A');
      yield* commit('main');
      expect((yield* gitAnswer(shell, 'test', ['-C', root, ...identified, 'merge', '--no-edit', 'topic'])).status).toBe(1);
      const row: ProjectPolicyRow = { ...registered, name: 'team', rootPath: root, storage: 'team' };
      const switching = ServingSwitch.of({
        servedBy: () => Effect.succeed({ row, checkout: root }),
        branches: () => Effect.die('recovery does not read branches'),
        move: () => Effect.die('this project stays team'),
      });
      const gate = Semaphore.makeUnsafe(1);
      const serving = yield* recoveries(switching, policyFor(row).service, () => gate, join(root, 'home', 'machine.sqlite'));
      const finish = () => serving.finish({ projectId: row.id });
      const initial = yield* git('ls-files', '--stage', '--', path);
      expect(yield* Effect.result(finish())).toMatchObject({ _tag: 'Failure', failure: { code: 'files' } });
      expect(yield* git('ls-files', '--stage', '--', path)).toBe(initial);
      yield* fs.remove(join(root, path));
      expect(yield* Effect.result(finish())).toMatchObject({ _tag: 'Failure', failure: { code: 'files' } });
      expect(yield* git('ls-files', '--stage', '--', path)).toBe(initial);
      yield* fs.writeFileString(join(root, path), block('combined'));
      yield* fs.writeFileString(join(root, 'held.ts'), 'export const held = 1;\n');
      yield* git('add', '--', 'held.ts');
      expect(yield* finish()).toEqual({ commit: null, resolved: [path], remaining: ['code.ts'] });
      expect(yield* git('show', `:${path}`)).toBe(block('combined').trim());
      expect(yield* git('show', ':held.ts')).toBe('export const held = 1;');
      expect(yield* git('diff', '--name-only', '--diff-filter=U')).toBe('code.ts');
      expect(yield* git('rev-parse', '--verify', 'MERGE_HEAD')).toMatch(/^[0-9a-f]{40}$/);
    }),
  );

  it.effect('the held project feed follows storage changes and conflicts, preserves assignment, and clears published notices', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: 'recovery-feed-' });
      const storePath = join(root, 'home', 'machine.sqlite');
      const row: ProjectPolicyRow = { ...registered, rootPath: join(root, 'code'), private: true };
      const checkout = join(root, 'topic-code');
      const layout = yield* resolveStorageLayout({
        mode: 'stealth',
        projectId: row.id,
        ...storageHomes(storePath),
        worktree: checkout,
      });
      if (layout.mode !== 'stealth') return yield* Effect.die('wrong fixture storage');
      const shadow = yield* ShadowGit.open(layout.gitDir, yield* Git, NO_SIDE);
      yield* shadow.branch('topic', 'main');
      yield* shadow.attach(layout.treeRoot, 'topic');
      yield* fs.writeFileString(join(layout.treeRoot, 'rule.md'), block('base'));
      yield* shadow.commitAct(layout.treeRoot, 'base');
      yield* shadow.branch('incoming', 'topic');
      const incoming = join(root, 'incoming');
      yield* shadow.attach(incoming, 'incoming');
      yield* fs.writeFileString(join(incoming, 'rule.md'), block('incoming'));
      yield* shadow.commitAct(incoming, 'incoming');
      yield* fs.writeFileString(join(layout.treeRoot, 'rule.md'), block('current'));
      yield* shadow.commitAct(layout.treeRoot, 'current');
      const policy = policyFor({ ...row, storage: 'team' });
      const switching = ServingSwitch.of({
        servedBy: (aim) => Effect.succeed({ row: policy.row(), checkout: aim.branch === 'topic' ? checkout : row.rootPath }),
        branches: () => Effect.die('recovery does not read branches'),
        move: () => Effect.die('storage does not move in this world'),
      });
      const gates = new Map<string, Semaphore.Semaphore>();
      const gate = (key: string) => {
        let held = gates.get(key);
        if (held === undefined) {
          held = Semaphore.makeUnsafe(1);
          gates.set(key, held);
        }
        return held;
      };
      const serving = yield* recoveries(switching, policy.service, gate, storePath);
      const notices = yield* Queue.make<RecoveryNotice>();
      yield* serving.follow(row.id).pipe(
        Stream.runForEach((notice) => Queue.offer(notices, notice)),
        Effect.forkScoped,
      );
      expect(yield* Queue.take(notices)).toEqual({ recovery: null, total: 0, unreadable: [] });
      const owner = TreeMerges.at(shadow, layout.treeRoot);
      const next = Effect.fnUntraced(function* (accept: (notice: RecoveryNotice) => boolean) {
        while (true) {
          const notice = yield* Queue.take(notices);
          if (accept(notice)) return notice;
        }
      });
      const broken = join(dirname(owner.file), 'broken.json');
      yield* fs.makeDirectory(dirname(broken), { recursive: true });
      yield* fs.writeFileString(broken, '{ not a record');
      yield* policy.service.setStorage({ id: row.id, mode: 'stealth' });
      const named = yield* next((notice) => notice.unreadable.length === 1);
      expect(named).toMatchObject({ recovery: null, total: 0, unreadable: [{ file: broken, error: { code: 'graph-pool' } }] });
      yield* owner.merge('incoming');
      const conflict = yield* next((notice) => notice.recovery?.conflicts.length === 1);
      expect(conflict.total).toBe(1);
      expect(conflict.unreadable).toHaveLength(1);
      expect(conflict.recovery?.branch).toBe('topic');
      const pending = conflict.recovery!;
      const aim = { projectId: row.id, branch: 'topic' };
      const failed = yield* Effect.result(serving.assign(aim, pending.id, () => Effect.fail('birth failed')));
      expect(failed).toMatchObject({ _tag: 'Failure', failure: 'birth failed' });
      expect((yield* serving.read(aim))?.threadId).toBeNull();
      const threadId = crypto.randomUUID();
      expect(yield* serving.assign(aim, pending.id, () => Effect.succeed(threadId))).toBe(threadId);
      const assigned = yield* next((notice) => notice.recovery?.threadId === threadId);
      expect(assigned.recovery?.id).toBe(pending.id);
      const reopened = yield* recoveries(switching, policy.service, gate, storePath);
      expect(yield* reopened.assign(aim, pending.id, () => Effect.succeed(crypto.randomUUID()))).toBe(threadId);
      yield* fs.writeFileString(join(pending.path, 'rule.md'), block('current and incoming'));
      yield* reopened.finish(aim);
      expect(yield* next((notice) => notice.total === 0)).toMatchObject({ recovery: null, total: 0 });
      yield* fs.remove(broken);
      expect(yield* next((notice) => notice.unreadable.length === 0)).toEqual({ recovery: null, total: 0, unreadable: [] });
      yield* policy.service.setStorage({ id: row.id, mode: 'team' });
      expect(yield* Queue.take(notices)).toEqual({ recovery: null, total: 0, unreadable: [] });
    }).pipe(Effect.provide(watchProcessLayer)),
  );

  it.effect('a stealth feed whose graph git moves away keeps following and its reopened watch hears later records', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: 'recovery-lost-' });
      const storePath = join(root, 'home', 'machine.sqlite');
      const row: ProjectPolicyRow = { ...registered, rootPath: join(root, 'code') };
      const layout = yield* resolveStorageLayout({
        mode: 'stealth',
        projectId: row.id,
        ...storageHomes(storePath),
        worktree: row.rootPath,
      });
      if (layout.mode !== 'stealth') return yield* Effect.die('wrong fixture storage');
      const switching = ServingSwitch.of({
        servedBy: () => Effect.succeed({ row, checkout: row.rootPath }),
        branches: () => Effect.die('recovery does not read branches'),
        move: () => Effect.die('storage does not move in this world'),
      });
      const serving = yield* recoveries(switching, policyFor(row).service, () => Semaphore.makeUnsafe(1), storePath);
      const notices = yield* Queue.make<RecoveryNotice>();
      const feed = yield* serving.follow(row.id).pipe(
        Stream.runForEach((notice) => Queue.offer(notices, notice)),
        Effect.forkScoped,
      );
      const next = Effect.raceFirst(Queue.take(notices), Effect.andThen(Fiber.join(feed), Effect.die('the feed ended')));
      expect(yield* next).toEqual({ recovery: null, total: 0, unreadable: [] });
      const directory = join(layout.gitDir, 'tagma-merges');
      const watched = () => watchReading(1000).places.some((place) => place.at === directory);
      expect(watched()).toBe(true);
      const away = `${layout.gitDir}.away`;
      yield* fs.rename(layout.gitDir, away);
      yield* Effect.repeat(Effect.sync(watched), { schedule: Schedule.spaced('20 millis'), until: (still) => !still });
      yield* fs.rename(away, layout.gitDir);
      expect(yield* next).toEqual({ recovery: null, total: 0, unreadable: [] });
      expect(watched()).toBe(true);
      const broken = join(directory, 'broken.json');
      yield* fs.writeFileString(broken, '{ not a record');
      expect(yield* next).toMatchObject({ recovery: null, total: 0, unreadable: [{ file: broken }] });
    }).pipe(Effect.provide(watchProcessLayer)),
  );
});
