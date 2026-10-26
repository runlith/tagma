import type { Git } from '@runlith/git/Git';
import { Effect, type Semaphore } from 'effect';
import { OwnGitFailed, runGit } from '../platform/git/ownGit.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { ThreadId } from '../platform/contract/wire/thread.js';
import { pathChunks } from '../change-record/prepared/eligible.js';
import type { ShapeAct } from '../change-record/contract/service/shape.js';
import type { Reshaped, ReshapeMode } from '../change-record/contract/wire/reshape.js';
import type { ShapeRefusal } from '../change-record/contract/wire/shape.js';
import type { ProgramEnding, ProgramRoad } from '../executions/contract/service/programs.js';
import type { TerminalActor } from '../executions/contract/wire/terminals.js';
import type { TreePlace } from '../workspace/contract/service/commitTrees.js';
import type { FormatEntry } from '../config/contract/wire/config.js';
import { type SetupStanding, TreeSetupState } from './contract/service/setup.js';

export const PROCESSES = 3;

const TAIL = 1_500;

const LISTED = 5;

type Refusal = GateRefusal<ShapeRefusal>;

const nul = (paths: readonly string[]): string => paths.map((path) => `${path}\0`).join('');

export const actorOf = (act: ShapeAct): TerminalActor =>
  act.kind === 'operator'
    ? { _tag: 'Operator' }
    : act.kind === 'thread'
      ? { _tag: 'Thread', threadId: ThreadId.make(act.threadId), projectId: act.projectId }
      : { _tag: 'Foreign', harness: act.session.harness, key: act.session.key, projectId: act.projectId };

const named = (files: readonly string[]): string =>
  files.length <= LISTED ? files.join(', ') : `${files.slice(0, LISTED).join(', ')} and ${files.length - LISTED} more`;

const label = (step: FormatEntry): string => `format command ${step.key} (${step.command.run.join(' ')})`;

const tailOf = (stderr: string): string => {
  const text = stderr.trim();
  return text === '' ? 'it printed nothing on stderr' : text.length > TAIL ? `…${text.slice(-TAIL)}` : text;
};

const settling = (state: SetupStanding | null): string =>
  state === null
    ? ''
    : `; this checkout is a worktree whose setup is ${state}, so its dependencies may not be installed yet — wait for the setup instead of installing them yourself`;

const refusedBy = (step: FormatEntry, files: readonly string[], ending: ProgramEnding, state: SetupStanding | null): Refusal | null => {
  if (ending._tag === 'Unrun') {
    return ending.missing === undefined
      ? new GateRefusal('format-failed', `${label(step)} could not be started: ${ending.said}, so nothing was committed`, [
          'read what the host said and run the commit again',
        ])
      : new GateRefusal(
          'format-missing',
          `${label(step)} could not run: ${step.command.run[0]} was not found or is not executable (searched PATH=${ending.missing})${settling(state)}, so nothing was committed`,
          [`install the project dependencies the command runs, or correct format.${step.key}.run in tagma.config.ts, then commit again`],
        );
  }
  if (ending._tag === 'Stopped') {
    return ending.late
      ? new GateRefusal('format-cut', `${label(step)} ran past its ceiling and was cut over ${named(files)}, so nothing was committed`, [
          `make the command faster, or narrow format.${step.key}.files in tagma.config.ts`,
        ])
      : new GateRefusal('format-failed', `${label(step)} was stopped before it finished: ${ending.said}, so nothing was committed`, [
          'run the commit again',
        ]);
  }
  if (step.command.ok.includes(ending.exitCode)) return null;
  return new GateRefusal(
    'format-failed',
    `${label(step)} exited ${ending.exitCode}, outside its ok codes ${step.command.ok.join(', ')}, over ${named(files)}, so nothing was committed; its stderr: ${tailOf(ending.stderr)}`,
    [
      'fix the file the tool names',
      `where ${ending.exitCode} is how the tool says it ran, add it to format.${step.key}.ok in tagma.config.ts`,
      `exclude the file in the tool's own ignore file or in format.${step.key}.files`,
    ],
  );
};

export type Entry = { readonly sha: string; readonly mode: ReshapeMode };

const shasOf = Effect.fn('commitSteps.shasOf')(function* (git: Git['Service'], place: TreePlace, paths: readonly string[]) {
  const shas = new Map<string, Entry>();
  for (const cut of pathChunks(paths)) {
    const listed = yield* runGit(git, 'commit-steps-shas', ['-C', place.dir, 'ls-files', '-s', '-z', '--', ...cut], {
      env: { ...place.env, GIT_LITERAL_PATHSPECS: '1' },
    });
    for (const entry of listed.split('\0')) {
      const tab = entry.indexOf('\t');
      if (tab === -1) continue;
      const [mode = '', sha = ''] = entry.slice(0, tab).split(' ');
      shas.set(entry.slice(tab + 1), { sha, mode: mode === '100755' ? '100755' : '100644' });
    }
  }
  return shas;
});

const taken = Effect.fn('commitSteps.taken')(function* (
  git: Git['Service'],
  place: TreePlace,
  files: readonly string[],
  step: FormatEntry,
) {
  yield* runGit(git, 'commit-steps-take', ['-C', place.dir, 'update-index', '--add', '--remove', '-z', '--stdin'], {
    env: { ...place.env },
    cleans: true,
    stdin: nul(files),
  });
  const standing = yield* shasOf(git, place, files);
  const gone = files.filter((path) => !standing.has(path));
  if (gone.length > 0) {
    return yield* new GateRefusal(
      'format-failed',
      `${label(step)} deleted ${named(gone)}, and a format command only turns a file into itself, so nothing was committed`,
      ['correct the command so it rewrites files in place'],
    );
  }
  return standing;
});

export type Running = {
  readonly projectId: number;
  readonly git: Git['Service'];
  readonly road: ProgramRoad['Service'];
  readonly pool: Semaphore.Semaphore;
  readonly root: string;
  readonly place: TreePlace;
  readonly act: ShapeAct;
  readonly job: string;
};

export const runStep = Effect.fn('commitSteps.runStep')(function* (
  running: Running,
  at: number,
  step: FormatEntry,
  files: readonly string[],
) {
  const { projectId, git, road, pool, root, place, act, job } = running;
  if (files.length === 0) return yield* taken(git, place, files, step);
  const ending = yield* pool.withPermits(1)(
    road.run({
      projectId,
      actor: actorOf(act),
      argv: step.command.run,
      operands: files,
      cwd: place.dir,
      policyRoot: root,
      stdin: '',
      env: place.env,
      tool: 'commit-step',
      operation: `commit-step:${job}:${at}:${crypto.randomUUID()}`,
      subject: `format ${step.key}`,
    }),
  );
  const tree = ending._tag === 'Unrun' && ending.missing !== undefined ? yield* TreeSetupState : null;
  const state = tree !== null ? yield* tree.of(projectId, root) : null;
  const refused = refusedBy(step, files, ending, state);
  if (refused !== null) return yield* refused;
  return yield* taken(git, place, files, step);
});

export const reshapedBy = (before: ReadonlyMap<string, Entry>, after: ReadonlyMap<string, Entry>): readonly Reshaped[] =>
  [...before].flatMap(([path, was]) => {
    const now = after.get(path);
    if (now === undefined || (now.sha === was.sha && now.mode === was.mode)) return [];
    return [{ path, before: was.sha, after: now.sha, mode: now.mode === was.mode ? undefined : now.mode }];
  });

export const restored = Effect.fn('commitSteps.restored')(function* (git: Git['Service'], place: TreePlace, keep: ReadonlySet<string>) {
  const changed = (yield* runGit(git, 'commit-steps-strays', ['-C', place.dir, 'diff-files', '--name-only', '-z'], {
    env: { ...place.env },
    cleans: true,
  }))
    .split('\0')
    .filter((path) => path !== '' && !keep.has(path));
  if (changed.length === 0) return;
  yield* runGit(git, 'commit-steps-restore', ['-C', place.dir, 'checkout-index', '-f', '-z', '--stdin'], {
    env: { ...place.env },
    cleans: true,
    stdin: nul(changed),
  });
});
