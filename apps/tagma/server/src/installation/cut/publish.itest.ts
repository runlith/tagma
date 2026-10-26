import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterAll, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, FileSystem, Layer } from 'effect';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { type Git, gitLayer } from '@runlith/git/Git';
import { type GitHubCli, ProgramFailed } from '@runlith/github/GitHubCli';
import type { IrreversibleChange } from '../contract/wire/manifest.js';
import { MAPS, RELEASE_RECORD, type ReleaseRecord } from './stage.js';
import { NotarizationRefused, type Notary } from './notarize.js';
import { publishRelease, tagOf } from './publish.js';

const REPO = 'test/tagma';
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'tagma-publish-')));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const spawning = BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));
const machine = Layer.mergeAll(gitLayer.pipe(Layer.provide(spawning)), BunFileSystem.layer);
const run = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Git>) => Effect.result(effect.pipe(Effect.provide(machine)));

const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const git = (args: readonly string[]) => Bun.spawnSync(['git', ...args], { stdout: 'pipe', stderr: 'pipe' });
const said = (args: readonly string[]) => git(args).stdout.toString().trim();

const bare = (name: string): string => {
  const remote = join(scratch, name);
  expect(git(['init', '-q', '--bare', '-b', 'main', remote]).exitCode).toBe(0);
  return remote;
};
const head = (remote: string): string => said(['--git-dir', remote, 'rev-parse', '--verify', '-q', 'refs/heads/main']);

const source = (name: string): string => {
  const checkout = join(scratch, name);
  mkdirSync(checkout);
  expect(git(['-C', checkout, 'init', '-q', '-b', 'main']).exitCode).toBe(0);
  expect(git(['-C', checkout, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'one']).exitCode).toBe(0);
  return checkout;
};

const cutInto = (
  at: string,
  checkout: string,
  release: string,
  image: boolean,
  irreversible: readonly IrreversibleChange[] = [],
): ReleaseRecord => {
  rmSync(at, { recursive: true, force: true });
  mkdirSync(join(at, MAPS), { recursive: true });
  writeFileSync(join(at, MAPS, 'http.js.map'), `{"release":"${release}"}`);
  const archive = `tagma-${release}-darwin-arm64.tar.gz`;
  const bytes = new TextEncoder().encode(`the archive of ${release}\n`);
  writeFileSync(join(at, archive), bytes);
  const x64 = `tagma-${release}-darwin-x64.tar.gz`;
  const x64Bytes = new TextEncoder().encode(`the x64 archive of ${release}\n`);
  writeFileSync(join(at, x64), x64Bytes);
  const images = { 'darwin-arm64': `Tagma-${release}-arm64.dmg`, 'darwin-x64': `Tagma-${release}-x64.dmg` };
  if (image) for (const [platform, dmg] of Object.entries(images)) writeFileSync(join(at, dmg), `the ${platform} dmg of ${release}\n`);
  const record: ReleaseRecord = {
    release,
    commit: said(['-C', checkout, 'rev-parse', 'HEAD']),
    archive,
    sha256: sha(bytes),
    size: bytes.length,
    platforms: {
      'darwin-arm64': { archive, sha256: sha(bytes), size: bytes.length },
      'darwin-x64': { archive: x64, sha256: sha(x64Bytes), size: x64Bytes.length },
    },
    images,
    stores: { 'machine-store': [], 'host-store': [], graph: [], journal: [] },
    irreversible,
    notarized: false,
  };
  writeFileSync(join(at, RELEASE_RECORD), JSON.stringify(record));
  return record;
};

const apple = () => {
  const sealed: string[] = [];
  const failing = { refuse: false };
  const notary: Notary = {
    seal: (cut, into, record) =>
      Effect.suspend(() => {
        sealed.push(record.release);
        if (failing.refuse) return Effect.fail(new NotarizationRefused({ detail: 'Apple answered Invalid', unblock: [] }));
        mkdirSync(into, { recursive: true });
        for (const file of [...Object.values(record.platforms).map((one) => one.archive), ...Object.values(record.images)])
          writeFileSync(join(into, file), readFileSync(join(cut, file)));
        return Effect.succeed({ ...record, notarized: true });
      }),
  };
  return { notary, sealed, failing };
};
const notarizing = apple().notary;

type Held = { draft: boolean; assets: { name: string; size: number; state: string; digest: string }[] };

const github = (remote: string) => {
  const releases = new Map<string, Held>();
  const calls: string[] = [];
  const failing = { upload: false };
  const answer = (stdout: string) => Effect.succeed({ status: 0 as const, stdout, stderr: '' });
  const cli: GitHubCli = {
    run: (args) =>
      Effect.suspend(() => {
        const [, verb = '', tag = ''] = args;
        const uploads = verb === 'upload' ? args.slice(3, args.indexOf('--repo')) : [];
        if (verb !== 'view') calls.push([verb, tag, ...uploads.map((path) => basename(path)), `@${head(remote)}`].join(' '));
        const held = releases.get(tag);
        if (verb === 'create') {
          if (held !== undefined) return Effect.fail(new ProgramFailed({ phase: 'exit', detail: 'tag already exists', status: 1 }));
          releases.set(tag, { draft: args.includes('--draft'), assets: [] });
          return answer('');
        }
        if (held === undefined) {
          return Effect.fail(
            new ProgramFailed({ phase: 'exit', detail: 'release not found', status: 1, stdout: '', stderr: 'release not found\n' }),
          );
        }
        if (verb === 'view') {
          const at = held.draft ? 'untagged-0' : tag;
          const assets = held.assets.map((one) => ({ ...one, url: `https://github.com/${REPO}/releases/download/${at}/${one.name}` }));
          return answer(JSON.stringify({ isDraft: held.draft, url: `https://github.com/${REPO}/releases/tag/${tag}`, assets }));
        }
        if (verb === 'upload') {
          for (const path of uploads) {
            const bytes = readFileSync(path);
            const name = basename(path);
            held.assets = [
              ...held.assets.filter((one) => one.name !== name),
              { name, size: bytes.length, state: 'uploaded', digest: `sha256:${sha(bytes)}` },
            ];
            if (failing.upload) return Effect.fail(new ProgramFailed({ phase: 'exit', detail: 'connection reset', status: 1 }));
          }
          return answer('');
        }
        if (verb === 'edit') {
          if (args.includes('--draft=false')) held.draft = false;
          return answer('');
        }
        return Effect.fail(new ProgramFailed({ phase: 'exit', detail: `gh release ${verb} is not faked`, status: 1 }));
      }),
  };
  return { cli, calls, failing, releases };
};

const download = (record: ReleaseRecord) => `https://github.com/${REPO}/releases/download/${tagOf(record.release)}/${record.archive}`;
const feedOn = (
  remote: string,
): { releases: { release: string; archive: string; platforms: ReleaseRecord['platforms']; irreversible: boolean; changes: unknown[] }[] } =>
  JSON.parse(said(['--git-dir', remote, 'show', 'main:feed.json']));

it.live(
  'a release reaches the feed only after the archive and DMG of every platform are published, publishing again after a failed upload finishes it, and its commit is tagged and its maps kept',
  () =>
    Effect.gen(function* () {
      const remote = bare('feed.git');
      const checkout = source('source');
      const cut = join(scratch, 'release');
      const kept = join(scratch, 'maps');
      const gh = github(remote);
      const place = { cut, checkout, repo: REPO, remote, kept };

      const first = cutInto(cut, checkout, '0.1.0', true);
      gh.failing.upload = true;
      const broken = yield* run(publishRelease(gh.cli, notarizing, place));
      gh.failing.upload = false;
      const one = yield* run(publishRelease(gh.cli, notarizing, place));
      const second = cutInto(cut, checkout, '0.1.1', true, [{ store: 'machine-store', release: '0.1.1' }]);
      const two = yield* run(publishRelease(gh.cli, notarizing, place));
      const atTwo = head(remote);
      const again = yield* run(publishRelease(gh.cli, notarizing, place));

      expect(broken._tag === 'Failure' && broken.failure.step).toBe('upload');
      if (one._tag !== 'Success' || two._tag !== 'Success' || again._tag !== 'Success') return yield* Effect.die('a publish was refused');
      const atOne = one.success.feed ?? '';
      expect(atOne).not.toBe('');
      for (const record of [first, second]) {
        expect(
          gh.releases
            .get(tagOf(record.release))
            ?.assets.map((one) => one.name)
            .sort(),
        ).toEqual([...Object.values(record.platforms).map((one) => one.archive), ...Object.values(record.images)].sort());
        expect(feedOn(remote).releases.find((one) => one.release === record.release)?.platforms['darwin-x64']).toEqual({
          ...record.platforms['darwin-x64']!,
          archive: `https://github.com/${REPO}/releases/download/${tagOf(record.release)}/${record.platforms['darwin-x64']!.archive}`,
        });
      }
      expect(again.success.feed).toBeNull();
      expect(head(remote)).toBe(atTwo);
      expect(feedOn(remote).releases.map((one) => [one.release, one.archive, one.irreversible, one.changes])).toEqual([
        ['0.1.1', download(second), true, [{ store: 'machine-store', release: '0.1.1' }]],
        ['0.1.0', download(first), false, []],
      ]);
      expect(said(['-C', checkout, 'tag', '--list'])).toBe('v0.1.0\nv0.1.1');
      expect(readFileSync(join(kept, '0.1.0', 'http.js.map'), 'utf8')).toBe('{"release":"0.1.0"}');
    }),
);

it.live(
  'a draft holding other bytes is uploaded again before it goes public, and a refused feed push is finished by publishing again',
  () =>
    Effect.gen(function* () {
      const remote = bare('guarded.git');
      const hook = join(remote, 'hooks', 'pre-receive');
      writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
      const checkout = source('guarded-source');
      const cut = join(scratch, 'guarded-release');
      const record = cutInto(cut, checkout, '0.1.0', true);
      const gh = github(remote);
      gh.releases.set('v0.1.0', {
        draft: true,
        assets: [{ name: record.archive, size: record.size, state: 'uploaded', digest: `sha256:${'0'.repeat(64)}` }],
      });
      const place = { cut, checkout, repo: REPO, remote, kept: join(scratch, 'guarded-maps') };

      const pushed = yield* run(publishRelease(gh.cli, notarizing, place));
      const before = gh.releases.get('v0.1.0');
      rmSync(hook);
      const finished = yield* run(publishRelease(gh.cli, notarizing, place));

      expect(pushed._tag === 'Failure' && pushed.failure.step).toBe('feed');
      expect(before?.draft).toBe(false);
      expect(before?.assets.find((one) => one.name === record.archive)?.digest).toBe(`sha256:${record.sha256}`);
      expect(finished._tag === 'Success' && finished.success.feed).toBe(head(remote));
      expect(feedOn(remote).releases.map((one) => one.release)).toEqual(['0.1.0']);
    }),
);

it.live('a cut Apple refuses reaches neither GitHub nor the feed, and a notarized cut is not sent to Apple again', () =>
  Effect.gen(function* () {
    const remote = bare('notarized.git');
    const checkout = source('notarized-source');
    const cut = join(scratch, 'notarized-release');
    const gh = github(remote);
    const notarized = apple();
    const place = { cut, checkout, repo: REPO, remote, kept: join(scratch, 'notarized-maps') };

    cutInto(cut, checkout, '0.1.0', true);
    notarized.failing.refuse = true;
    const refused = yield* run(publishRelease(gh.cli, notarized.notary, place));
    const callsRefused = gh.calls.length;
    notarized.failing.refuse = false;
    gh.failing.upload = true;
    yield* run(publishRelease(gh.cli, notarized.notary, place));
    gh.failing.upload = false;
    const finished = yield* run(publishRelease(gh.cli, notarized.notary, place));

    expect(refused._tag === 'Failure' && refused.failure.step).toBe('notarization');
    expect(callsRefused).toBe(0);
    expect(notarized.sealed).toEqual(['0.1.0', '0.1.0']);
    expect(JSON.parse(readFileSync(join(cut, RELEASE_RECORD), 'utf8')).notarized).toBe(true);
    expect(finished._tag === 'Success' && feedOn(remote).releases.map((one) => one.release)).toEqual(['0.1.0']);
  }),
);

it.live(
  'a cut without its DMG, and a cut older than what was published since, are refused before anything reaches GitHub or the feed',
  () =>
    Effect.gen(function* () {
      const remote = bare('untouched.git');
      const checkout = source('untouched-source');
      const cut = join(scratch, 'untouched-release');
      const gh = github(remote);
      const place = { cut, checkout, repo: REPO, remote, kept: join(scratch, 'untouched-maps') };

      cutInto(cut, checkout, '0.1.0', false);
      const imageless = yield* run(publishRelease(gh.cli, notarizing, place));
      cutInto(cut, checkout, '0.1.1', true);
      yield* run(publishRelease(gh.cli, notarizing, place));
      const calls = gh.calls.length;
      cutInto(cut, checkout, '0.1.0', true);
      const older = yield* run(publishRelease(gh.cli, notarizing, place));

      expect(imageless._tag === 'Failure' && imageless.failure.step).toBe('release');
      expect(older._tag === 'Failure' && older.failure.step).toBe('version');
      expect(gh.calls.length).toBe(calls);
      expect(feedOn(remote).releases.map((one) => one.release)).toEqual(['0.1.1']);
    }),
);
