import { Effect } from 'effect';
import { Git } from '@runlith/git/Git';
import { fileAt } from '@runlith/git/entries';
import { commandFor, GitUnreadable, run } from '@runlith/git/repository';
import { ProjectIdentification, Projects } from '../../projects/contract/service/registry.js';
import { MirrorBuilder, ProjectPolicy } from '../contract/service/serving.js';
import { GraphSteps } from '../contract/service/steps.js';
import { CHECKOUT_DIRECTORY, FORMAT_FILE } from '../contract/wire/storage.js';
import { markerOf } from '../tree/marker.js';

export const makeMergeFormat = Effect.gen(function* () {
  const git = yield* Git;
  const steps = yield* GraphSteps;
  const projects = yield* Projects;
  const identification = yield* ProjectIdentification;
  const policy = yield* ProjectPolicy;
  const builder = yield* MirrorBuilder;
  const path = `${CHECKOUT_DIRECTORY}/${FORMAT_FILE}`;
  const failed = (dir: string, reason: string) => new GitUnreadable({ command: commandFor(dir, ['merge-tree']), reason });
  const marker = Effect.fnUntraced(function* (dir: string, commit: string) {
    const text = yield* fileAt(git, dir, commit, path);
    if (text === null) return null;
    const read = markerOf(text);
    if (read.kind !== 'read') return yield* failed(dir, `${commit}:${path} does not read as a graph format marker`);
    return read.step;
  });
  const behind = Effect.fn('GraphFormat.behind')(function* (dir: string, base: string, tip: string) {
    const target = yield* marker(dir, base);
    const source = yield* marker(dir, tip);
    if (source === target) return false;
    if (
      source === null &&
      (yield* run(git, dir, ['ls-tree', '--name-only', '--end-of-options', tip, '--', CHECKOUT_DIRECTORY], undefined)) === ''
    )
      return false;
    const lower = steps.lower(source, target);
    if (lower === undefined)
      return yield* failed(
        dir,
        `the graph formats cannot be compared by this server: ${tip} is ${steps.standing(source)}, ${base} is ${steps.standing(target)}`,
      );
    return lower === source;
  });
  const prepare = Effect.fn('GraphFormat.prepare')(function* (dir: string, base: string, tip: string) {
    if (!(yield* behind(dir, base, tip))) return tip;
    return yield* Effect.gen(function* () {
      const project = yield* projects.resolve(undefined, { cwd: dir, identity: yield* identification.identify(dir) });
      if (project === undefined)
        return yield* failed(dir, `${dir} belongs to no registered project, so its graph cannot be brought forward`);
      const row = (yield* policy.read([project.id])).get(project.id);
      if (row === undefined) return yield* failed(dir, `project ${project.id} has no graph policy`);
      if (row.storage !== 'team') return tip;
      return yield* Effect.acquireUseRelease(
        builder.prepare({ row, checkout: dir, repository: dir, commit: tip, graphPath: CHECKOUT_DIRECTORY, targetCommit: base }),
        (prepared) => Effect.succeed(prepared.head),
        (prepared) => prepared.release,
      );
    }).pipe(Effect.mapError((failure) => failed(dir, failure.message)));
  });
  return { revision: steps.last, behind, prepare };
});
