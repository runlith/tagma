import { lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { Effect } from 'effect';
import { type Standing, replaced } from '@runlith/files/replace';
import { withEntryWrite, withNamedEntry } from '@runlith/agent-tools/workspace/runtime';
import type { LineReplacement, LineWrites } from '../change-record/contract/service/lineWrites.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';

const inRoot = (root: string, at: string): boolean => {
  const inside = relative(root, at);
  return !(inside === '..' || inside.startsWith('../') || isAbsolute(inside));
};

function raised(root: string, parent: string): boolean {
  let nearest = parent;
  while (lstatSync(nearest, { throwIfNoEntry: false }) === undefined) nearest = dirname(nearest);
  if (!inRoot(root, realpathSync(nearest))) return false;
  mkdirSync(parent, { recursive: true });
  return true;
}

const resolvedOrNull = (target: string): string | null => {
  try {
    return realpathSync(target);
  } catch {
    return null;
  }
};

const contained = (input: LineReplacement): { readonly target: string } | null => {
  const root = realpathSync(input.root);
  const target = resolve(input.root, input.path);
  if (input.before === null && !raised(root, dirname(target))) return null;
  if (!inRoot(root, realpathSync(dirname(target)))) return null;
  if (lstatSync(target, { throwIfNoEntry: false }) !== undefined) {
    const real = resolvedOrNull(target);
    if (real === null || !inRoot(root, real)) return null;
  }
  return { target };
};

const replaceBytes = Effect.fnUntraced(function* (input: LineReplacement) {
  const placed = yield* Effect.try(() => contained(input));
  if (placed === null) return false;
  const standing: Standing = input.before === null ? { absent: true } : { bytes: new TextEncoder().encode(input.before) };
  return yield* replaced(placed.target, standing, input.after, {
    executable: input.mode === undefined ? undefined : input.mode === '100755',
    publishing: input.publishing,
  });
});

export const lineWrites: LineWrites['Service'] = {
  replace: (input, approved) =>
    (input.before === null || input.after === null ? withNamedEntry : withEntryWrite)(
      input.root,
      resolve(input.root, input.path),
      Effect.gen(function* () {
        if (!(yield* approved)) return false;
        return yield* replaceBytes(input).pipe(
          Effect.mapError(
            (cause) =>
              new GateRefusal('file-write-failed', `the file replacement failed for ${input.path}: ${String(cause)}`, [
                'read the file and its record before retrying',
              ]),
          ),
        );
      }),
    ).pipe(
      Effect.catchTag('PlatformError', (cause) =>
        Effect.fail(new GateRefusal('file-write-failed', cause.message, ['read the file and its parent before retrying'])),
      ),
    ),
};
