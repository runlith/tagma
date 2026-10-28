import { Data, Effect, Layer } from 'effect';
import { Git, GitNotAdmitted, gitVerb, type GitOptions, type GitAnswer } from '@runlith/git/Git';
import { type GitAnswerInvalid, type GitRefused, type GitUnreadable, troubleOf } from '@runlith/git/repository';
import { OWN_GIT_VARIABLE } from '../contract/service/credentials.js';
import { GateRefusal } from '../contract/wire/refusal.js';
import type { Person } from '../contract/wire/commits.js';

export type OwnGitReason = 'unstarted' | 'not-admitted' | 'refused' | 'locked' | 'not-a-repository' | 'hook-unsupported';

const reasonOf = (ran: boolean, message: string): OwnGitReason => {
  if (!ran) return 'unstarted';
  if (/Unable to create '[^']*\.lock': File exists/.test(message)) return 'locked';
  if (/^fatal: (not a git repository|cannot change to )/m.test(message)) return 'not-a-repository';
  if (message.includes("'hook' is not a git command")) return 'hook-unsupported';
  return 'refused';
};

export class OwnGitFailed extends Data.TaggedError('OwnGitFailed')<{
  readonly op: string;
  readonly message: string;
  readonly ran: boolean;
  readonly reason: OwnGitReason;
  readonly admission?: GitNotAdmitted;
}> {
  constructor(said: { readonly op: string; readonly message: string; readonly ran: boolean; readonly admission?: GitNotAdmitted }) {
    super({ ...said, reason: said.admission === undefined ? reasonOf(said.ran, said.message) : 'not-admitted' });
  }
}

export const admissionSaid = (admission: GitNotAdmitted): string => `git was not admitted to run (${admission.code}): ${admission.reason}`;

export const notAdmitted = (admission: GitNotAdmitted): GateRefusal<'git-not-admitted'> =>
  new GateRefusal('git-not-admitted', admissionSaid(admission), admission.unblock);

export const readingFailed = (op: string, failure: GitUnreadable | GitRefused | GitAnswerInvalid): OwnGitFailed =>
  failure._tag === 'GitUnreadable' && failure.admission !== undefined
    ? new OwnGitFailed({ op, message: failure.reason, ran: false, admission: failure.admission })
    : new OwnGitFailed({ op, message: troubleOf(failure), ran: true });

type Unstarted = Effect.Error<ReturnType<Git['Service']['run']>>;

const unstarted = (op: string, failure: Unstarted): OwnGitFailed =>
  new OwnGitFailed({ op, message: failure.message, ran: false, admission: failure instanceof GitNotAdmitted ? failure : undefined });

export const identityOf = (person: Person) => ({
  GIT_AUTHOR_NAME: person.name,
  GIT_AUTHOR_EMAIL: person.email,
  GIT_COMMITTER_NAME: person.name,
  GIT_COMMITTER_EMAIL: person.email,
});

export const gitIdentity = (author: string) => identityOf({ name: author, email: `${author}@tagma` });

export const ownGitOptions = (options: GitOptions | undefined): GitOptions => {
  const env = { ...options?.env, [OWN_GIT_VARIABLE]: '1', GIT_OPTIONAL_LOCKS: '0' };
  if (options?.env === undefined) return { ...options, env, extendEnv: true };
  return { ...options, env };
};

export const ownGit = (git: Git['Service']): Git['Service'] => ({
  run: (args, options) => git.run(args, ownGitOptions(options)),
  objects: git.objects === undefined ? undefined : (dir, oids, options) => git.objects!(dir, oids, ownGitOptions(options)),
});

export const ownGitLayer = <E, R>(platform: Layer.Layer<Git, E, R>): Layer.Layer<Git, E, R> =>
  Layer.effect(Git, Effect.map(Git, ownGit)).pipe(Layer.provide(platform));

const SCRUBBED = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_NAMESPACE',
  'GIT_COMMON_DIR',
] as const;

function configuredEnvironment(extra?: Record<string, string | undefined>): Record<string, string | undefined> {
  const inherited: Record<string, string | undefined> = { ...process.env };
  for (const name of SCRUBBED) delete inherited[name];
  const characters = inherited.LC_ALL ?? inherited.LC_CTYPE;
  delete inherited.LC_ALL;
  return {
    ...inherited,
    LC_CTYPE: characters,
    LC_MESSAGES: 'C',
    LANGUAGE: 'C',
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'core.longpaths',
    GIT_CONFIG_VALUE_0: 'true',
    GIT_CONFIG_KEY_1: 'core.quotePath',
    GIT_CONFIG_VALUE_1: 'false',
    ...extra,
  };
}

export function gitEnvironment(extra?: Record<string, string | undefined>): Record<string, string | undefined> {
  return configuredEnvironment({
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_COUNT: '3',
    GIT_CONFIG_KEY_2: 'core.autocrlf',
    GIT_CONFIG_VALUE_2: 'false',
    ...extra,
  });
}

function cleaningEnvironment(extra?: Record<string, string | undefined>): Record<string, string | undefined> {
  return configuredEnvironment({
    GIT_CONFIG_COUNT: '5',
    GIT_CONFIG_KEY_2: 'core.safecrlf',
    GIT_CONFIG_VALUE_2: 'false',
    GIT_CONFIG_KEY_3: 'core.fsmonitor',
    GIT_CONFIG_VALUE_3: 'false',
    GIT_CONFIG_KEY_4: 'core.splitIndex',
    GIT_CONFIG_VALUE_4: 'false',
    ...extra,
  });
}

export type RunGitOptions = Omit<GitOptions, 'env'> & {
  readonly env?: Record<string, string>;
  readonly cleans?: boolean;
  readonly configured?: boolean;
};

const environmentOf = (options: RunGitOptions | undefined) =>
  options?.cleans === true ? cleaningEnvironment : options?.configured === true ? configuredEnvironment : gitEnvironment;

const noteGit = (op: string, args: readonly string[]): Effect.Effect<void> =>
  Effect.annotateCurrentSpan({ 'git.op': op, 'git.verb': gitVerb(args), 'git.args': args.length });

export const gitAnswer = Effect.fn('ShadowGit.answer')(function* (
  git: Git['Service'],
  op: string,
  args: readonly string[],
  options?: RunGitOptions,
): Effect.fn.Return<GitAnswer, OwnGitFailed> {
  yield* noteGit(op, args);
  return yield* git
    .run(args, {
      cwd: options?.cwd,
      env: environmentOf(options)(options?.env),
      stdin: options?.stdin,
    })
    .pipe(Effect.mapError((error) => unstarted(op, error)));
});

export const runGit = Effect.fn('ShadowGit.run')(function* (
  git: Git['Service'],
  op: string,
  args: readonly string[],
  options?: RunGitOptions,
): Effect.fn.Return<string, OwnGitFailed> {
  yield* noteGit(op, args);
  const answer = yield* gitAnswer(git, op, args, options);
  const stdout = answer.stdout.replace(/\r?\n$/, '');
  if (answer.status !== 0) {
    return yield* new OwnGitFailed({ op, message: answer.stderr.trim() || stdout, ran: true });
  }
  return stdout;
});

export const quietGit = Effect.fn('ShadowGit.quiet')(function* (
  git: Git['Service'],
  op: string,
  args: readonly string[],
  options?: RunGitOptions,
): Effect.fn.Return<string | null, OwnGitFailed> {
  const answer = yield* gitAnswer(git, op, args, options);
  const stdout = answer.stdout.replace(/\r?\n$/, '');
  if (answer.status === 0) return stdout;
  if (answer.status === 1) return null;
  return yield* new OwnGitFailed({ op, message: answer.stderr.trim() || stdout, ran: true });
});

export const runGitBytes = Effect.fn('ShadowGit.bytes')(function* (
  git: Git['Service'],
  op: string,
  args: readonly string[],
  options?: RunGitOptions,
): Effect.fn.Return<string, OwnGitFailed> {
  yield* noteGit(op, args);
  const answer = yield* gitAnswer(git, op, args, options);
  if (answer.status !== 0) {
    return yield* new OwnGitFailed({ op, message: answer.stderr.trim() || answer.stdout, ran: true });
  }
  return answer.stdout;
});

export const actingGit = (git: Git['Service'], op: string): Git['Service'] => ({
  run: (args, options) =>
    Effect.flatMap(noteGit(op, args), () => git.run(args, { ...options, env: gitEnvironment(options?.env), extendEnv: false })),
  objects:
    git.objects === undefined
      ? undefined
      : (dir, oids, options) =>
          Effect.flatMap(noteGit(op, ['cat-file', '--batch']), () =>
            git.objects!(dir, oids, { ...options, env: gitEnvironment(options?.env), extendEnv: false }),
          ),
});

export const configuredGit = (git: Git['Service'], op: string): Git['Service'] => ({
  run: (args, options) =>
    Effect.flatMap(noteGit(op, args), () => git.run(args, { ...options, env: configuredEnvironment(options?.env), extendEnv: false })),
  objects:
    git.objects === undefined
      ? undefined
      : (dir, oids, options) =>
          Effect.flatMap(noteGit(op, ['cat-file', '--batch']), () =>
            git.objects!(dir, oids, { ...options, env: configuredEnvironment(options?.env), extendEnv: false }),
          ),
});
