import { Effect, type FileSystem } from 'effect';
import type { Git } from '@runlith/git/Git';
import { type OwnGitFailed, runGit } from '../../platform/git/ownGit.js';
import type { Reshaped, ReshapeHolder, ReshapeInput, ReshapeMode, ReshapeOwing } from '../../change-record/contract/wire/reshape.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { ChangeCheckout, ChangeRecord } from '../../change-record/contract/service/record.js';
import type { LineWrites } from '../../change-record/contract/service/lineWrites.js';
import type { RunFilesFailure } from '../../change-record/contract/service/runFiles.js';
import type { HookEdits, HookKept } from '../contract/wire/receipt.js';
import type { HookRefused, Posted } from './hooks.js';

const REGULAR = new Set(['100644', '100755']);

const ABSENT = '000000';

export type Delta = { readonly paths: readonly string[]; readonly reshaped: readonly Reshaped[]; readonly kept: readonly HookKept[] };

export const steppedDelta = (reshaped: readonly Reshaped[]): Delta => ({ paths: reshaped.map((one) => one.path), reshaped, kept: [] });

export const NO_EDITS: HookEdits = { edited: [], kept: [], unrecorded: [], owed: [] };

const blob = (mode: string, sha: string): string | null => (mode === ABSENT ? null : sha);

export const deltaOf = (git: Git['Service'], root: string, from: string, to: string): Effect.Effect<Delta, OwnGitFailed> =>
  from === to
    ? Effect.succeed({ paths: [], reshaped: [], kept: [] })
    : Effect.map(runGit(git, 'submit-hook-delta', ['-C', root, 'diff-tree', '-r', '-z', '--no-renames', from, to]), (listed) => {
        const fields = listed.split('\0');
        const paths: string[] = [];
        const reshaped: Reshaped[] = [];
        const kept: HookKept[] = [];
        for (let at = 0; at + 1 < fields.length; at += 2) {
          const [oldMode = '', newMode = '', before = '', after = ''] = (fields[at] ?? '').replace(/^:/, '').split(' ');
          const path = fields[at + 1] ?? '';
          if (path === '') continue;
          paths.push(path);
          if ((oldMode !== ABSENT && !REGULAR.has(oldMode)) || (newMode !== ABSENT && !REGULAR.has(newMode))) {
            kept.push({ path, why: 'link' });
            continue;
          }
          const mode = newMode !== ABSENT && newMode !== oldMode ? (newMode as ReshapeMode) : undefined;
          if (before !== after || mode !== undefined)
            reshaped.push({ path, before: blob(oldMode, before), after: blob(newMode, after), mode });
        }
        return { paths, reshaped, kept };
      });

export type Carried = { readonly kept: readonly HookKept[]; readonly inputs: readonly ReshapeInput[] };

export const NOTHING_READ: Carried = { kept: [], inputs: [] };

export const readDelta = (
  changes: ChangeRecord['Service'],
  checkout: ChangeCheckout,
  delta: Delta,
): Effect.Effect<Carried, RunFilesFailure, FileSystem.FileSystem> =>
  delta.reshaped.length === 0
    ? Effect.succeed({ kept: delta.kept, inputs: [] })
    : Effect.map(changes.reshapeRead(checkout, delta.reshaped), (inputs) => ({ kept: delta.kept, inputs }));

export const unreadIn = (carried: readonly Carried[]): GateRefusal<'reshape-unreadable'> | null => {
  const unread = carried.flatMap((one) =>
    one.inputs.flatMap((input) => (input.read.kind === 'unread' ? [`${input.path} (${input.read.cause})`] : [])),
  );
  return unread.length === 0
    ? null
    : new GateRefusal(
        'reshape-unreadable',
        `what the commit steps or the hooks changed could not be read against the working files, so nothing was committed: ${unread.join(', ')}`,
        [
          'commit again once those files and their blobs read',
          'land without the paths named (paths), or without the steps on the operator’s word',
        ],
      );
};

export const applyCarried = (
  changes: ChangeRecord['Service'],
  checkout: ChangeCheckout,
  carried: Carried,
  holder: ReshapeHolder,
  owing?: ReshapeOwing,
): Effect.Effect<HookEdits, RunFilesFailure, FileSystem.FileSystem | LineWrites> =>
  carried.inputs.length === 0
    ? Effect.succeed({ ...NO_EDITS, kept: carried.kept })
    : Effect.map(changes.reshape(checkout, carried.inputs, holder, owing), (outcomes) => ({
        edited: outcomes.flatMap((one) => (one._tag === 'kept' ? [] : [one.path])),
        kept: [...carried.kept, ...outcomes.flatMap((one) => (one._tag === 'kept' ? [{ path: one.path, why: one.why }] : []))],
        unrecorded: outcomes.flatMap((one) => (one._tag === 'unrecorded' ? [one.path] : [])),
        owed: outcomes.flatMap((one) => (one._tag === 'kept' && one.owed ? [one.path] : [])),
      }));

export const carryDelta = (
  changes: ChangeRecord['Service'],
  checkout: ChangeCheckout,
  delta: Delta,
  holder: ReshapeHolder,
  owing?: ReshapeOwing,
): Effect.Effect<HookEdits, RunFilesFailure, FileSystem.FileSystem | LineWrites> =>
  Effect.flatMap(readDelta(changes, checkout, delta), (carried) => applyCarried(changes, checkout, carried, holder, owing));

export const carryEdits = (
  changes: ChangeRecord['Service'],
  checkout: ChangeCheckout,
  from: string,
  to: string,
  holder: ReshapeHolder,
): Effect.Effect<HookEdits, OwnGitFailed | RunFilesFailure, FileSystem.FileSystem | LineWrites> =>
  Effect.flatMap(deltaOf(checkout.git, checkout.root, from, to), (delta) => carryDelta(changes, checkout, delta, holder));

export const carryPosted = (
  changes: ChangeRecord['Service'],
  checkout: ChangeCheckout,
  posted: Posted,
  commit: string,
): Effect.Effect<HookEdits, OwnGitFailed | RunFilesFailure, FileSystem.FileSystem | LineWrites> =>
  Effect.flatMap(deltaOf(checkout.git, checkout.root, posted.tree, posted.left), (delta) =>
    carryDelta(changes, checkout, delta, { _tag: 'unheld' }, { commit, source: 'post-commit' }),
  );

export const joined = (one: HookEdits, two: HookEdits): HookEdits => ({
  edited: [...new Set([...one.edited, ...two.edited])],
  kept: [...one.kept, ...two.kept],
  unrecorded: [...one.unrecorded, ...two.unrecorded],
  owed: [...new Set([...one.owed, ...two.owed])],
});

const keptSaid = (kept: readonly HookKept[]): string => kept.map((one) => `${one.path} (${one.why})`).join(', ');

const formedSaid = (steps: HookEdits): string =>
  [
    steps.edited.length === 0
      ? ''
      : `; the format commands of tagma.config.ts rewrote ${steps.edited.join(', ')}, and every line and count above reads that form, which now stands in the working files as uncommitted work`,
    steps.kept.length === 0
      ? ''
      : `; the form the format commands gave ${keptSaid(steps.kept)} was left out of the working files, so the lines above read a text those files do not hold`,
  ].join('');

const editsSaid = (edits: HookEdits): string =>
  [
    edits.edited.length === 0
      ? ''
      : `; the hook's edits now stand in the working files as uncommitted work, and the next commit carries them: ${edits.edited.join(', ')}`,
    edits.kept.length === 0 ? '' : `; the hook's edits of ${keptSaid(edits.kept)} were left out of the working files`,
  ].join('');

export type RefusedEdits = { readonly edits: HookEdits; readonly said: string; readonly lost: string };

export const NOTHING_CARRIED: RefusedEdits = { edits: NO_EDITS, said: '', lost: '' };

export const both = (one: RefusedEdits, two: RefusedEdits): RefusedEdits => ({
  edits: joined(one.edits, two.edits),
  said: `${one.said}${two.said}`,
  lost: `${one.lost}${two.lost}`,
});

export const carriedSafely = (
  changes: ChangeRecord['Service'],
  checkout: ChangeCheckout,
  built: string,
  left: string,
  holder: ReshapeHolder,
  stepped: readonly Reshaped[] = [],
): Effect.Effect<RefusedEdits, never, FileSystem.FileSystem | LineWrites> =>
  built === left && stepped.length === 0
    ? Effect.succeed(NOTHING_CARRIED)
    : Effect.map(
        Effect.result(
          Effect.flatMap(carryDelta(changes, checkout, steppedDelta(stepped), holder), (steps) =>
            Effect.map(carryEdits(changes, checkout, built, left, holder), (hooked) => ({ steps, hooked })),
          ),
        ),
        (carried): RefusedEdits =>
          carried._tag === 'Success'
            ? {
                edits: joined(carried.success.steps, carried.success.hooked),
                said: `${formedSaid(carried.success.steps)}${editsSaid(carried.success.hooked)}`,
                lost: '',
              }
            : {
                edits: NO_EDITS,
                said: '',
                lost: `; what the format commands or the hooks changed could not be carried into the working files: ${carried.failure.message}`,
              },
      );

export const carriedOnRefusal = (
  changes: ChangeRecord['Service'],
  checkout: ChangeCheckout,
  refused: HookRefused,
  holder: ReshapeHolder,
): Effect.Effect<RefusedEdits, never, FileSystem.FileSystem | LineWrites> =>
  Effect.map(carriedSafely(changes, checkout, refused.built, refused.left, holder, refused.stepped), (now) =>
    both(both(refused.earlier ?? NOTHING_CARRIED, now), { edits: NO_EDITS, said: '', lost: unreadSaid(refused.unread) }),
  );

export const postedUnread = (unread: string): string =>
  `what the post-commit hook left in the commit tree could not be read, so its edits did not reach the working files: ${unread}`;

export const unreadSaid = (unread: string | null): string =>
  unread === null
    ? ''
    : `; what the hooks left in the commit tree could not be read, so their edits did not reach the working files: ${unread}`;
