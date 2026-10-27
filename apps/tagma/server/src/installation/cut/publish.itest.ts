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
import { compareReleases, type Feed, releaseFile } from '../contract/wire/feed.js';
import type { IrreversibleChange } from '../contract/wire/manifest.js';
import { MAPS, RELEASE_RECORD, type ReleaseRecord } from './stage.js';
import { NotarizationRefused, type Notary } from './notarize.js';
import { publishRelease } from './publish.js';

const REPO = 'test/tagma';
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'tagma-publish-')));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const spawning = BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));
const machine = Layer.mergeAll(gitLayer.pipe(Layer.provide(spawning)), BunFileSystem.layer);
const run = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Git>) => Effect.result(effect.pipe(Effect.provide(machine)));

const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const git = (args: readonly string[]) => Bun.spawnSync(['git', ...args], { stdout: 'pipe', stderr: 'pipe' });
const said = (args: readonly string[]) => git(args).stdout.toString().trim();

const source = (name: string): string => {
  const checkout = join(scratch, name);
  mkdirSync(checkout);
  expect(git(['-C', checkout, 'init', '-q', '-b', 'main']).exitCode).toBe(0);
  return checkout;
};
const committed = (checkout: string): string => {
  expect(git(['-C', checkout, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'cut']).exitCode).toBe(0);
  return said(['-C', checkout, 'rev-parse', 'HEAD']);
};

const cutInto = (
  at: string,
  commit: string,
  release: string,
  image = true,
  irreversible: readonly IrreversibleChange[] = [],
): ReleaseRecord => {
  rmSync(at, { recursive: true, force: true });
  mkdirSync(join(at, MAPS), { recursive: true });
  writeFileSync(join(at, MAPS, 'http.js.map'), `{"release":"${release}"}`);
  const platforms: Record<string, { archive: string; sha256: string; size: number }> = {};
  const images: Record<string, string> = {};
  for (const arch of ['arm64', 'x64']) {
    const archive = `tagma-${release}-darwin-${arch}.tar.gz`;
    const bytes = new TextEncoder().encode(`the ${arch} archive of ${release} at ${commit}\n`);
    writeFileSync(join(at, archive), bytes);
    platforms[`darwin-${arch}`] = { archive, sha256: sha(bytes), size: bytes.length };
    images[`darwin-${arch}`] = `Tagma-${release}-${arch}.dmg`;
    if (image) writeFileSync(join(at, images[`darwin-${arch}`]!), `the ${arch} dmg of ${release}\n`);
  }
  const record: ReleaseRecord = {
    release,
    commit,
    platforms,
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

type Held = {
  draft: boolean;
  prerelease: boolean;
  target: string;
  assets: { name: string; size: number; state: string; digest: string; bytes: Uint8Array }[];
};

const github = () => {
  const releases = new Map<string, Held>();
  const pushed = new Set<string>();
  const failing = { upload: false };
  const access = { push: true };
  let latest: string | null = null;
  const answer = (stdout: string) => Effect.succeed({ status: 0 as const, stdout, stderr: '' });
  const failed = (stderr: string) => Effect.fail(new ProgramFailed({ phase: 'exit', detail: stderr, status: 1, stdout: '', stderr }));
  const latestTag = (): string | null => {
    const marked = latest === null ? undefined : releases.get(latest);
    if (latest !== null && marked !== undefined && !marked.draft && !marked.prerelease) return latest;
    return (
      [...releases.entries()]
        .filter(([, one]) => !one.draft && !one.prerelease)
        .map(([tag]) => tag)
        .toSorted((a, b) => compareReleases(b.slice(1), a.slice(1)))[0] ?? null
    );
  };
  const api = (args: readonly string[]) => {
    const path = args.find((one) => one.startsWith('repos/')) ?? '';
    if (path === `repos/${REPO}`) return answer(JSON.stringify({ permissions: { push: access.push } }));
    if (path.startsWith(`repos/${REPO}/commits/`)) {
      const commit = path.slice(`repos/${REPO}/commits/`.length);
      return pushed.has(commit) ? answer(`${commit}\n`) : failed(`gh: No commit found for SHA: ${commit} (HTTP 422)`);
    }
    if (path.startsWith(`repos/${REPO}/releases`)) {
      return answer([...releases.entries()].flatMap(([tag, one]) => (one.draft ? [] : [`${tag}\n`])).join(''));
    }
    return failed(`gh api ${path} is not faked`);
  };
  const cli: GitHubCli = {
    run: (args) =>
      Effect.suspend(() => {
        if (args[0] === 'api') return api(args);
        const verb = args[1] ?? '';
        const tag = args[2]?.startsWith('--') === false ? args[2] : latestTag();
        const held = tag === null ? undefined : releases.get(tag);
        if (verb === 'create') {
          if (held !== undefined) return failed('tag already exists');
          releases.set(tag!, {
            draft: args.includes('--draft'),
            prerelease: false,
            target: args[args.indexOf('--target') + 1]!,
            assets: [],
          });
          return answer('');
        }
        if (held === undefined || tag === null) return failed('release not found\n');
        if (verb === 'view') {
          const at = held.draft ? 'untagged-0' : tag;
          const assets = held.assets.map(({ bytes: _, ...one }) => ({
            ...one,
            url: `https://github.com/${REPO}/releases/download/${at}/${one.name}`,
          }));
          return answer(
            JSON.stringify({
              tagName: tag,
              isDraft: held.draft,
              isPrerelease: held.prerelease,
              url: `https://github.com/${REPO}/releases/tag/${tag}`,
              targetCommitish: held.target,
              assets,
            }),
          );
        }
        if (verb === 'download') {
          const name = args[args.indexOf('--pattern') + 1]!;
          const found = held.assets.find((one) => one.name === name);
          if (found === undefined) return failed('no assets match the file pattern\n');
          writeFileSync(join(args[args.indexOf('--dir') + 1]!, name), found.bytes);
          return answer('');
        }
        if (verb === 'upload') {
          for (const path of args.slice(3, args.indexOf('--repo'))) {
            const bytes = new Uint8Array(readFileSync(path));
            const name = basename(path);
            held.assets = [
              ...held.assets.filter((one) => one.name !== name),
              { name, size: bytes.length, state: 'uploaded', digest: `sha256:${sha(bytes)}`, bytes },
            ];
            if (failing.upload) return failed('connection reset');
          }
          return answer('');
        }
        if (verb === 'edit') {
          if (args.includes('--target')) held.target = args[args.indexOf('--target') + 1]!;
          if (args.includes('--draft=false')) held.draft = false;
          if (args.includes('--latest')) latest = tag;
          return answer('');
        }
        return failed(`gh release ${verb} is not faked`);
      }),
  };
  const feedOf = (tag: string): Feed => {
    const bytes = releases.get(tag)?.assets.find((one) => one.name === 'feed.json')?.bytes;
    return JSON.parse(new TextDecoder().decode(bytes));
  };
  return { cli, releases, pushed, failing, access, latestTag, feedOf };
};

const placeOf = (name: string) => {
  const checkout = source(`${name}-source`);
  return { cut: join(scratch, `${name}-release`), checkout, repo: REPO, kept: join(scratch, `${name}-maps`) };
};

it.live(
  'a release goes public only with every archive, DMG and its feed in place, tagged on its commit; publishing again after a failed upload finishes it, and the next release carries the feed before it',
  () =>
    Effect.gen(function* () {
      const gh = github();
      const notarizing = apple().notary;
      const place = placeOf('journey');
      const firstCommit = committed(place.checkout);
      gh.pushed.add(firstCommit);
      const first = cutInto(place.cut, firstCommit.slice(0, 10), '0.2.0');

      gh.failing.upload = true;
      const broken = yield* run(publishRelease(gh.cli, notarizing, place));
      const draft = structuredClone(gh.releases.get('v0.2.0'));
      gh.failing.upload = false;
      const one = yield* run(publishRelease(gh.cli, notarizing, place));

      expect(broken._tag === 'Failure' && broken.failure.step).toBe('upload');
      expect(draft).toMatchObject({ draft: true, target: firstCommit });
      expect(gh.latestTag()).toBe('v0.2.0');
      expect(gh.releases.get('v0.2.0')).toMatchObject({ draft: false, prerelease: false, target: firstCommit });
      expect(
        gh.releases
          .get('v0.2.0')
          ?.assets.map((asset) => asset.name)
          .sort(),
      ).toEqual([...Object.values(first.platforms).map((archive) => archive.archive), ...Object.values(first.images), 'feed.json'].sort());
      expect(gh.feedOf('v0.2.0').releases.map((entry) => [entry.release, entry.platforms['darwin-x64']])).toEqual([
        ['0.2.0', { ...first.platforms['darwin-x64']!, archive: releaseFile(REPO, '0.2.0', first.platforms['darwin-x64']!.archive) }],
      ]);
      expect(one._tag === 'Success' && one.success.feed).toBe(releaseFile(REPO, '0.2.0', 'feed.json'));
      expect(said(['-C', place.checkout, 'rev-parse', 'v0.2.0^{commit}'])).toBe(firstCommit);
      expect(readFileSync(join(place.kept, '0.2.0', 'http.js.map'), 'utf8')).toBe('{"release":"0.2.0"}');

      const secondCommit = committed(place.checkout);
      gh.pushed.add(secondCommit);
      cutInto(place.cut, secondCommit.slice(0, 10), '0.2.1', true, [{ store: 'machine-store', release: '0.2.1' }]);
      const two = yield* run(publishRelease(gh.cli, notarizing, place));
      const published = structuredClone([...gh.releases.entries()]);
      const again = yield* run(publishRelease(gh.cli, notarizing, place));

      expect(two._tag).toBe('Success');
      expect(again._tag).toBe('Success');
      expect(gh.latestTag()).toBe('v0.2.1');
      expect(gh.feedOf('v0.2.1').releases.map((entry) => [entry.release, entry.irreversible])).toEqual([
        ['0.2.1', true],
        ['0.2.0', false],
      ]);
      expect([...gh.releases.entries()]).toEqual(published);
      expect(said(['-C', place.checkout, 'tag', '--list'])).toBe('v0.2.0\nv0.2.1');
    }),
);

it.live(
  'a release taken down as a prerelease is not published again, the next one is offered over the release before it, and a number this checkout published once is not published twice',
  () =>
    Effect.gen(function* () {
      const gh = github();
      const notarizing = apple().notary;
      const place = placeOf('takedown');
      for (const release of ['0.2.0', '0.2.1']) {
        const commit = committed(place.checkout);
        gh.pushed.add(commit);
        cutInto(place.cut, commit, release);
        expect((yield* run(publishRelease(gh.cli, notarizing, place)))._tag).toBe('Success');
      }
      gh.releases.get('v0.2.1')!.prerelease = true;

      const takenDown = yield* run(publishRelease(gh.cli, notarizing, place));
      const commit = committed(place.checkout);
      gh.pushed.add(commit);
      cutInto(place.cut, commit, '0.2.2');
      const next = yield* run(publishRelease(gh.cli, notarizing, place));
      const latest = gh.latestTag();
      const offered = gh.feedOf('v0.2.2').releases.map((entry) => entry.release);
      gh.releases.delete('v0.2.2');
      const reused = yield* run(publishRelease(gh.cli, notarizing, place));

      expect(takenDown._tag === 'Failure' && takenDown.failure.step).toBe('release');
      expect(next._tag).toBe('Success');
      expect(latest).toBe('v0.2.2');
      expect(offered).toEqual(['0.2.2', '0.2.0']);
      expect(reused._tag === 'Failure' && reused.failure.step).toBe('version');
      expect(gh.releases.has('v0.2.2')).toBe(false);
    }),
);

it.live(
  'a cut Apple refuses, one whose commit is not on GitHub, one the account cannot push, one without its DMG and one not newer than what is published leave GitHub as it was',
  () =>
    Effect.gen(function* () {
      const gh = github();
      const notarized = apple();
      const place = placeOf('refused');
      const cut = committed(place.checkout);

      cutInto(place.cut, cut, '0.2.0');
      const unpushed = yield* run(publishRelease(gh.cli, notarized.notary, place));
      gh.pushed.add(cut);
      gh.access.push = false;
      const unwritable = yield* run(publishRelease(gh.cli, notarized.notary, place));
      gh.access.push = true;
      notarized.failing.refuse = true;
      const refused = yield* run(publishRelease(gh.cli, notarized.notary, place));
      notarized.failing.refuse = false;
      cutInto(place.cut, cut, '0.2.0', false);
      const imageless = yield* run(publishRelease(gh.cli, notarized.notary, place));
      const untouched = gh.releases.size;
      cutInto(place.cut, cut, '0.2.0');
      yield* run(publishRelease(gh.cli, notarized.notary, place));
      cutInto(place.cut, cut, '0.1.9');
      const older = yield* run(publishRelease(gh.cli, notarized.notary, place));

      expect(
        [unpushed, unwritable, refused, imageless, older].map((outcome) =>
          outcome._tag === 'Failure' ? outcome.failure.step : 'published',
        ),
      ).toEqual(['commit', 'access', 'notarization', 'release', 'version']);
      expect(notarized.sealed).toEqual(['0.2.0', '0.2.0']);
      expect(untouched).toBe(0);
      expect([...gh.releases.keys()]).toEqual(['v0.2.0']);
    }),
);
