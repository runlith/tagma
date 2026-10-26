import { Cause, Effect } from 'effect';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { Actor } from '../platform/contract/wire/actor.js';
import type { CheckSubjectKind } from '../platform/contract/wire/operation.js';
import { CallPlace } from '../platform/contract/service/place.js';
import type { PlaceUnread } from '../workspace/contract/service/checkoutPaths.js';
import type { ToolShown } from '@runlith/agent/tool';
import type { RuleChecks } from './contract/service/ruleChecks.js';
import { type HeadSubject, passed } from './contract/wire/checks.js';
import { executionActorOf } from '../executions/terminals/principals.js';
import { TerminalRefused } from '../executions/contract/wire/refusals.js';
import { ThreadId } from '../platform/contract/wire/thread.js';

const within = (root: string, absolute: string): string | null => {
  const path = relative(root, absolute);
  if (path === '' || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) return null;
  return path.split(sep).join('/');
};

type EditedFile = { readonly projectId: number; readonly root: string; readonly path: string };

export type EditLocation = (at: string) => Effect.Effect<EditedFile | null, PlaceUnread>;

type Editing = {
  readonly workingRoot: string;
  readonly projectId: number;
  readonly thread: { readonly id: string };
};

const editedFile = (ctx: Editing, spelled: string, locate: EditLocation): Effect.Effect<EditedFile | null, PlaceUnread> => {
  const absolute = resolve(ctx.workingRoot, spelled);
  return Effect.map(locate(absolute), (place) => {
    if (place !== null) return place.path === '' ? null : place;
    const home = within(ctx.workingRoot, absolute);
    return home === null ? null : { projectId: ctx.projectId, root: ctx.workingRoot, path: home };
  });
};

export const afterEditCheck = (
  checks: RuleChecks['Service'],
  worldChecks: Readonly<Record<string, CheckSubjectKind>>,
  ctx: Editing,
  tool: { readonly name: string; readonly shown?: readonly ToolShown[] },
  locate: EditLocation,
): Effect.Effect<void> => {
  if (worldChecks[tool.name] !== 'file') return Effect.void;
  return Effect.forEach(
    tool.shown?.filter((shown) => shown.as === 'wrote') ?? [],
    ({ path }) =>
      editedFile(ctx, path, locate).pipe(
        Effect.flatMap((file) =>
          file === null
            ? Effect.void
            : checks.after(tool.name, {
                kind: 'file',
                projectId: file.projectId,
                root: file.root,
                paths: [file.path],
                caller: { _tag: 'Thread', threadId: ThreadId.make(ctx.thread.id), projectId: ctx.projectId },
              }),
        ),
        Effect.catchCause((cause) =>
          Effect.logWarning('the after-edit rule check failed', { threadId: ctx.thread.id, path, reason: Cause.pretty(cause) }),
        ),
      ),
    { discard: true },
  );
};

export const checkedOperation = Effect.fnUntraced(function* <A, E, R>(
  checks: RuleChecks['Service'],
  id: string,
  actor: Exclude<Actor, { readonly kind: 'operator' | 'external' }>,
  work: Effect.Effect<A, E, R>,
) {
  const place = yield* CallPlace;
  const home = actor.projectId ?? place?.projectId;
  if (home === undefined) return yield* work;
  const projected = executionActorOf(actor, home);
  const elsewhere = place !== null && place.projectId !== home;
  const subject: HeadSubject = {
    kind: 'head',
    projectId: elsewhere ? place.projectId : home,
    root: elsewhere && place.checkout !== null ? place.checkout : undefined,
    branch: elsewhere && place.checkout !== null ? place.branch : undefined,
    caller: projected instanceof TerminalRefused ? undefined : projected,
  };
  yield* passed(yield* checks.before(id, subject));
  const value = yield* work;
  yield* checks.after(id, subject);
  return value;
});
