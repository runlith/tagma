import { isAbsolute, relative, resolve, sep } from 'node:path';
import { Data, Effect } from 'effect';
import { type Git, GitNotAdmitted } from './Git.js';

export class GitUnreadable extends Data.TaggedError('GitUnreadable')<{
  readonly command: readonly string[];
  readonly reason: string;
  readonly admission?: GitNotAdmitted;
}> {}

export const unreadableBy = (command: readonly string[], failure: Effect.Error<ReturnType<Git['Service']['run']>>): GitUnreadable =>
  failure instanceof GitNotAdmitted
    ? new GitUnreadable({ command, reason: `git was not admitted to run: ${failure.code}: ${failure.reason}`, admission: failure })
    : new GitUnreadable({ command, reason: failure.message });

export class GitRefused extends Data.TaggedError('GitRefused')<{
  readonly command: readonly string[];
  readonly status: number;
  readonly message: string;
  readonly truncated: boolean;
}> {}

export class GitAnswerInvalid extends Data.TaggedError('GitAnswerInvalid')<{
  readonly command: readonly string[];
  readonly capture: number;
}> {}

export const troubleOf = (error: GitUnreadable | GitRefused | GitAnswerInvalid): string => {
  const command = error.command.join(' ');
  if (error._tag === 'GitRefused') {
    const said = error.message === '' ? `git exited ${error.status}` : error.message;
    return error.truncated ? `${said} (cut; ${command})` : `${said} (${command})`;
  }
  if (error._tag === 'GitAnswerInvalid') return `the answer passed a ${error.capture} character capture (${command})`;
  return `${error.reason} (${command})`;
};

export type Head = {
  readonly ref: string | null;
  readonly commit: string | null;
};

export type Locations = {
  readonly commonDir: string;
  readonly gitDir: string;
  readonly worktree: string | null;
  readonly prefix: string;
  readonly bare: boolean;
};

export type Repository = Locations & { readonly head: Head };

export const commandFor = (dir: string, args: readonly string[]): readonly string[] => ['-C', dir, '-c', 'core.quotePath=false', ...args];

export const insideRepository = (dir: string, path: string): boolean => {
  const at = relative(resolve(dir), resolve(dir, path));
  return at !== '' && at !== '..' && !at.startsWith(`..${sep}`) && !isAbsolute(at);
};

export const literal = (path: string): string => `:(literal)${path}`;

export const OFFLINE_PROMPTS: Readonly<Record<string, string>> = { GIT_TERMINAL_PROMPT: '0' };

export type Ended = { readonly status: number; readonly stdout: string; readonly stdoutBytes?: Uint8Array };

export type Given = {
  readonly stdin?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly stdoutBytes?: boolean;
  readonly prefix?: boolean;
};

export const runEnded = Effect.fn('Git.runEnded')(function* (
  git: Git['Service'],
  dir: string,
  args: readonly string[],
  capture: number | undefined,
  answers: readonly number[],
  given: Given = {},
): Effect.fn.Return<Ended, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const command = commandFor(dir, args);
  const answer = yield* git
    .run(command, {
      capture,
      stdin: given.stdin,
      env: given.env === undefined ? undefined : { ...given.env },
      extendEnv: given.env === undefined ? undefined : true,
      stdoutBytes: given.stdoutBytes,
    })
    .pipe(Effect.mapError((failure) => unreadableBy(command, failure)));
  if (answer.status !== 0 && !answers.includes(answer.status)) {
    return yield* new GitRefused({
      command,
      status: answer.status,
      message: answer.stderr.trim(),
      truncated: answer.messageOverflow,
    });
  }
  if (answer.overflow && given.prefix !== true) {
    if (capture !== undefined) return yield* new GitAnswerInvalid({ command, capture });
    return yield* new GitUnreadable({ command, reason: 'the git road returned incomplete stdout' });
  }
  return {
    status: answer.status,
    stdout: answer.stdout,
    stdoutBytes: answer.stdoutBytes,
  };
});

export const run = (
  git: Git['Service'],
  dir: string,
  args: readonly string[],
  capture: number | undefined,
  stdin?: string,
  env?: Readonly<Record<string, string>>,
): Effect.Effect<string, GitUnreadable | GitRefused | GitAnswerInvalid> =>
  Effect.map(runEnded(git, dir, args, capture, [], { stdin, env }), (ended) => ended.stdout);

export const runBytes = Effect.fn('Git.runBytes')(function* (
  git: Git['Service'],
  dir: string,
  args: readonly string[],
  capture: number | undefined,
  stdin: string,
): Effect.fn.Return<Uint8Array, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const ended = yield* runEnded(git, dir, args, capture, [], { stdin, stdoutBytes: true });
  if (ended.stdoutBytes === undefined) {
    return yield* new GitUnreadable({ command: commandFor(dir, args), reason: 'the git road answered text where bytes were asked' });
  }
  return ended.stdoutBytes;
});

export const printedCommit = (id: string): string | null => (id === '' || /^0+$/.test(id) ? null : id);

export const saidNo = (failure: GitRefused): Effect.Effect<string, GitRefused> =>
  failure.status === 1 ? Effect.succeed('') : Effect.fail(failure);

const PUSH_KEYS = '^(remote\\.(pushdefault|.+\\.(url|pushurl))|branch\\..+\\.pushremote)$';

const REMOTE_ADDRESS = /^remote\.(.+)\.(?:url|pushurl)$/;

const FALLBACK_REMOTE = 'origin';

export const publishRemoteAt = Effect.fn('Git.publishRemote')(function* (
  git: Git['Service'],
  dir: string,
  branch: string,
  options: { readonly capture?: number } = {},
): Effect.fn.Return<string | null, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const listing = yield* run(git, dir, ['config', '-z', '--get-regexp', PUSH_KEYS], options.capture).pipe(
    Effect.catchTag('GitRefused', saidNo),
  );
  const branchKey = `branch.${branch}.pushremote`;
  let pushRemote: string | null = null;
  let pushDefault: string | null = null;
  const remotes = new Set<string>();
  for (const record of listing.split('\0')) {
    if (record === '') continue;
    const cut = record.indexOf('\n');
    const key = cut === -1 ? record : record.slice(0, cut);
    const value = cut === -1 ? '' : record.slice(cut + 1);
    if (key === branchKey) pushRemote = value === '' ? null : value;
    else if (key === 'remote.pushdefault') pushDefault = value === '' ? null : value;
    else {
      const remote = REMOTE_ADDRESS.exec(key)?.[1];
      if (remote !== undefined) remotes.add(remote);
    }
  }
  const configured = pushRemote ?? pushDefault;
  if (configured !== null) return remotes.has(configured) ? configured : null;
  const [only, ...more] = remotes;
  if (only !== undefined && more.length === 0) return only;
  return remotes.has(FALLBACK_REMOTE) ? FALLBACK_REMOTE : null;
});

export const publishedAt = Effect.fn('Git.published')(function* (
  git: Git['Service'],
  dir: string,
  branch: string,
  options: { readonly capture?: number } = {},
): Effect.fn.Return<boolean, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const tracked = yield* run(git, dir, ['config', '--get', `branch.${branch}.remote`], options.capture).pipe(
    Effect.catchTag('GitRefused', saidNo),
  );
  if (tracked.trim() !== '') return true;
  const remote = yield* run(git, dir, ['for-each-ref', '--count=1', '--format=%(refname)', `refs/remotes/*/${branch}`], options.capture);
  return remote.trim() !== '';
});

export type Upstream = { readonly remote: string; readonly branch: string };

export const upstreamAt = Effect.fn('Git.upstream')(function* (
  git: Git['Service'],
  dir: string,
  branch: string,
  options: { readonly capture?: number } = {},
): Effect.fn.Return<Upstream | null, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const listing = yield* run(
    git,
    dir,
    ['config', '-z', '--get-regexp', `^branch\\.${branch.replace(/[.^$*+?()[\]{}|\\]/g, '\\$&')}\\.(remote|merge)$`],
    options.capture,
  ).pipe(Effect.catchTag('GitRefused', saidNo));
  let remote: string | null = null;
  let merge: string | null = null;
  for (const record of listing.split('\0')) {
    const cut = record.indexOf('\n');
    if (cut === -1) continue;
    const key = record.slice(0, cut);
    const value = record.slice(cut + 1);
    if (key.endsWith('.remote')) remote = value;
    else if (key.endsWith('.merge')) merge = value;
  }
  if (remote === null || remote === '' || remote === '.' || merge === null || !merge.startsWith('refs/heads/')) return null;
  return { remote, branch: merge.slice('refs/heads/'.length) };
});

export const branchConfigAt = Effect.fn('Git.branchConfig')(function* (
  git: Git['Service'],
  dir: string,
  branch: string,
  key: string,
  options: { readonly capture?: number } = {},
): Effect.fn.Return<string | null, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const value = yield* run(git, dir, ['config', '--get', `branch.${branch}.${key}`], options.capture).pipe(
    Effect.catchTag('GitRefused', saidNo),
  );
  return value.trim() === '' ? null : value.trim();
});

export const setBranchConfigAt = Effect.fn('Git.setBranchConfig')(function* (
  git: Git['Service'],
  dir: string,
  branch: string,
  key: string,
  value: string | null,
  options: { readonly capture?: number } = {},
): Effect.fn.Return<void, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const name = `branch.${branch}.${key}`;
  if (value !== null) {
    yield* run(git, dir, ['config', name, value], options.capture);
    return;
  }
  yield* runEnded(git, dir, ['config', '--unset', name], options.capture, [5]);
});

export type ConfigValue = { readonly value: string; readonly scope: string };

export const configValueAt = Effect.fn('Git.configValue')(function* (
  git: Git['Service'],
  dir: string,
  name: string,
  options: { readonly local?: boolean; readonly capture?: number } = {},
): Effect.fn.Return<ConfigValue | null, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const args = ['config', ...(options.local === true ? ['--local'] : []), '--show-scope', '--type=bool-or-str', '--get', name];
  const ended = yield* runEnded(git, dir, args, options.capture, [1]);
  if (ended.status === 1) return null;
  const line = ended.stdout.replace(/\n$/, '');
  const cut = line.indexOf('\t');
  return cut === -1 ? { value: line, scope: 'unknown' } : { value: line.slice(cut + 1), scope: line.slice(0, cut) };
});

export const setLocalConfigAt = Effect.fn('Git.setLocalConfig')(function* (
  git: Git['Service'],
  dir: string,
  name: string,
  value: string | null,
  options: { readonly capture?: number } = {},
): Effect.fn.Return<void, GitUnreadable | GitRefused | GitAnswerInvalid> {
  if (value !== null) {
    yield* run(git, dir, ['config', '--local', name, value], options.capture);
    return;
  }
  yield* runEnded(git, dir, ['config', '--local', '--unset', name], options.capture, [5]);
});

export const buildFeaturesAt = Effect.fn('Git.buildFeatures')(function* (
  git: Git['Service'],
  dir: string,
  options: { readonly capture?: number } = {},
): Effect.fn.Return<ReadonlySet<string>, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const listing = yield* run(git, dir, ['version', '--build-options'], options.capture);
  return new Set(listing.split('\n').flatMap((line) => (line.startsWith('feature: ') ? [line.slice('feature: '.length).trim()] : [])));
});

export const fsmonitorWatchingAt = Effect.fn('Git.fsmonitorWatching')(function* (
  git: Git['Service'],
  dir: string,
  options: { readonly capture?: number } = {},
): Effect.fn.Return<boolean, GitUnreadable | GitRefused | GitAnswerInvalid> {
  return (yield* runEnded(git, dir, ['fsmonitor--daemon', 'status'], options.capture, [1])).status === 0;
});

export const stopFsmonitorAt = Effect.fn('Git.stopFsmonitor')(function* (
  git: Git['Service'],
  dir: string,
  options: { readonly capture?: number } = {},
): Effect.fn.Return<void, GitUnreadable | GitRefused | GitAnswerInvalid> {
  yield* run(git, dir, ['fsmonitor--daemon', 'stop'], options.capture);
});

export const remoteUrlAt = Effect.fn('Git.remoteUrl')(function* (
  git: Git['Service'],
  dir: string,
  remote: string,
  options: { readonly capture?: number } = {},
): Effect.fn.Return<string | null, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const url = yield* run(git, dir, ['config', '--get', `remote.${remote}.url`], options.capture).pipe(
    Effect.catchTag('GitRefused', saidNo),
  );
  return url.trim() === '' ? null : url.trim();
});

const PUSHED = 'update by push';

export const pushedFromHereAt = Effect.fn('Git.pushedFromHere')(function* (
  git: Git['Service'],
  dir: string,
  remote: string,
  branch: string,
  options: { readonly capture?: number } = {},
): Effect.fn.Return<boolean, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const ref = `refs/remotes/${remote}/${branch}`;
  if ((yield* commitOf(git, dir, ref, options)) === null) return false;
  const entries = yield* run(git, dir, ['reflog', 'show', '--format=%gs', '--end-of-options', ref, '--'], options.capture);
  const lines = entries.split('\n').filter((line) => line !== '');
  return lines.at(-1) === PUSHED;
});

export const branchNameAt = Effect.fn('Git.branchName')(function* (
  git: Git['Service'],
  dir: string,
  name: string,
  options: { readonly capture?: number } = {},
): Effect.fn.Return<string, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const command = commandFor(dir, ['check-ref-format', '--branch', name]);
  if (name.startsWith('-') || name.startsWith('@')) {
    return yield* new GitRefused({ command, status: 128, message: `fatal: '${name}' is not a valid branch name`, truncated: false });
  }
  const answer = yield* run(git, dir, ['check-ref-format', '--branch', name], options.capture);
  return answer.trim();
});

export const headAt = Effect.fn('Git.head')(function* (
  git: Git['Service'],
  dir: string,
  options: { readonly capture?: number } = {},
): Effect.fn.Return<Head, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const together = yield* run(git, dir, ['rev-parse', 'HEAD', '--symbolic-full-name', 'HEAD'], options.capture).pipe(
    Effect.map((answer) => framedLines(answer, 2)),
    Effect.catchTag('GitRefused', () => Effect.succeed(null)),
  );
  const [bornAt = '', named = ''] = together ?? [];
  const born = bornHead(bornAt, named);
  if (born !== null) return born;
  const ref = yield* run(git, dir, ['symbolic-ref', '--quiet', 'HEAD'], options.capture).pipe(Effect.catchTag('GitRefused', saidNo));
  const commit = yield* run(git, dir, ['rev-parse', '--verify', '--quiet', 'HEAD'], options.capture).pipe(
    Effect.catchTag('GitRefused', saidNo),
  );
  return { ref: ref.trim() === '' ? null : ref.trim(), commit: printedCommit(commit.trim()) };
});

export const commitArgs = (revision: string): readonly string[] => [
  'rev-parse',
  '--verify',
  '--quiet',
  '--end-of-options',
  `${revision}^{commit}`,
];

export const commitOf = Effect.fn('Git.commitOf')(function* (
  git: Git['Service'],
  dir: string,
  revision: string,
  options: { readonly capture?: number } = {},
): Effect.fn.Return<string | null, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const isQuiet = (failure: GitRefused): boolean => failure.status === 1 && failure.message === '' && !failure.truncated;
  const answer = yield* run(git, dir, commitArgs(revision), options.capture).pipe(
    Effect.catchTag('GitRefused', (failure) =>
      Effect.gen(function* () {
        if (!isQuiet(failure)) return yield* Effect.fail(failure);
        const resolved = yield* run(git, dir, ['rev-parse', '--verify', '--quiet', '--end-of-options', revision], options.capture).pipe(
          Effect.catchTag('GitRefused', (refusal) => (isQuiet(refusal) ? Effect.succeed('') : Effect.fail(refusal))),
        );
        if (printedCommit(resolved.trim()) !== null) return yield* Effect.fail(failure);
        return '';
      }),
    ),
  );
  return printedCommit(answer.trim());
});

const closed = (answer: string): string | null => (answer.endsWith('\n') ? answer.slice(0, -1) : null);

const BARE = 'true\n';
const GROWN = 'false\n';

export const pathArgs = (asked: readonly string[]): readonly string[] => ['rev-parse', '--path-format=absolute', ...asked];

export const pathAt = Effect.fn('Git.path')(function* (
  git: Git['Service'],
  dir: string,
  asked: readonly string[],
  capture: number | undefined,
): Effect.fn.Return<string, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const args = pathArgs(asked);
  const value = closed(yield* run(git, dir, args, capture));
  if (value === null || value === '') {
    return yield* new GitUnreadable({ command: commandFor(dir, args), reason: `rev-parse printed no ${asked.join(' ')}` });
  }
  return value;
});

export const pathsAt = Effect.fn('Git.paths')(function* (
  git: Git['Service'],
  dir: string,
  asked: readonly string[],
  capture: number | undefined,
): Effect.fn.Return<readonly string[], GitUnreadable | GitRefused | GitAnswerInvalid> {
  const separately = Effect.forEach(asked, (one) => pathAt(git, dir, [one], capture));
  return yield* Effect.matchEffect(run(git, dir, pathArgs(asked), capture), {
    onFailure: () => separately,
    onSuccess: (answer) => {
      const lines = framedLines(answer, asked.length);
      return lines !== null && lines.every((line) => line !== '') ? Effect.succeed(lines) : separately;
    },
  });
});

const framedLines = (answer: string, count: number): readonly string[] | null => {
  if (!answer.endsWith('\n')) return null;
  const lines = answer.slice(0, -1).split('\n');
  return lines.length === count ? lines : null;
};

const bornHead = (bornAt: string, named: string): Head | null =>
  /^[0-9a-f]+$/.test(bornAt) && printedCommit(bornAt) !== null && (named === 'HEAD' || named.startsWith('refs/heads/'))
    ? { ref: named === 'HEAD' ? null : named, commit: bornAt }
    : null;

const bareOf = (line: string | undefined): boolean | null => (line === 'true' ? true : line === 'false' ? false : null);

export type Store = {
  readonly commonDir: string;
  readonly bare: boolean;
};

export const storeAt = Effect.fn('Git.store')(function* (
  git: Git['Service'],
  dir: string,
  options: { readonly capture?: number } = {},
): Effect.fn.Return<Store, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const capture = options.capture;
  const together = framedLines(
    yield* run(git, dir, ['rev-parse', '--is-bare-repository', '--path-format=absolute', '--git-common-dir'], capture),
    2,
  );
  const togetherBare = bareOf(together?.[0]);
  if (together !== null && togetherBare !== null && together[1] !== '') {
    return { commonDir: together[1] as string, bare: togetherBare };
  }
  const standing = ['rev-parse', '--is-bare-repository'];
  const answer = yield* run(git, dir, standing, capture);
  const bare = answer === BARE ? true : answer === GROWN ? false : null;
  if (bare === null) {
    return yield* new GitUnreadable({
      command: commandFor(dir, standing),
      reason: 'rev-parse framed no bareness',
    });
  }
  return { commonDir: yield* pathAt(git, dir, ['--git-common-dir'], capture), bare };
});

export type StoreHead = { readonly store: Store; readonly head: Head | null };

export const storeHeadAt = Effect.fn('Git.storeHead')(function* (
  git: Git['Service'],
  dir: string,
  options: { readonly capture?: number } = {},
): Effect.fn.Return<StoreHead, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const args = ['rev-parse', '--is-bare-repository', '--path-format=absolute', '--git-common-dir', 'HEAD', '--symbolic-full-name', 'HEAD'];
  const separately = Effect.map(storeAt(git, dir, options), (store): StoreHead => ({ store, head: null }));
  return yield* Effect.matchEffect(run(git, dir, args, options.capture), {
    onFailure: () => separately,
    onSuccess: (answer): Effect.Effect<StoreHead, GitUnreadable | GitRefused | GitAnswerInvalid> => {
      const lines = framedLines(answer, 4);
      const bare = bareOf(lines?.[0]);
      if (lines === null || bare === null || lines[1] === '') return separately;
      const [, commonDir = '', bornAt = '', named = ''] = lines;
      return Effect.succeed({ store: { commonDir, bare }, head: bornHead(bornAt, named) });
    },
  });
});

export const locationsAt = Effect.fn('Git.locations')(function* (
  git: Git['Service'],
  dir: string,
  options: { readonly capture?: number } = {},
): Effect.fn.Return<Locations, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const capture = options.capture;
  const together = yield* run(
    git,
    dir,
    ['rev-parse', '--is-bare-repository', '--show-prefix', '--path-format=absolute', '--git-common-dir', '--git-dir', '--show-toplevel'],
    capture,
  ).pipe(
    Effect.map((answer) => framedLines(answer, 5)),
    Effect.catchTag('GitRefused', () => Effect.succeed(null)),
  );
  if (together !== null && bareOf(together[0]) === false && together.slice(2).every((path) => path !== '')) {
    const [, prefix = '', commonDir = '', gitDir = '', worktree = ''] = together;
    return { commonDir, gitDir, worktree, prefix: prefix.replace(/\/$/, ''), bare: false };
  }
  const standing = ['rev-parse', '--is-bare-repository', '--show-prefix'];
  const answer = yield* run(git, dir, standing, capture);
  const bare = answer.startsWith(BARE) ? true : answer.startsWith(GROWN) ? false : null;
  const prefix = bare === null ? null : closed(answer.slice(bare ? BARE.length : GROWN.length));
  if (bare === null || prefix === null) {
    return yield* new GitUnreadable({
      command: commandFor(dir, standing),
      reason: 'rev-parse framed no bareness and prefix',
    });
  }
  return {
    commonDir: yield* pathAt(git, dir, ['--git-common-dir'], capture),
    gitDir: yield* pathAt(git, dir, ['--git-dir'], capture),
    worktree: bare ? null : yield* pathAt(git, dir, ['--show-toplevel'], capture),
    prefix: prefix.replace(/\/$/, ''),
    bare,
  };
});

export type Layout = { readonly gitDir: string; readonly commonDir: string; readonly paths: readonly string[] };

export type Standing = { readonly layout: Layout; readonly head: Head };

const layoutArgs = (names: readonly string[]): readonly string[] => [
  '--absolute-git-dir',
  '--path-format=absolute',
  '--git-common-dir',
  ...names.flatMap((name) => ['--git-path', name]),
];

const layoutIn = (lines: readonly string[] | null, names: readonly string[]): Layout | null => {
  if (lines === null || lines.length !== names.length + 2 || lines.some((line) => line === '')) return null;
  const [gitDir = '', commonDir = '', ...paths] = lines;
  return { gitDir, commonDir, paths };
};

export const layoutAt = Effect.fn('Git.layout')(function* (
  git: Git['Service'],
  dir: string,
  names: readonly string[],
  options: { readonly capture?: number } = {},
): Effect.fn.Return<Layout, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const capture = options.capture;
  const together = layoutIn(framedLines(yield* run(git, dir, ['rev-parse', ...layoutArgs(names)], capture), names.length + 2), names);
  if (together !== null) return together;
  return {
    gitDir: yield* pathAt(git, dir, ['--absolute-git-dir'], capture),
    commonDir: yield* pathAt(git, dir, ['--git-common-dir'], capture),
    paths: yield* Effect.forEach(names, (name) => pathAt(git, dir, ['--git-path', name], capture)),
  };
});

export const standingAt = Effect.fn('Git.standing')(function* (
  git: Git['Service'],
  dir: string,
  names: readonly string[],
  options: { readonly capture?: number } = {},
): Effect.fn.Return<Standing, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const together = yield* run(git, dir, ['rev-parse', ...layoutArgs(names), 'HEAD', '--symbolic-full-name', 'HEAD'], options.capture).pipe(
    Effect.map((answer) => framedLines(answer, names.length + 4)),
    Effect.catchTag('GitRefused', () => Effect.succeed(null)),
  );
  const layout = together === null ? null : layoutIn(together.slice(0, -2), names);
  const [bornAt = '', named = ''] = together?.slice(-2) ?? [];
  const head = bornHead(bornAt, named);
  if (layout !== null && head !== null) return { layout, head };
  return { layout: yield* layoutAt(git, dir, names, options), head: yield* headAt(git, dir, options) };
});

export const repositoryAt = Effect.fn('Git.repository')(function* (
  git: Git['Service'],
  dir: string,
  options: { readonly capture?: number } = {},
): Effect.fn.Return<Repository, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const together = yield* run(
    git,
    dir,
    [
      'rev-parse',
      '--is-bare-repository',
      '--show-prefix',
      '--path-format=absolute',
      '--git-common-dir',
      '--git-dir',
      '--show-toplevel',
      'HEAD',
      '--symbolic-full-name',
      'HEAD',
    ],
    options.capture,
  ).pipe(
    Effect.map((answer) => framedLines(answer, 7)),
    Effect.catchTag('GitRefused', () => Effect.succeed(null)),
  );
  const [bare = '', prefix = '', commonDir = '', gitDir = '', worktree = '', bornAt = '', named = ''] = together ?? [];
  const head = bornHead(bornAt, named);
  if (together !== null && bareOf(bare) === false && commonDir !== '' && gitDir !== '' && worktree !== '' && head !== null) {
    return { commonDir, gitDir, worktree, prefix: prefix.replace(/\/$/, ''), bare: false, head };
  }
  return { ...(yield* locationsAt(git, dir, options)), head: yield* headAt(git, dir, options) };
});
